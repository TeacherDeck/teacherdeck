// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { OutputSession } from "./output-session.ts";
import { MAX_BYTES, outputName, sourceExtension, extensionMime, validateOptions, type Options } from "./image.ts";
export const DEFAULT_OPTIONS: Options = { quality: 82, maxEdge: 1600, format: "original" };
export const SETTINGS_KEY = "compression-options-v2";
export async function loadOptions(deck: Deck): Promise<Options> {
  let value = await deck.storage.get<Options>(SETTINGS_KEY);
  if (!value) {
    // Earlier versions stored WebP without offering a format choice.
    const legacy = await deck.storage.get<Options>("compression-options");
    if (legacy) value = { ...legacy, format: "original" };
  }
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
  const originalMime = extensionMime(originalExt);
  if (!["image/png", "image/jpeg", "image/webp"].includes(compressed.type)) throw new Error("ENCODER_UNAVAILABLE");
  if (compressed.size >= original.size && compressed.type === originalMime)
    return { blob: original, name: outputName(name, originalExt), keptOriginal: true };
  const extension =
    compressed.type === originalMime
      ? originalExt
      : compressed.type === "image/jpeg"
        ? "jpg"
        : compressed.type.slice(6);
  return {
    blob: compressed,
    name: outputName(name, extension),
    keptOriginal: false,
  };
}
export interface Result {
  file: FileHandleInfo;
  status: "compressed" | "original" | "failed";
  outputSize?: number;
  folder?: FolderHandleInfo;
  formatUnavailable?: boolean;
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
    worker.onmessage = (event: MessageEvent<{ ok: boolean; blob?: Blob; error?: string }>) => {
      finish();
      if (event.data.ok && event.data.blob) resolve(event.data.blob);
      else reject(new Error(event.data.error === "ENCODER_UNAVAILABLE" ? "ENCODER_UNAVAILABLE" : "COMPRESSION_FAILED"));
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
  parentHandle: string | undefined,
  options: Options,
  signal: AbortSignal,
  encoder: Encoder,
  progress: (results: Result[]) => void,
) {
  validateOptions(options);
  if (signal.aborted) return { results: [], folder: null };
  const destination = new OutputSession(deck, parentHandle);
  let folder: FolderHandleInfo | null = null;
  const results: Result[] = [];
  try {
    for (const file of files) {
      if (signal.aborted) break;
      let outputFolder: FolderHandleInfo | null = null;
      try {
        const batch = await destination.get(signal, file.handle);
        if (!batch) break;
        folder = outputFolder = batch.folder;
        if (file.size > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
        const chunks: BlobPart[] = [];
        let total = 0;
        for await (const bytes of deck.fs.readChunks({ handle: file.handle }, { signal })) {
          total += bytes.length;
          if (total > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
          chunks.push(new Uint8Array(bytes));
        }
        const original = new Blob(chunks);
        const originalExt = sourceExtension(file.name, new Uint8Array(await original.slice(0, 12).arrayBuffer()));
        const compressed = await encoder(original, options, signal);
        const expectedMime = options.format === "original" ? extensionMime(originalExt) : `image/${options.format}`;
        if (compressed.type !== expectedMime) throw new Error("ENCODER_UNAVAILABLE");
        const output = chooseOutput(original, compressed, file.name, originalExt);
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
      } catch (error) {
        if (signal.aborted) break;
        results.push({
          file,
          status: "failed",
          ...(error instanceof Error && error.message === "ENCODER_UNAVAILABLE" ? { formatUnavailable: true } : {}),
          ...(outputFolder ? { folder: outputFolder } : {}),
        });
      }
      progress([...results]);
    }
  } finally {
    await destination.close();
  }
  return { results, folder };
}
