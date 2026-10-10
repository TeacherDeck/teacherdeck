// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Meeting, Entry } from "./meeting.ts";
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const item = (text: string) => text.replace(/\r?\n/g, "\n  ");
export function publicDuration(meeting: Meeting): string {
  const start = Date.parse(meeting.startedAt ?? "");
  const end = Date.parse(meeting.entries.filter((e) => !e.private && e.kind !== "안건").at(-1)?.timestamp ?? "");
  if (!Number.isFinite(start)) return "";
  return Number.isFinite(end)
    ? `${meeting.startedAt} ~ ${new Date(end).toISOString()} (${Math.max(0, Math.round((end - start) / 60000))}분)`
    : (meeting.startedAt ?? "");
}
export function structuredExport(meeting: Meeting, format: "md" | "txt" | "summary" | "html"): string {
  const entries = meeting.entries.filter((e) => !e.private);
  const decisions = entries.filter((e) => e.kind === "결정");
  const actions = entries.filter((e) => e.kind === "조치");
  const groups: { title: string; items: Entry[] }[] = [{ title: "개회", items: [] }];
  for (const entry of entries) {
    if (entry.kind === "안건") groups.push({ title: `안건 ${groups.length}. ${entry.text}`, items: [] });
    else groups.at(-1)?.items.push(entry);
  }
  const meta = [
    `일시: ${publicDuration(meeting)}`,
    `참석: ${meeting.speakers.join(", ")} (${meeting.speakers.length}명)`,
    ...(meeting.place ? [`장소: ${meeting.place}`] : []),
    ...(meeting.absentees?.length ? [`결석: ${meeting.absentees.join(", ")}`] : []),
  ];
  const detail = (e: Entry) =>
    `[${e.kind}] ${e.speaker || "미지정"}: ${e.text}${e.owner ? ` (담당: ${e.owner})` : ""}${e.due ? ` (기한: ${e.due})` : ""}`;
  if (format === "html") {
    const table = (headers: string[], rows: string[][]) =>
      `<table border="1"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>${escapeHtml(meeting.title)}</title><body><h1>${escapeHtml(meeting.title)}</h1>${meta.map((m) => `<p>${escapeHtml(m)}</p>`).join("")}${groups
      .filter((g, i) => i || g.items.length)
      .map(
        (g) =>
          `<h2>${escapeHtml(g.title)}</h2>${
            g.items.length
              ? table(
                  ["시각", "화자", "종류", "내용", "담당", "기한"],
                  g.items.map((e) => [e.timestamp ?? "", e.speaker || "미지정", e.kind, e.text, e.owner, e.due]),
                )
              : "<p>기록된 발언 없음</p>"
          }`,
      )
      .join("")}<h2>결정사항</h2>${table(
      ["번호", "내용", "발의"],
      decisions.map((e, i) => [String(i + 1), e.text, e.speaker]),
    )}<h2>조치사항</h2>${table(
      ["담당", "내용", "기한"],
      actions.map((e) => [e.owner || e.speaker || "미지정", e.text, e.due || "-"]),
    )}</body></html>`;
  }
  const out = [format === "txt" ? meeting.title : `# ${meeting.title}`, ...meta, ""];
  if (format !== "summary")
    for (const [i, g] of groups.entries()) {
      if (!i && !g.items.length) continue;
      out.push(
        `## ${g.title}`,
        ...g.items.map((e) => `- ${e.timestamp ?? ""} ${item(detail(e))}`),
        ...(g.items.length ? [] : ["기록된 발언 없음"]),
        "",
      );
    }
  out.push(
    "## 결정사항",
    ...(decisions.length ? decisions.map((e, i) => `${i + 1}. ${item(e.text)} (${e.speaker || "미지정"})`) : ["없음"]),
    "",
    "## 조치사항",
  );
  if (format === "txt") out.push(...actions.map((e) => detail(e)));
  else
    out.push(
      "| 담당 | 내용 | 기한 |",
      "|---|---|---|",
      ...actions.map((e) => `| ${cell(e.owner || e.speaker || "미지정")} | ${cell(e.text)} | ${cell(e.due || "-")} |`),
    );
  return out.join("\n");
}
