// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { decodeState, emptyState, type SeatState, type Snapshot } from "./logic.ts";
export const STATE_KEY = "seat-state.v1";
export class AmbiguousStorageWrite extends Error {}
export class StorageCapacityError extends Error {}
interface Pointer {
  kind: "seat-chunks";
  bank: "a" | "b";
  revision: string;
  count: number;
  length: number;
  checksum: number;
}
const queues = new WeakMap<object, Promise<void>>();
function serial<T>(storage: object, operation: () => Promise<T>): Promise<T> {
  const pending = queues.get(storage) ?? Promise.resolve();
  const result = pending.then(operation, operation);
  queues.set(
    storage,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}
function checksum(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function isPointer(value: unknown): value is Pointer {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Pointer>;
  return (
    p.kind === "seat-chunks" &&
    (p.bank === "a" || p.bank === "b") &&
    typeof p.revision === "string" &&
    /^[a-zA-Z0-9-]+$/.test(p.revision) &&
    typeof p.count === "number" &&
    Number.isInteger(p.count) &&
    p.count >= 1 &&
    p.count <= 100 &&
    typeof p.length === "number" &&
    Number.isInteger(p.length) &&
    p.length >= 1 &&
    p.length <= 2000000 &&
    typeof p.checksum === "number" &&
    Number.isInteger(p.checksum) &&
    p.checksum >= 0 &&
    p.checksum <= 4294967295
  );
}
async function readState(deck: Pick<Deck, "storage">): Promise<SeatState> {
  const value = await deck.storage.get(STATE_KEY);
  if (value === null) return emptyState();
  if (!isPointer(value)) return decodeState(value);
  let text = "";
  for (let i = 0; i < value.count; i++) {
    const raw = await deck.storage.get(`${STATE_KEY}.${value.bank}.${i}`);
    const chunk = raw as { revision?: unknown; text?: unknown } | null;
    if (!chunk || chunk.revision !== value.revision || typeof chunk.text !== "string" || chunk.text.length > 20000)
      throw new Error("저장 조각을 읽지 못했어요.");
    text += chunk.text;
  }
  if (text.length !== value.length || checksum(text) !== value.checksum) throw new Error("저장 자료가 손상되었어요.");
  return decodeState(JSON.parse(text));
}
export function loadState(deck: Pick<Deck, "storage">): Promise<SeatState> {
  return serial(deck.storage, () => readState(deck));
}
async function writeState(deck: Pick<Deck, "storage">, value: SeatState): Promise<void> {
  const text = JSON.stringify(decodeState(value)),
    encoder = new TextEncoder();
  if (text.length > 2000000)
    throw new StorageCapacityError("저장 자료가 너무 커요. 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  const current = await deck.storage.get(STATE_KEY),
    bank = isPointer(current) && current.bank === "a" ? "b" : "a",
    revision = crypto.randomUUID();
  const chunks = Array.from({ length: Math.ceil(text.length / 20000) }, (_, i) => ({
    revision,
    text: text.slice(i * 20000, (i + 1) * 20000),
  }));
  if (chunks.reduce((sum, chunk) => sum + encoder.encode(JSON.stringify(chunk)).length, 0) > 2000000)
    throw new StorageCapacityError("저장 자료가 너무 커요. 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  // Only the inactive bank is cleared. Interrupted cleanup or writes leave the current pointer untouched.
  const prefix = `${STATE_KEY}.${bank}.`;
  const keys = await deck.storage.keys();
  let protectedBytes = 0;
  for (const key of keys)
    if (key !== STATE_KEY && !key.startsWith(prefix)) {
      const stored = await deck.storage.get(key);
      if (stored !== null) protectedBytes += encoder.encode(JSON.stringify(stored)).length;
    }
  if (
    protectedBytes + chunks.reduce((sum, chunk) => sum + encoder.encode(JSON.stringify(chunk)).length, 0) + 1024 >
    5000000
  )
    throw new StorageCapacityError("저장 공간이 부족해요. 기록을 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  for (const key of keys) if (key.startsWith(prefix)) await deck.storage.delete(key);
  for (let i = 0; i < chunks.length; i++) await deck.storage.set(`${prefix}${i}`, chunks[i]);
  const pointer: Pointer = {
    kind: "seat-chunks",
    bank,
    revision,
    count: chunks.length,
    length: text.length,
    checksum: checksum(text),
  };
  try {
    await deck.storage.set(STATE_KEY, pointer);
  } catch (failure) {
    // A transport failure can follow a committed host write. Never delete either bank here.
    let observed: unknown;
    try {
      observed = await deck.storage.get(STATE_KEY);
    } catch {
      throw new AmbiguousStorageWrite("저장 결과를 확인하지 못했어요.", { cause: failure });
    }
    if (!isPointer(observed) || observed.revision !== revision || observed.bank !== bank) throw failure;
  }
}
export function saveState(deck: Pick<Deck, "storage">, value: SeatState): Promise<void> {
  return serial(deck.storage, () => writeState(deck, value));
}
async function readText(deck: Pick<Deck, "fs">): Promise<string | null> {
  const files = await deck.fs.pickFiles({ multiple: false });
  const file = files[0];
  if (!file) return null;
  if (file.size > 5000000) throw new Error("파일은 5MB 이하로 선택해 주세요.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0,
    result = "";
  for await (const bytes of deck.fs.readChunks({ handle: file.handle })) {
    size += bytes.length;
    if (size > 5000000) throw new Error("파일은 5MB 이하로 선택해 주세요.");
    result += decoder.decode(bytes, { stream: true });
  }
  return result + decoder.decode();
}
export const readRoster = readText;
export async function readBackup(deck: Pick<Deck, "fs">): Promise<SeatState | null> {
  const text = await readText(deck);
  return text === null ? null : decodeState(JSON.parse(text));
}
export function publicText(snapshot: Snapshot): string {
  return [
    snapshot.label,
    "칠판 / 교탁",
    ...Array.from({ length: snapshot.layout.rows }, (_, row) =>
      Array.from({ length: snapshot.layout.columns }, (_, column) => {
        const s = snapshot.seats[row * snapshot.layout.columns + column];
        return s ? `${s.number}번 ${s.name}` : "빈 자리";
      }).join("\t"),
    ),
  ].join("\n");
}
export async function exportFile(
  deck: Pick<Deck, "fs">,
  value: SeatState,
  snapshot: Snapshot | null = null,
): Promise<boolean> {
  const parent = await deck.fs.pickFolder();
  if (!parent) return false;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "자리배치" });
  try {
    await deck.fs.writeBlob({
      batchId: batch.batchId,
      suggestedName: snapshot ? "학생용자리배치.txt" : "자리배치기록.json",
      blob: new Blob([snapshot ? publicText(snapshot) : JSON.stringify(decodeState(value), null, 2)], {
        type: snapshot ? "text/plain;charset=utf-8" : "application/json",
      }),
    });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
  return true;
}
