// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { MAX_BYTES, MAX_OUTPUT, outputName, type Candidate, type PageInfo } from "./logic.ts";
import { openPdf, pageInfo, renderPage } from "./pdf.ts";
import type { RasterPage } from "./writer.ts";
export interface Input {
  file: FileHandleInfo;
  doc: PDFDocumentProxy;
  pages: PageInfo[];
}
export async function readFile(
  deck: Deck,
  file: FileHandleInfo,
  signal: AbortSignal,
  max = MAX_BYTES,
): Promise<Uint8Array> {
  if (file.size > max) throw new Error("INPUT_TOO_LARGE");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    length += chunk.length;
    if (length > max) throw new Error("INPUT_TOO_LARGE");
    chunks.push(chunk);
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}
export async function readInput(
  deck: Deck,
  file: FileHandleInfo,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Input> {
  const doc = await openPdf(await readFile(deck, file, signal), signal);
  const pages: PageInfo[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      if (signal.aborted) throw new Error("CANCELLED");
      const page = await doc.getPage(number);
      pages.push(await pageInfo(page));
      page.cleanup();
      progress(number, doc.numPages);
    }
    return { file, doc, pages };
  } catch (error) {
    await doc.loadingTask.destroy();
    throw error;
  }
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
export async function redact(
  input: Input,
  candidates: readonly Candidate[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<Blob> {
  const images: RasterPage[] = [];
  let size = 0;
  for (const info of input.pages) {
    if (signal.aborted) throw new Error("CANCELLED");
    const page = await input.doc.getPage(info.number);
    const blob = await renderPage(
      page,
      200,
      candidates.filter((c) => c.selected && c.page === info.number).map((c) => c.rect),
      signal,
    );
    page.cleanup();
    size += blob.size;
    if (size > MAX_OUTPUT) throw new Error("OUTPUT_TOO_LARGE");
    images.push({
      image: new Uint8Array(await blob.arrayBuffer()),
      width: info.width,
      height: info.height,
      mime: "image/png",
    });
    progress(info.number, input.pages.length);
  }
  const bytes = await serialize(images, signal);
  const check = await openPdf(bytes, signal, MAX_OUTPUT);
  try {
    if (check.numPages !== input.pages.length) throw new Error("VERIFICATION_FAILED");
    const attachments = await check.getAttachments();
    const metadata = await check.getMetadata();
    const fields = await check.getFieldObjects();
    const info = metadata.info as Record<string, unknown>;
    if (
      (attachments?.size ?? 0) > 0 ||
      (fields?.size ?? 0) > 0 ||
      metadata.metadata ||
      ["Title", "Author", "Subject", "Keywords"].some((key) => info[key])
    )
      throw new Error("HIDDEN_CONTENT_REMAINS");
    for (let i = 1; i <= check.numPages; i++) {
      if (signal.aborted) throw new Error("CANCELLED");
      const page = await check.getPage(i);
      const text = await page.getTextContent();
      const annotations = await page.getAnnotations();
      if (text.items.some((item) => "str" in item && item.str.trim()) || annotations.length)
        throw new Error("CONTENT_REMAINS");
      page.cleanup();
    }
  } finally {
    await check.loadingTask.destroy();
  }
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
}
export async function saveResult(
  deck: Deck,
  input: Input,
  blob: Blob,
  signal: AbortSignal,
): Promise<{ folder: FolderHandleInfo; saved: FileHandleInfo } | null> {
  const parent = await deck.fs.pickFolder();
  if (!parent || signal.aborted) return null;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "개인정보 제거 PDF" });
  try {
    const saved = await deck.fs.writeBlob(
      { batchId: batch.batchId, suggestedName: outputName(input.file.name), blob },
      { signal },
    );
    return { folder: batch.folder, saved };
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId }).catch(() => undefined);
  }
}
