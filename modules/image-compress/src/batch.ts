// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { MAX_BYTES, outputName, signatureExtension, validateOptions, type Options } from "./image.ts";
export const DEFAULT_OPTIONS: Options = { quality: 82, maxEdge: 1600, format: "webp" };
export const SETTINGS_KEY = "compression-options";
export async function loadOptions(deck: Deck): Promise<Options> {
  const value = await deck.storage.get<Options>(SETTINGS_KEY);
  try {
    if (!value) return DEFAULT_OPTIONS;
    validateOptions(value);
    return value;
  } catch {
    return DEFAULT_OPTIONS;
  }
}
export async function saveOptions(deck: Deck, options: Options) {
  validateOptions(options);
  await deck.storage.set(SETTINGS_KEY, options);
}
export function supported(file: FileHandleInfo) {
  return ["jpg", "jpeg", "png", "webp"].includes(file.ext.toLowerCase());
}
export function chooseOutput(original: Blob, compressed: Blob, name: string, originalExt: string) {
  if (compressed.size >= original.size)
    return { blob: original, name: outputName(name, originalExt), keptOriginal: true };
  return {
    blob: compressed,
    name: outputName(name, compressed.type === "image/jpeg" ? "jpg" : "webp"),
    keptOriginal: false,
  };
}
export interface Result {
  file: FileHandleInfo;
  status: "compressed" | "original" | "failed";
  outputSize?: number;
  folder?: FolderHandleInfo;
}
export type Encoder = (blob: Blob, options: Options, signal: AbortSignal) => Promise<Blob>;
export const encode: Encoder = (blob, options, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("CANCELLED"));
      return;
    }
    const worker = new Worker(new URL("./convert.worker.ts", import.meta.url), { type: "module" });
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("COMPRESSION_TIMEOUT"));
    }, 90_000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      finish();
      reject(new Error("CANCELLED"));
    };
    worker.onmessage = (event: MessageEvent<{ ok: boolean; blob?: Blob }>) => {
      finish();
      if (event.data.ok && event.data.blob) resolve(event.data.blob);
      else reject(new Error("COMPRESSION_FAILED"));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("COMPRESSION_FAILED"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.postMessage({ blob, options });
  });
export async function runBatch(
  deck: Deck,
  files: readonly FileHandleInfo[],
  parentHandle: string,
  options: Options,
  signal: AbortSignal,
  encoder: Encoder,
  progress: (results: Result[]) => void,
) {
  validateOptions(options);
  if (signal.aborted) return { results: [], folder: null };
  const batch = await deck.fs.createOutputFolder({ parentHandle, suggestedName: "압축 이미지" });
  const results: Result[] = [];
  try {
    for (const file of files) {
      if (signal.aborted) break;
      try {
        if (file.size > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
        const chunks: BlobPart[] = [];
        let total = 0;
        for await (const bytes of deck.fs.readChunks({ handle: file.handle }, { signal })) {
          total += bytes.length;
          if (total > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
          chunks.push(new Uint8Array(bytes));
        }
        const original = new Blob(chunks);
        const compressed = await encoder(original, options, signal);
        const output = chooseOutput(
          original,
          compressed,
          file.name,
          compressed.size >= original.size
            ? signatureExtension(new Uint8Array(await original.slice(0, 12).arrayBuffer()))
            : "webp",
        );
        const saved = await deck.fs.writeBlob(
          { batchId: batch.batchId, suggestedName: output.name, blob: output.blob },
          { signal },
        );
        results.push({
          file,
          status: output.keptOriginal ? "original" : "compressed",
          outputSize: saved.size,
          folder: batch.folder,
        });
      } catch {
        if (signal.aborted) break;
        results.push({ file, status: "failed", folder: batch.folder });
      }
      progress([...results]);
    }
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
  return { results, folder: batch.folder };
}
