// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { MAX_BYTES, MAX_OUTPUT } from "./pdf-geometry.ts";
import { DEFAULT_OPTIONS, choose, outputName, validate, type Options } from "./logic.ts";
import { openPdf, renderPage } from "./pdf.ts";
import type { RasterPage } from "./writer.ts";
export function optimizeInWorker(
  bytes: Uint8Array,
  quality: number,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./optimize.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("CANCELLED"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("PDF_TIMEOUT"));
    }, 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ kind: string; bytes?: Uint8Array; done?: number; total?: number }>) => {
      if (event.data.kind === "progress") {
        progress(event.data.done ?? 0, event.data.total ?? 0);
        return;
      }
      cleanup();
      if (event.data.kind === "result" && event.data.bytes) resolve(event.data.bytes);
      else reject(new Error("OPTIMIZE_FAILED"));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("OPTIMIZE_FAILED"));
    };
    const copy = bytes.slice();
    worker.postMessage({ bytes: copy, quality }, [copy.buffer]);
  });
}
export interface Result {
  file: FileHandleInfo;
  status: "compressed" | "original" | "failed";
  outputSize?: number;
  saved?: FileHandleInfo;
  folder?: FolderHandleInfo;
}
export async function loadOptions(deck: Deck): Promise<Options> {
  try {
    const stored = await deck.storage.get<Options>("pdf-compression");
    if (stored) {
      validate(stored);
      return stored;
    }
  } catch {
    return DEFAULT_OPTIONS;
  }
  return DEFAULT_OPTIONS;
}
export async function readBytes(deck: Deck, file: FileHandleInfo, signal: AbortSignal): Promise<Uint8Array> {
  if (file.size > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
export function serialize(pages: RasterPage[], signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("CANCELLED"));
      return;
    }
    const worker = new Worker(new URL("./write.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("CANCELLED"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("PDF_TIMEOUT"));
    }, 90_000);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; bytes?: Uint8Array }>) => {
      cleanup();
      if (event.data.ok && event.data.bytes) resolve(event.data.bytes);
      else reject(new Error("WRITE_FAILED"));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("WRITE_FAILED"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.postMessage(
      pages,
      pages.map((p) => p.image.buffer),
    );
  });
}
export async function compress(
  bytes: Uint8Array,
  options: Options,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  validate(options);
  if (options.mode !== "raster") return optimizeInWorker(bytes, options.quality, signal, progress);
  const doc = await openPdf(bytes, signal);
  const images: RasterPage[] = [];
  let total = 0;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      if (signal.aborted) throw new Error("CANCELLED");
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const blob = await renderPage(page, options.dpi, [], signal, options.quality / 100);
      page.cleanup();
      total += blob.size;
      if (total > MAX_OUTPUT) throw new Error("OUTPUT_TOO_LARGE");
      images.push({
        image: new Uint8Array(await blob.arrayBuffer()),
        width: viewport.width,
        height: viewport.height,
        mime: "image/jpeg",
      });
      progress(i, doc.numPages);
    }
    const output = await serialize(images, signal);
    const check = await openPdf(output, signal, MAX_OUTPUT);
    try {
      if (check.numPages !== doc.numPages) throw new Error("PAGE_COUNT_CHANGED");
      for (let i = 1; i <= check.numPages; i++) {
        const p = await check.getPage(i);
        const image = images[i - 1];
        const view = p.getViewport({ scale: 1 });
        if (!image || Math.abs(view.width - image.width) > 0.01 || Math.abs(view.height - image.height) > 0.01)
          throw new Error("PAGE_SIZE_CHANGED");
        p.cleanup();
      }
    } finally {
      await check.loadingTask.destroy();
    }
    return output;
  } finally {
    await doc.loadingTask.destroy();
  }
}
export async function runBatch(
  deck: Deck,
  files: readonly FileHandleInfo[],
  parentHandle: string,
  options: Options,
  signal: AbortSignal,
  progress: (results: Result[], done: number, total: number) => void,
  encoder = compress,
): Promise<{ results: Result[]; folder: FolderHandleInfo | null }> {
  validate(options);
  if (signal.aborted) return { results: [], folder: null };
  const batch = await deck.fs.createOutputFolder({ parentHandle, suggestedName: "압축 PDF" });
  const results: Result[] = [];
  try {
    for (const file of files) {
      if (signal.aborted) break;
      try {
        const original = await readBytes(deck, file, signal);
        const compressed = await encoder(original, options, signal, (done, total) =>
          progress([...results], done, total),
        );
        const chosen = choose(original, compressed);
        const saved = await deck.fs.writeBlob(
          {
            batchId: batch.batchId,
            suggestedName: outputName(file.name),
            blob: new Blob([new Uint8Array(chosen.bytes)], { type: "application/pdf" }),
          },
          { signal },
        );
        results.push({
          file,
          status: chosen.keptOriginal ? "original" : "compressed",
          outputSize: saved.size,
          saved,
          folder: batch.folder,
        });
      } catch {
        if (signal.aborted) break;
        results.push({ file, status: "failed", folder: batch.folder });
      }
      progress([...results], 0, 0);
    }
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId }).catch(() => undefined);
  }
  return { results, folder: batch.folder };
}
