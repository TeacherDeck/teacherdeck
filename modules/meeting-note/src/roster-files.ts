// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import type { Roster } from "./library.ts";
export function mergeRosters(current: Roster[], value: unknown): Roster[] {
  const incoming = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "presets" in value
      ? value.presets
      : null;
  if (!Array.isArray(incoming) || !incoming.length) throw new Error("INVALID_ROSTER");
  const result = [...current];
  for (const row of incoming) {
    if (
      !row ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !Array.isArray(row.people) ||
      !row.people.length ||
      row.people.length > 12 ||
      !row.people.every((p: unknown) => typeof p === "string" && p.trim())
    )
      throw new Error("INVALID_ROSTER");
    const roster: Roster = {
      name: row.name.trim(),
      people: row.people,
      title: typeof row.title === "string" ? row.title : "",
      place: typeof row.place === "string" ? row.place : "",
    };
    const at = result.findIndex((r) => r.name === roster.name);
    if (at < 0) result.push(roster);
    else result[at] = roster;
  }
  if (result.length > 40) throw new Error("ROSTER_FULL");
  return result;
}
export async function pickRosters(deck: Deck): Promise<unknown | null> {
  const file = (
    await deck.fs.pickFiles({ multiple: false, filters: [{ name: "위원회 백업", extensions: ["json"] }] })
  )[0];
  if (!file) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle })) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error("INVALID_ROSTER");
    text += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse((text + decoder.decode()).replace(/^\uFEFF/, ""));
}
export async function saveRosters(deck: Deck, rosters: Roster[]): Promise<void> {
  const parent = await deck.fs.pickFolder();
  if (!parent) return;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "위원회 내보내기" });
  try {
    await deck.fs.writeBlob({
      batchId: batch.batchId,
      suggestedName: "위원회.json",
      blob: new Blob([JSON.stringify({ kind: "meeting_note_presets", presets: rosters }, null, 2)], {
        type: "application/json",
      }),
    });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
}
