// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo } from "@deck/sdk";
import type { EditorDocument } from "../core/model.ts";
import { assertMemoryBudget, managedDocumentBytes } from "../core/model.ts";
import type { CodecRequest, CodecResponse } from "./codec.worker.ts";
import type { EncodeResult, ExportFormat } from "./codec.ts";
import type { ImportedDocument, ImportOptions } from "./psd.ts";
import { MAX_INPUT_BYTES, MAX_WORKING_BYTES } from "./limits.ts";
import { requireInputBudget } from "./budget.ts";
import { projectEncodingScratch } from "./project.ts";
import { psdEncodingScratch, rasterEncodingScratch } from "./export-budget.ts";
export { projectSaveHeadroom } from "./project.ts";
export { inspectInputBudget } from "./budget.ts";
export { OutputSession } from "./output-session.ts";
export { exportName, exportTarget } from "./export-format.ts";
export type { ExportSelection } from "./export-format.ts";
export type { ImportedDocument, ImportOptions, EncodeResult, ExportFormat };
export class FileOperationError extends Error {
  readonly code: string;
  readonly reasons: string[];
  constructor(code: string, reasons: string[] = []) {
    super(code);
    this.name = "FileOperationError";
    this.code = code;
    this.reasons = reasons;
  }
}
/** Adapted from image-crop readImage. Host handles are opaque and never converted to paths. */
export async function readInput(
  deck: Pick<Deck, "fs">,
  file: FileHandleInfo,
  signal: AbortSignal,
  reservedBytes = 0,
): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_INPUT_BYTES) throw new FileOperationError("INPUT_LIMIT");
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 0 || reservedBytes + file.size * 2 > MAX_WORKING_BYTES)
    throw new FileOperationError("MEMORY_LIMIT");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    if (signal.aborted) throw new FileOperationError("CANCELLED");
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new FileOperationError("INPUT_LIMIT");
    if (reservedBytes + size * 2 > MAX_WORKING_BYTES) throw new FileOperationError("MEMORY_LIMIT");
    chunks.push(chunk);
  }
  if (signal.aborted) throw new FileOperationError("CANCELLED");
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
export type CodecRunner = (request: CodecRequest, signal: AbortSignal) => Promise<ImportedDocument | EncodeResult>;
export const runCodec: CodecRunner = (request, signal) => {
  if (signal.aborted) return Promise.reject(new FileOperationError("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new FileOperationError("CANCELLED"));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new FileOperationError("TIMEOUT"));
    }, 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<CodecResponse>) => {
      finish();
      if ("error" in event.data) reject(new FileOperationError(event.data.error, event.data.reasons));
      else resolve(event.data.result);
    };
    worker.onerror = () => {
      finish();
      reject(new FileOperationError("INVALID_FILE"));
    };
    // Do not transfer the live document's pixel buffers: cancellation must leave the editable original intact.
    try {
      worker.postMessage(request);
    } catch {
      finish();
      reject(new FileOperationError("INVALID_FILE"));
    }
  });
};
export async function importDocument(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  options: ImportOptions = {},
  runner: CodecRunner = runCodec,
): Promise<ImportedDocument> {
  try {
    requireInputBudget(bytes, options);
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "INPUT_LIMIT",
        "IMAGE_LIMIT",
        "MEMORY_LIMIT",
        "LAYER_LIMIT",
        "ANIMATED_IMAGE",
        "INVALID_PROJECT",
        "INVALID_PSD",
      ].includes(error.message)
        ? error.message
        : "INVALID_FILE";
    throw new FileOperationError(code);
  }
  return (await runner({ kind: "decode", bytes, options }, signal)) as ImportedDocument;
}
export async function exportDocument(
  document: EditorDocument,
  format: ExportFormat,
  signal: AbortSignal,
  optionsOrRunner: { reservedBytes?: number } | CodecRunner = {},
): Promise<EncodeResult> {
  const runner = typeof optionsOrRunner === "function" ? optionsOrRunner : runCodec;
  const reservedBytes = typeof optionsOrRunner === "function" ? 0 : (optionsOrRunner.reservedBytes ?? 0);
  if (!Number.isSafeInteger(reservedBytes) || reservedBytes < 0) throw new FileOperationError("MEMORY_LIMIT");
  // Selection is an editor-only overlay. It is not serialized by any export format.
  const snapshot = { ...document, selection: null };
  const cloneBytes = managedDocumentBytes(snapshot);
  const scratch =
    format === "deckimage"
      ? projectEncodingScratch(document)
      : format === "psd"
        ? psdEncodingScratch(document)
        : rasterEncodingScratch(document);
  // Main-thread live document + the Worker snapshot + codec/canvas/writer buffers coexist until completion.
  assertMemoryBudget(document, cloneBytes + scratch + reservedBytes);
  return (await runner({ kind: "encode", document: snapshot, format }, signal)) as EncodeResult;
}
