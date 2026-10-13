// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo, RenamePlan, RenameResult, RenameHistory } from "@deck/sdk";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { metadataFrom, type Entry, type Metadata, type Preview } from "./logic.ts";
import { hwpxText, workbook, workbookTemplate, type Parts, type Workbook } from "./workbook.ts";
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
export async function bytes(deck: Deck, file: FileHandleInfo, signal: AbortSignal): Promise<Uint8Array> {
  if (file.size > 32 * 1024 * 1024) throw new Error("INPUT_LIMIT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    size += chunk.length;
    if (size > 32 * 1024 * 1024) throw new Error("INPUT_LIMIT");
    chunks.push(chunk);
  }
  const result = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
export function archiveRequest(
  input: Uint8Array,
  kind: "hwp" | "zip",
  signal: AbortSignal,
): Promise<{ parts?: Parts; text?: string }> {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module" });
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
      reject(new Error("ANALYSIS_TIMEOUT"));
    }, 90000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("ANALYSIS_FAILED"));
    };
    worker.onmessage = (event: MessageEvent<{ parts?: Parts; text?: string; error?: string }>) => {
      cleanup();
      if (event.data.error) reject(new Error("ANALYSIS_FAILED"));
      else resolve(event.data);
    };
    const copy = input.slice();
    worker.postMessage({ bytes: copy, kind }, [copy.buffer]);
  });
}
export async function readWorkbook(deck: Deck, file: FileHandleInfo, signal: AbortSignal): Promise<Workbook> {
  const result = await archiveRequest(await bytes(deck, file, signal), "zip", signal);
  if (!result.parts) throw new Error("INVALID_WORKBOOK");
  return workbook(result.parts, signal);
}
export async function analyze(deck: Deck, entry: Entry, keywords: string[], signal: AbortSignal): Promise<Metadata> {
  let text = "";
  const input = await bytes(deck, entry.file, signal);
  if (entry.file.ext === "pdf") {
    const assetBase = new URL("./pdf-assets/", document.baseURI).href;
    const loading = getDocument({
      data: input,
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
      iccUrl: `${assetBase}iccs/`,
      disableFontFace: true,
      maxImageSize: 24000000,
      canvasMaxAreaInBytes: 96000000,
      stopAtErrors: true,
    });
    const abort = () => {
      void loading.destroy();
    };
    signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 90000);
    try {
      const pdf = await loading.promise;
      for (let i = 1; i <= Math.min(3, pdf.numPages); i++) {
        if (signal.aborted) throw new Error("CANCELLED");
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
        if (text.length > 4000) break;
      }
      return metadataFrom(text, entry.file.name, keywords);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      await loading.destroy();
    }
  } else if (entry.file.ext === "hwp") {
    text = (await archiveRequest(input, "hwp", signal)).text ?? "";
  } else if (entry.file.ext === "hwpx") {
    const parts = (await archiveRequest(input, "zip", signal)).parts;
    if (parts) text = await hwpxText(parts, signal);
  } else if (["txt", "csv"].includes(entry.file.ext)) {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input).slice(0, 4000);
  } else throw new Error("UNSUPPORTED_DOCUMENT");
  return metadataFrom(text, entry.file.name, keywords);
}
export async function folderFiles(deck: Deck, recursive: boolean, signal: AbortSignal): Promise<FileHandleInfo[]> {
  const folder = await deck.fs.pickFolder();
  if (!folder) return [];
  const files: FileHandleInfo[] = [];
  let cursor: string | undefined;
  do {
    if (signal.aborted) throw new Error("CANCELLED");
    const page = await deck.fs.listFiles({
      folderHandle: folder.handle,
      recursive,
      ...(cursor ? { cursor } : {}),
      limit: 128,
    });
    files.push(...page.files);
    cursor = page.nextCursor;
  } while (cursor);
  if (signal.aborted) throw new Error("CANCELLED");
  return files;
}
export interface CopyResult {
  source: string;
  name: string;
  status: "success" | "failed" | "notStarted";
  saved?: FileHandleInfo;
  folder?: FolderHandleInfo;
}
export async function copyBatch(
  deck: Deck,
  rows: Preview[],
  signal: AbortSignal,
  progress: (results: CopyResult[]) => void,
  previous: CopyResult[] = [],
  parentHandle?: string,
): Promise<{ results: CopyResult[]; folder?: FolderHandleInfo; cancelled?: boolean }> {
  const results: CopyResult[] = rows.map(
    (row) =>
      previous.find((result) => result.source === row.entry.file.handle && result.status === "success") ?? {
        source: row.entry.file.handle,
        name: row.name,
        status: "notStarted",
      },
  );
  if (signal.aborted) return { results: previous.length ? previous : results };
  let folder: FolderHandleInfo | undefined;
  for (const [index, row] of rows.entries()) {
    if (signal.aborted) break;
    if (results[index]?.status === "success") continue;
    let writeId: string | undefined;
    let batch: Awaited<ReturnType<Deck["fs"]["openOutputFolder"]>> | undefined;
    try {
      batch = await deck.fs.openOutputFolder(parentHandle ? { parentHandle } : { sourceHandle: row.entry.file.handle });
      folder = batch.folder;
      if (signal.aborted) throw new Error("CANCELLED");
      const write = await deck.fs.beginWrite({
        batchId: batch.batchId,
        suggestedName: row.name,
        size: row.entry.file.size,
      });
      writeId = write.writeId;
      let offset = 0;
      for await (const chunk of deck.fs.readChunks({ handle: row.entry.file.handle }, { signal })) {
        if (signal.aborted) throw new Error("CANCELLED");
        for (let at = 0; at < chunk.length; at += write.chunkBytes) {
          const response = await deck.fs.writeChunk({
            writeId,
            offset,
            data: Array.from(chunk.subarray(at, at + write.chunkBytes)),
          });
          offset = response.nextOffset;
        }
      }
      if (signal.aborted) throw new Error("CANCELLED");
      const saved = await deck.fs.commitWrite({ writeId });
      writeId = undefined;
      results[index] = {
        source: row.entry.file.handle,
        name: saved.name,
        status: "success",
        saved,
        folder: batch.folder,
      };
    } catch {
      results[index] = {
        source: row.entry.file.handle,
        name: row.name,
        status: signal.aborted ? "notStarted" : "failed",
      };
    } finally {
      if (writeId)
        try {
          await deck.fs.abortWrite({ writeId });
        } catch {
          /* Host-owned unfinished output remains recoverable. */
        }
      if (batch) await deck.fs.closeOutputFolder({ batchId: batch.batchId }).catch(() => undefined);
    }
    progress([...results]);
    if (signal.aborted) break;
  }
  return { results, ...(folder ? { folder } : {}) };
}
export class RenamePlanExpired extends Error {
  readonly partial: RenameResult | undefined;
  constructor(partial: RenameResult | undefined) {
    super("RENAME_PLAN_EXPIRED");
    this.partial = partial;
  }
}
export async function renameBatch(
  deck: Deck,
  plan: RenamePlan,
  signal: AbortSignal,
  progress: (result: RenameResult) => void,
): Promise<RenameResult | undefined> {
  let result: RenameResult | undefined;
  do {
    if (signal.aborted) break;
    // Check before every group: an expired plan cannot be continued or automatically retried.
    if (Date.now() >= plan.expiresAt) throw new RenamePlanExpired(result);
    result = await deck.fileOps.executeRename({ planHandle: plan.planHandle });
    progress(result);
  } while (!result.done);
  return result;
}
export async function histories(deck: Deck): Promise<RenameHistory[]> {
  return (await deck.fileOps.listHistory({ limit: 20 })).entries;
}
export async function templateFile(deck: Deck, parentHandle?: string): Promise<void> {
  const destination = parentHandle ?? (await deck.fs.pickFolder())?.handle;
  if (!destination) return;
  const batch = await deck.fs.openOutputFolder({ parentHandle: destination });
  const input = workbookTemplate();
  let writeId: string | undefined;
  try {
    const write = await deck.fs.beginWrite({
      batchId: batch.batchId,
      suggestedName: "파일명 연결 양식.xlsx",
      size: input.length,
    });
    writeId = write.writeId;
    await deck.fs.writeChunk({ writeId, offset: 0, data: Array.from(input) });
    await deck.fs.commitWrite({ writeId });
    writeId = undefined;
  } finally {
    if (writeId) await deck.fs.abortWrite({ writeId });
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
}
