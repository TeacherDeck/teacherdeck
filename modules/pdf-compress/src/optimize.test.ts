// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFRawStream, PDFStream, PDFString, StandardFonts } from "pdf-lib";
import { expect, it, vi } from "vitest";
import { optimize } from "./optimize.ts";

it("preserves page content, annotations, forms, attachments and metadata while replacing a JPEG stream", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  page.drawText("SYNTHETIC searchable text", { font: await doc.embedFont(StandardFonts.Helvetica), size: 12 });
  doc.setTitle("Synthetic document");
  doc.getForm().createTextField("synthetic-field").setText("SYNTHETIC VALUE");
  await doc.attach(new Uint8Array([1, 2, 3]), "synthetic.txt");
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [0, 0, 10, 10],
    A: { S: "URI", URI: PDFString.of("https://example.invalid") },
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annotation)]));
  const jpeg = new Uint8Array(100);
  jpeg.set([255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218]);
  const image = doc.context.stream(jpeg, {
    Type: "XObject",
    Subtype: "Image",
    Filter: "DCTDecode",
    ColorSpace: "DeviceRGB",
    Width: 2,
    Height: 2,
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(image);
  const original = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  const before = await PDFDocument.load(original, { updateMetadata: false });
  const encode = vi.fn(async () => new Uint8Array([7, 8, 9]));
  const output = await optimize(original, 82, encode);
  const after = await PDFDocument.load(output, { updateMetadata: false });
  expect(encode).toHaveBeenCalledWith(jpeg, 2, 2, 82);
  expect(after.context.lookup(ref, PDFStream).getContents()).toEqual(new Uint8Array([7, 8, 9]));
  expect(after.getTitle()).toBe("Synthetic document");
  expect(after.getForm().getTextField("synthetic-field").getText()).toBe("SYNTHETIC VALUE");
  expect(after.getPage(0).node.toString()).toBe(before.getPage(0).node.toString());
  expect(after.catalog.toString()).toBe(before.catalog.toString());
  for (const [id, object] of before.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && id.toString() !== ref.toString())
      expect(after.context.lookup(id, PDFStream).getContents()).toEqual(object.getContents());
  }
});
it("preserves special image streams and signed PDFs without decoding or rewriting", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const image = doc.context.stream(new Uint8Array([1, 2]), {
    Subtype: "Image",
    Filter: "DCTDecode",
    ColorSpace: "DeviceCMYK",
    Width: 1,
    Height: 1,
    BitsPerComponent: 8,
  });
  const ref = doc.context.register(image),
    encode = vi.fn(async () => new Uint8Array([3]));
  const rewritten = await PDFDocument.load(await optimize(await doc.save(), 82, encode));
  expect(rewritten.context.lookup(ref, PDFStream).getContents()).toEqual(new Uint8Array([1, 2]));
  expect(encode).not.toHaveBeenCalled();
  doc.catalog.set(
    PDFName.of("SyntheticSignature"),
    doc.context.obj({ Nested: { Type: "Sig", ByteRange: [0, 1, 2, 3] } }),
  );
  const signed = await doc.save();
  expect(await optimize(signed, 82, encode)).toBe(signed);
});
