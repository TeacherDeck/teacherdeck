// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

import type { Deck } from "@deck/sdk";
import { MAX_BYTES, STATE_KEY, readDocument, type Document } from "./logic.ts";
export async function pickBackup(deck: Deck): Promise<Document | null> {
  const file = (
    await deck.fs.pickFiles({ filters: [{ name: "JSON 백업", extensions: ["json"] }], multiple: false })
  )[0];
  if (!file) return null;
  if (file.size > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    total = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle })) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return readDocument(JSON.parse(text.replace(/^\uFEFF/, "")));
}
export async function exportBackup(deck: Deck, value: unknown): Promise<boolean> {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error("DOCUMENT_TOO_LARGE");
  const parent = await deck.fs.pickFolder();
  if (!parent) return false;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "D-day 백업" });
  try {
    await deck.fs.writeBlob({
      batchId: batch.batchId,
      suggestedName: "dday.json",
      blob: new Blob([text], { type: "application/json" }),
    });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
  return true;
}
/** A failed preservation never writes the active key. */
export async function replaceDocument(deck: Deck, value: Document): Promise<void> {
  const document = readDocument(value),
    previous = await deck.storage.get(STATE_KEY);
  if (previous !== null) await deck.storage.set(`recovery.v1.${crypto.randomUUID()}`, previous);
  await deck.storage.set(STATE_KEY, document);
}
