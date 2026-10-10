// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { OutputSession } from "./output-session.ts";
import { MAX_BYTES } from "./header.ts";
import { outputName, type Edit } from "./edit.ts";
import type { CropRequest, CropResponse } from "./crop.worker.ts";
export type Renderer = (request: CropRequest, signal: AbortSignal) => Promise<CropResponse>;
export const renderCrop: Renderer = (request, signal) => {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./crop.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error("CANCELLED"));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("TIMEOUT"));
    }, 90000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<CropResponse & { error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error("INVALID_IMAGE"));
      else resolve(event.data);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("INVALID_IMAGE"));
    };
    // Keep the original encoded bytes available for later edits and retry.
    worker.postMessage(request);
  });
};
export async function readImage(
  deck: Pick<Deck, "fs">,
  file: FileHandleInfo,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size > MAX_BYTES) throw new Error("INPUT_LIMIT");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    if (signal.aborted) throw new Error("CANCELLED");
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("INPUT_LIMIT");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}
export interface CropItem {
  file: FileHandleInfo;
  bytes: Uint8Array<ArrayBuffer>;
  sourceWidth: number;
  sourceHeight: number;
  edit: Edit;
}
export interface CropOutput {
  destinationExpired?: boolean;
  outputs?: Record<string, string>;
  folder: FolderHandleInfo;
  saved: string[];
  failed: string[];
  cancelled: boolean;
}
export async function saveCrops(
  deck: Pick<Deck, "fs">,
  items: CropItem[],
  format: "png" | "jpeg",
  signal: AbortSignal,
  progress: (done: number) => void = () => undefined,
  render: Renderer = renderCrop,
  session?: OutputSession,
): Promise<CropOutput | null> {
  if (!items.length || signal.aborted) return null;
  const destination = session ?? new OutputSession(deck, "잘라낸 이미지");
  const batch = await destination.get(signal);
  if (!batch) return null;
  let destinationExpired = false;
  const outputs: Record<string, string> = {};
  const saved: string[] = [],
    failed: string[] = [];
  const used = destination.usedNames;
  try {
    for (const item of items) {
      if (signal.aborted) break;
      try {
        const result = await render({ bytes: item.bytes, edit: item.edit, preview: false, format }, signal);
        const proposed = outputName(item.file.name, format);
        let name = proposed;
        let suffix = 2;
        while (used.has(name.toLowerCase()))
          name = proposed.replace(/\.[^.]+$/, `_${suffix++}.${format === "jpeg" ? "jpg" : "png"}`);
        used.add(name.toLowerCase());
        const output = await deck.fs.writeBlob(
          { batchId: batch.batchId, suggestedName: name, blob: result.blob },
          { signal },
        );
        outputs[item.file.handle] = output.name;
        saved.push(item.file.handle);
      } catch (error) {
        if (!signal.aborted) failed.push(item.file.handle);
        if (error && typeof error === "object" && "code" in error && error.code === "NOT_FOUND") {
          destinationExpired = true;
          break;
        }
      }
      progress(saved.length + failed.length);
    }
  } finally {
    if (!session) await destination.close();
  }
  return { folder: batch.folder, outputs, destinationExpired, saved, failed, cancelled: signal.aborted };
}
