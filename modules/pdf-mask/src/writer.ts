// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFRef, PDFDict } from "pdf-lib";
import { MAX_OUTPUT, MAX_PAGES } from "./logic.ts";
export interface RasterPage {
  image: Uint8Array;
  width: number;
  height: number;
  mime: "image/png" | "image/jpeg";
}
export async function writeFreshPdf(pages: readonly RasterPage[]): Promise<Uint8Array> {
  if (!pages.length || pages.length > MAX_PAGES) throw new Error("INVALID_PAGES");
  const doc = await PDFDocument.create();
  // Only already erased raster bytes enter this document. Source PDF pages are never copied.
  for (const page of pages) {
    if (
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height) ||
      page.width <= 0 ||
      page.height <= 0 ||
      page.width > 16384 ||
      page.height > 16384
    )
      throw new Error("INVALID_PAGE_SIZE");
    const image = page.mime === "image/png" ? await doc.embedPng(page.image) : await doc.embedJpg(page.image);
    const output = doc.addPage([page.width, page.height]);
    output.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
    output.node.delete(PDFName.of("Annots"));
    const resources = output.node.Resources();
    for (const key of ["Font", "ExtGState"]) {
      const resource = resources?.lookup(PDFName.of(key));
      if (resource instanceof PDFDict && resource.keys().length === 0) resources?.delete(PDFName.of(key));
    }
  }
  doc.catalog.delete(PDFName.of("Metadata"));
  const info = doc.context.trailerInfo.Info;
  if (info instanceof PDFRef) doc.context.delete(info);
  delete doc.context.trailerInfo.Info;
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  if (bytes.length > MAX_OUTPUT) throw new Error("OUTPUT_TOO_LARGE");
  return bytes;
}
