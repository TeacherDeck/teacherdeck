// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  VerbosityLevel,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { MAX_BYTES, MAX_PAGES, MAX_PIXELS, type PageInfo, type Rect, type TextBox } from "./pdf-geometry.ts";
import { checkSourceImagesInWorker } from "./source-check-client.ts";
GlobalWorkerOptions.workerSrc = workerUrl;
export async function openPdf(bytes: Uint8Array, signal: AbortSignal, maxBytes = MAX_BYTES): Promise<PDFDocumentProxy> {
  if (signal.aborted) throw new Error("CANCELLED");
  if (bytes.length > maxBytes || !new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-"))
    throw new Error("INVALID_PDF");
  await checkSourceImagesInWorker(bytes, MAX_PIXELS, signal);
  if (signal.aborted) throw new Error("CANCELLED");
  const base = new URL("./pdf-assets/", document.baseURI).href;
  const loading = getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    verbosity: VerbosityLevel.ERRORS,
    stopAtErrors: true,
    enableXfa: false,
    disableFontFace: true,
    maxImageSize: MAX_PIXELS,
    canvasMaxAreaInBytes: MAX_PIXELS * 4,
  });
  const abort = () => {
    void loading.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("CANCELLED");
    const doc = await loading.promise;
    if (signal.aborted) {
      await doc.loadingTask.destroy();
      throw new Error("CANCELLED");
    }
    if (doc.numPages > MAX_PAGES) {
      await doc.loadingTask.destroy();
      throw new Error("TOO_MANY_PAGES");
    }
    return doc;
  } catch (error) {
    await loading.destroy();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export async function pageInfo(page: PDFPageProxy): Promise<PageInfo> {
  const view = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const boxes: TextBox[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const transform = Util.transform(view.transform, item.transform);
    const x = transform[4] ?? 0;
    const y = transform[5] ?? 0;
    const angle = Math.atan2(transform[1] ?? 0, transform[0] ?? 1);
    const dx = Math.cos(angle) * item.width;
    const dy = Math.sin(angle) * item.width;
    const upX = transform[2] ?? 0;
    const upY = transform[3] ?? 0;
    const fontStyle = content.styles[item.fontName];
    const ascent = Math.max(1.1, fontStyle?.ascent ?? 1.1);
    const descent = Math.min(-0.35, fontStyle?.descent ?? -0.35);
    const xs = [x + upX * ascent, x + dx + upX * ascent, x + upX * descent, x + dx + upX * descent];
    const ys = [y + upY * ascent, y + dy + upY * ascent, y + upY * descent, y + dy + upY * descent];
    boxes.push({
      text: item.str,
      x: Math.max(0, Math.min(...xs) - 1),
      y: Math.max(0, Math.min(...ys) - 1),
      width: Math.max(...xs) - Math.min(...xs) + 2,
      height: Math.max(...ys) - Math.min(...ys) + 2,
    });
  }
  return { number: page.pageNumber, width: view.width, height: view.height, boxes };
}
export async function renderPage(
  page: PDFPageProxy,
  dpi: number,
  rects: readonly Rect[],
  signal: AbortSignal,
  quality?: number,
): Promise<Blob> {
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (width * height > MAX_PIXELS || width > 16384 || height > 16384) throw new Error("PAGE_TOO_LARGE");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CANVAS_UNAVAILABLE");
  // PDF.js paints the page background; preserve the Canvas default black for pixel erasure.
  context.save();
  const task = page.render({ canvasContext: context, canvas, viewport });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new Error("CANCELLED");
    await task.promise;
    context.restore();
    for (const rect of rects) {
      const x = Math.max(0, Math.floor(rect.x * scale) - 2);
      const y = Math.max(0, Math.floor(rect.y * scale) - 2);
      context.fillRect(
        x,
        y,
        Math.ceil((rect.x + rect.width) * scale) + 2 - x,
        Math.ceil((rect.y + rect.height) * scale) + 2 - y,
      );
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("ENCODE_FAILED"))),
        quality === undefined ? "image/png" : "image/jpeg",
        quality,
      ),
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = 0;
    canvas.height = 0;
  }
}
