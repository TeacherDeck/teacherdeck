// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { type Entry, type Meeting, emptyMeeting, publicText, readMeeting } from "./meeting.ts";
export type ExportFormat = "txt" | "md" | "summary";
export function exportText(meeting: Meeting, format: ExportFormat): string {
  if (format === "txt") return publicText(meeting);
  const entries = meeting.entries.filter(
    (entry) => !entry.private && (format !== "summary" || ["결정", "조치", "안건"].includes(entry.kind)),
  );
  return [
    `# ${meeting.title}`,
    `참석: ${meeting.speakers.join(", ")}`,
    meeting.place ? `장소: ${meeting.place}` : "",
    meeting.absentees?.length ? `결석: ${meeting.absentees.join(", ")}` : "",
    "",
    ...entries.map((entry) =>
      entry.kind === "안건"
        ? `\n## ${entry.text}`
        : `- [${entry.kind}] ${entry.speaker ? `${entry.speaker}: ` : ""}${entry.text}${entry.owner ? ` · 담당: ${entry.owner}` : ""}${entry.due ? ` · 기한: ${entry.due}` : ""}`,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
}
/** Accepts this module's backup and the original application's plain meeting JSON. */
export function importMeeting(value: unknown): Meeting {
  if (typeof value !== "object" || value === null) throw new Error("INVALID_MEETING");
  if ("version" in value) return readMeeting(value);
  const data = value as Record<string, unknown>;
  if (
    typeof data["title"] !== "string" ||
    !Array.isArray(data["speakers"]) ||
    !Array.isArray(data["entries"]) ||
    !Array.isArray(data["agendas"])
  )
    throw new Error("INVALID_MEETING");
  const speakers = data["speakers"].map((speaker: unknown) => {
    if (!speaker || typeof speaker !== "object" || !("name" in speaker) || typeof speaker.name !== "string")
      throw new Error("INVALID_MEETING");
    return speaker.name;
  });
  if (speakers.length > 12) throw new Error("INVALID_MEETING");
  const entries: Entry[] = [];
  let agenda = 0;
  for (const item of data["entries"]) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.text !== "string" ||
      typeof item.priv !== "boolean" ||
      !["발언", "결정", "액션", "질의"].includes(item.type) ||
      !Number.isInteger(item.ag) ||
      item.ag < 0 ||
      item.ag > data["agendas"].length ||
      (item.sp !== null && (!Number.isInteger(item.sp) || item.sp < 0 || item.sp >= speakers.length))
    )
      throw new Error("INVALID_MEETING");
    while (agenda < item.ag) {
      const heading = data["agendas"][agenda];
      if (!heading || typeof heading.title !== "string") throw new Error("INVALID_MEETING");
      entries.push({
        id: crypto.randomUUID(),
        kind: "안건",
        text: heading.title,
        speaker: "",
        private: false,
        owner: "",
        due: "",
      });
      agenda++;
    }
    entries.push({
      id: crypto.randomUUID(),
      kind: item.type === "액션" ? "조치" : item.type,
      text: item.text,
      speaker: item.sp === null ? "" : (speakers[item.sp] ?? ""),
      private: item.priv,
      owner: typeof item.owner === "string" ? item.owner : "",
      due: typeof item.due === "string" ? item.due : "",
      ...(typeof item.raw === "string" ? { raw: item.raw } : {}),
      ...(typeof item.ts === "string" ? { timestamp: item.ts } : {}),
    });
  }
  while (agenda < data["agendas"].length) {
    const heading = data["agendas"][agenda++];
    if (!heading || typeof heading.title !== "string") throw new Error("INVALID_MEETING");
    entries.push({
      id: crypto.randomUUID(),
      kind: "안건",
      text: heading.title,
      speaker: "",
      private: false,
      owner: "",
      due: "",
    });
  }
  return readMeeting({
    ...emptyMeeting(),
    title: data["title"],
    speakers,
    selected: typeof data["cur"] === "number" ? (speakers[data["cur"]] ?? "") : "",
    entries,
    place: typeof data["place"] === "string" ? data["place"] : "",
    absentees: data["absentees"] ?? [],
    startedAt: typeof data["startedAt"] === "string" ? data["startedAt"] : "",
  });
}
export async function pickMeeting(deck: Deck): Promise<Meeting | null> {
  const files = await deck.fs.pickFiles({ multiple: false, filters: [{ name: "회의록 백업", extensions: ["json"] }] });
  const file = files[0];
  if (!file) return null;
  const limit = 2 * 1024 * 1024;
  if (file.size > limit) throw new Error("INVALID_MEETING");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle })) {
    size += chunk.length;
    if (size > limit) throw new Error("INVALID_MEETING");
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return importMeeting(JSON.parse(text.replace(/^\uFEFF/, "")));
}
export async function saveFile(deck: Deck, meeting: Meeting, backup: boolean, format: ExportFormat): Promise<boolean> {
  const parent = await deck.fs.pickFolder();
  if (!parent) return false;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "회의록 내보내기" });
  try {
    await deck.fs.writeBlob({
      batchId: batch.batchId,
      suggestedName: backup
        ? "회의록 백업.json"
        : format === "txt"
          ? "회의록.txt"
          : format === "md"
            ? "회의록.md"
            : "회의록 요약.md",
      blob: new Blob([backup ? JSON.stringify(meeting, null, 2) : exportText(meeting, format)], {
        type: "text/plain;charset=utf-8",
      }),
    });
  } catch (error) {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId }).catch(() => undefined);
    throw error;
  }
  await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  return true;
}
