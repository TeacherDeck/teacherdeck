// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { writeFreshPdf } from "./writer.ts";
const png = new Uint8Array(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);
describe("fresh raster-only PDF", () => {
  it("reopens pages at exact sizes without forms, attachments, source objects or metadata", async () => {
    const bytes = await writeFreshPdf([
      { image: png, width: 600, height: 800, mime: "image/png" },
      { image: png, width: 800, height: 600, mime: "image/png" },
    ]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(doc.getPage(1).getSize()).toEqual({ width: 800, height: 600 });
    for (const key of ["Names", "AcroForm", "Metadata", "OpenAction", "AA"])
      expect(doc.catalog.get(PDFName.of(key))).toBeUndefined();
    expect(doc.context.trailerInfo.Info).toBeUndefined();
    for (const page of doc.getPages()) expect(page.node.get(PDFName.of("Annots"))).toBeUndefined();
    const streams = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object.toString())
      .join("\n");
    expect(streams).toContain("/Subtype /Image");
    expect(streams).not.toContain("/Font");
    expect(streams).not.toContain("/EmbeddedFile");
  });
  it("rejects invalid output geometry rather than producing a partial result", async () => {
    await expect(writeFreshPdf([])).rejects.toThrow("INVALID_PAGES");
    await expect(writeFreshPdf([{ image: png, width: NaN, height: 100, mime: "image/png" }])).rejects.toThrow(
      "INVALID_PAGE_SIZE",
    );
  });
});
