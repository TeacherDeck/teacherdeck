// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export type EntryKind = "발언" | "결정" | "조치" | "질의" | "안건";
export interface Entry {
  id: string;
  kind: EntryKind;
  text: string;
  speaker: string;
  private: boolean;
  owner: string;
  due: string;
}
export interface Meeting {
  version: 1;
  title: string;
  speakers: string[];
  selected: string;
  entries: Entry[];
  draft: string;
}
export const emptyMeeting = (): Meeting => ({
  version: 1,
  title: "새 회의",
  speakers: [],
  selected: "",
  entries: [],
  draft: "",
});
export function parseEntry(raw: string, speakers: string[], selected: string, id: string): Entry | null {
  let text = raw.trimEnd();
  if (!text.trim()) return null;
  const entry: Entry = { id, kind: "발언", text: "", speaker: selected, private: false, owner: "", due: "" };
  if (text.startsWith("\\")) {
    entry.text = text.slice(1);
    return entry.text.trim() ? entry : null;
  }
  if (text.startsWith("//")) {
    entry.private = true;
    text = text.slice(2).trimStart();
  }
  if (text.startsWith("#")) {
    entry.kind = entry.private ? "발언" : "안건";
    entry.text = entry.private ? text : text.slice(1).trim();
    entry.speaker = "";
    return entry.text ? entry : null;
  }
  const kinds: Record<string, EntryKind> = { "!": "결정", "*": "조치", "?": "질의" };
  const kind = kinds[text.charAt(0)];
  if (kind) {
    entry.kind = kind;
    text = text.slice(1).trimStart();
  }
  if (text.startsWith("\\")) text = text.slice(1);
  else {
    const match = /^(\d{1,2})\s+([\s\S]+)$/.exec(text);
    if (match && speakers[Number(match[1]) - 1]) {
      entry.speaker = speakers[Number(match[1]) - 1] ?? "";
      text = match[2] ?? "";
    }
  }
  if (entry.kind === "조치") {
    text = text.replace(/(?:^|\s)@(\S+)/, (_, owner: string) => {
      entry.owner = owner;
      return " ";
    });
    text = text
      .replace(/(?:^|\s)~(\S+)/, (_, due: string) => {
        entry.due = due;
        return " ";
      })
      .trim();
  }
  entry.text = text;
  return text.trim() ? entry : null;
}
export function publicText(meeting: Meeting): string {
  return [
    meeting.title,
    `참석: ${meeting.speakers.join(", ")}`,
    "",
    ...meeting.entries
      .filter((entry) => !entry.private)
      .map((entry) =>
        entry.kind === "안건"
          ? `\n■ ${entry.text}`
          : `[${entry.kind}] ${entry.speaker ? `${entry.speaker}: ` : ""}${entry.text}${entry.owner ? ` (담당: ${entry.owner})` : ""}${entry.due ? ` (기한: ${entry.due})` : ""}`,
      ),
  ].join("\n");
}
export function readMeeting(value: unknown): Meeting {
  if (value === null) return emptyMeeting();
  if (typeof value !== "object" || value === null) throw new Error("INVALID_MEETING");
  const data = value as Partial<Meeting>;
  const kinds = ["발언", "결정", "조치", "질의", "안건"];
  if (
    data.version !== 1 ||
    typeof data.title !== "string" ||
    typeof data.draft !== "string" ||
    typeof data.selected !== "string" ||
    !Array.isArray(data.speakers) ||
    data.speakers.length > 12 ||
    !data.speakers.every((s) => typeof s === "string" && s.trim().length > 0) ||
    new Set(data.speakers).size !== data.speakers.length ||
    !Array.isArray(data.entries) ||
    !data.entries.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        kinds.includes(entry.kind) &&
        typeof entry.private === "boolean" &&
        [entry.text, entry.speaker, entry.owner, entry.due].every((s) => typeof s === "string"),
    ) ||
    new Set(data.entries.map((entry) => entry.id)).size !== data.entries.length
  )
    throw new Error("INVALID_MEETING");
  return data as Meeting;
}
export function speakerIndex(code: string): number | null {
  const index = [
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Digit0",
    "Minus",
    "Equal",
  ].indexOf(code);
  return index < 0 ? null : index;
}
