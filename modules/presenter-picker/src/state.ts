// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { decodeState, emptyState, type PickerState } from "./logic.ts";
import { readChunked, writeChunked, MAX_STATE_BYTES } from "./chunked-storage.ts";
import { packRecords, unpackRecords } from "./record-packing.ts";
export const STATE_KEY = "presenter-state.v1";
export async function loadState(deck: Pick<Deck, "storage">): Promise<PickerState> {
  const value = await readChunked(deck.storage, STATE_KEY);
  return value === null ? emptyState() : decodeState(unpackRecords(value));
}
export async function saveState(
  deck: Pick<Deck, "storage">,
  state: PickerState,
  options: { recover?: boolean } = {},
): Promise<void> {
  const valid = decodeState(state);
  await writeChunked(deck.storage, STATE_KEY, packRecords(valid), {
    ...options,
    validatePrevious: (value) => decodeState(unpackRecords(value)),
  });
}
export async function writeBackup(deck: Pick<Deck, "fs">, state: PickerState): Promise<boolean> {
  const text = JSON.stringify(decodeState(state));
  if (
    new TextEncoder().encode(text).length > MAX_STATE_BYTES * 2 ||
    new TextEncoder().encode(JSON.stringify(packRecords(decodeState(state)))).length > MAX_STATE_BYTES
  )
    throw new Error("기록이 보관 한도를 넘어요. 기록을 확인해 주세요.");
  const folder = await deck.fs.pickFolder();
  if (!folder) return false;
  const batch = await deck.fs.createOutputFolder({ parentHandle: folder.handle, suggestedName: "발표자기록" });
  try {
    await deck.fs.writeBlob({
      batchId: batch.batchId,
      suggestedName: "발표자기록.json",
      blob: new Blob([text], { type: "application/json" }),
    });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId }).catch(() => undefined);
  }
  return true;
}
export async function readBackup(deck: Pick<Deck, "fs">): Promise<PickerState | null> {
  const files = await deck.fs.pickFiles({ multiple: false });
  const file = files[0];
  if (!file) return null;
  if (file.size > MAX_STATE_BYTES * 2) throw new Error("발표자 기록 파일은 4MB 이하만 읽을 수 있어요.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  for await (const bytes of deck.fs.readChunks({ handle: file.handle })) {
    size += bytes.length;
    if (size > MAX_STATE_BYTES * 2) throw new Error("발표자 기록 파일이 너무 커요.");
    text += decoder.decode(bytes, { stream: true });
  }
  const valid = decodeState(JSON.parse(text + decoder.decode()));
  if (new TextEncoder().encode(JSON.stringify(packRecords(valid))).length > MAX_STATE_BYTES)
    throw new Error("가져온 기록이 저장 한도를 넘어요.");
  return valid;
}
