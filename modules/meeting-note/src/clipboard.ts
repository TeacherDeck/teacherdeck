// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { ClipboardBlock, ClipboardCell, ClipboardWriteRichTextArgs } from "@deck/sdk";
import type { Entry, Meeting } from "./meeting.ts";
import { publicDuration, structuredExport } from "./export.ts";
const runs = (text: string, bold = false) => [{ text, ...(bold ? { bold: true } : {}) }];
const cell = (text: string, bold = false): ClipboardCell => ({ runs: runs(text, bold) });
const paragraph = (text: string): ClipboardBlock => ({ kind: "paragraph", runs: runs(text) });
const heading = (text: string, level: number): ClipboardBlock => ({ kind: "heading", level, runs: runs(text) });
const table = (headers: string[], rows: ClipboardCell[][]): ClipboardBlock => ({
  kind: "table",
  rows: [headers.map((text) => ({ runs: runs(text), header: true })), ...rows],
});
/** Only public records enter the host's structured clipboard format. No raw HTML crosses the bridge. */
export function publicClipboard(meeting: Meeting): ClipboardWriteRichTextArgs {
  const entries = meeting.entries.filter((entry) => !entry.private);
  const blocks: ClipboardBlock[] = [
    heading(meeting.title, 1),
    table(
      ["항목", "내용"],
      [
        [cell("일시"), cell(publicDuration(meeting))],
        [cell("장소"), cell(meeting.place || "미정")],
        [cell("참석"), cell(meeting.speakers.join(", "))],
        [cell("결석"), cell(meeting.absentees?.join(", ") || "없음")],
      ],
    ),
  ];
  const sections: { title: string; entries: Entry[] }[] = [{ title: "개회", entries: [] }];
  for (const entry of entries) {
    if (entry.kind === "안건") sections.push({ title: `안건 ${sections.length}. ${entry.text}`, entries: [] });
    else sections.at(-1)?.entries.push(entry);
  }
  for (const [index, section] of sections.entries()) {
    if (index === 0 && !section.entries.length) continue;
    blocks.push(heading(section.title, 2));
    blocks.push(
      section.entries.length
        ? table(
            ["시각", "화자", "내용"],
            section.entries.map((entry) => [
              cell(
                entry.timestamp
                  ? new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
                  : "",
              ),
              cell(entry.speaker || "미지정", true),
              {
                runs: [
                  ...runs(`[${entry.kind}] `, entry.kind === "결정" || entry.kind === "조치"),
                  ...runs(entry.text),
                ],
              },
            ]),
          )
        : paragraph("기록된 발언 없음"),
    );
  }
  const decisions = entries.filter((entry) => entry.kind === "결정");
  blocks.push(
    heading("결정사항", 2),
    decisions.length
      ? table(
          ["번호", "내용", "발의"],
          decisions.map((entry, i) => [cell(String(i + 1)), cell(entry.text), cell(entry.speaker)]),
        )
      : paragraph("없음"),
  );
  const actions = entries.filter((entry) => entry.kind === "조치");
  blocks.push(
    heading("조치사항", 2),
    actions.length
      ? table(
          ["담당", "내용", "기한"],
          actions.map((entry) => [
            cell(entry.owner || entry.speaker || "미지정"),
            cell(entry.text),
            cell(entry.due || "-"),
          ]),
        )
      : paragraph("없음"),
  );
  return { plainText: structuredExport(meeting, "txt"), blocks };
}
