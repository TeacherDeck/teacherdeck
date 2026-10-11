// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { EMPTY_LIBRARY, LIBRARY_KEY, readLibrary } from "./library.ts";
import { type Meeting, readMeeting } from "./meeting.ts";
import { createWriter, MAX_BYTES, MEETING_KEY } from "./storage.ts";

/** An in-memory receipt, returned only after the original-value file is committed and closed. */
export interface RecoveryBackup {
  readonly snapshot: string;
}
function snapshotOf(meeting: unknown, library: unknown): string {
  return JSON.stringify({ meeting, library }, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")))
      : value,
  );
}

/** Cancelled or failed output never returns a receipt authorizing recovery. */
export async function saveRecoveryBackup(deck: Pick<Deck, "storage" | "fs">): Promise<RecoveryBackup | null> {
  const [meeting, library] = await Promise.all([deck.storage.get(MEETING_KEY), deck.storage.get(LIBRARY_KEY)]);
  const snapshot = snapshotOf(meeting, library);
  const parent = await deck.fs.pickFolder();
  if (!parent) return null;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "회의록 복구자료" });
  try {
    const blob = new Blob([JSON.stringify({ meeting, library }, null, 2)], { type: "application/json" });
    const saved = await deck.fs.writeBlob({ batchId: batch.batchId, suggestedName: "recovery.json", blob });
    if (saved.size !== blob.size) throw new Error("RECOVERY_BACKUP_SIZE");
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
  return Object.freeze({ snapshot });
}

/** Preserve both original values before replacing either. Read failures never authorize a reset. */
export async function recoverMeetingStorage(
  deck: Pick<Deck, "storage">,
  replacement?: Meeting,
  backup?: RecoveryBackup | null,
): Promise<void> {
  const [meeting, library] = await Promise.all([deck.storage.get(MEETING_KEY), deck.storage.get(LIBRARY_KEY)]);
  const next = readMeeting(replacement ?? meeting);
  if (replacement && new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES)
    throw new Error("MEETING_TOO_LARGE");
  let repairLibrary = false;
  try {
    readLibrary(library);
  } catch {
    repairLibrary = true;
  }
  if (!backup || backup.snapshot !== snapshotOf(meeting, library)) {
    const key = `recovery.${crypto.randomUUID()}`;
    // Separate keys retain the host's per-value size limit and every archive key.
    await deck.storage.set(`${key}.meeting`, meeting);
    await deck.storage.set(`${key}.library`, library);
  }
  if (repairLibrary) await deck.storage.set(LIBRARY_KEY, EMPTY_LIBRARY);
  if (replacement) await createWriter(deck)(next);
}
