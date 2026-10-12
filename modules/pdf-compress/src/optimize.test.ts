// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFRawStream, PDFRef, PDFStream, PDFString, StandardFonts } from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { expect, it, vi } from "vitest";
import { optimize } from "./optimize.ts";
import { contentFixture, jpegFixture } from "./integrity-fixtures.ts";

async function extractText(bytes: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    return (await page.getTextContent()).items.flatMap((item) => ("str" in item ? [item.str] : []));
  } finally {
    await task.destroy();
  }
}

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
  const { original: jpeg, replacement } = jpegFixture();
  const image = await doc.embedJpg(jpeg);
  page.drawImage(image, { x: 20, y: 20, width: 40, height: 40 });
  const ref = image.ref;
  const original = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
  const before = await PDFDocument.load(original, { updateMetadata: false });
  const encode = vi.fn(async () => replacement);
  const output = await optimize(original, 82, encode);
  const after = await PDFDocument.load(output, { updateMetadata: false });
  expect(encode).toHaveBeenCalledWith(jpeg, 2, 2, 82);
  expect(after.context.lookup(ref, PDFStream).getContents()).toEqual(replacement);
  expect(after.getTitle()).toBe("Synthetic document");
  expect(after.getForm().getTextField("synthetic-field").getText()).toBe("SYNTHETIC VALUE");
  expect(after.getPage(0).node.toString()).toBe(before.getPage(0).node.toString());
  expect(after.catalog.toString()).toBe(before.catalog.toString());
  for (const [id, object] of before.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && id.toString() !== ref.toString())
      expect(after.context.lookup(id, PDFStream).getContents()).toEqual(object.getContents());
  }
  expect(await extractText(output)).toEqual(await extractText(original));
  for (const bytes of [original, output]) {
    const task = getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
    try {
      const rendered = await task.promise;
      const renderedPage = await rendered.getPage(1);
      const operators = await renderedPage.getOperatorList();
      expect(operators.fnArray).toContain(OPS.paintImageXObject);
      const imageAt = operators.fnArray.indexOf(OPS.paintImageXObject);
      const decoded: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } = renderedPage.objs.get(
        operators.argsArray[imageAt][0],
      );
      expect(decoded.width).toBe(2);
      expect(decoded.height).toBe(2);
      expect(decoded.data.length).toBeGreaterThanOrEqual(12);
    } finally {
      await task.destroy();
    }
  }
});

it("keeps the original when indirect Length parsing truncates an embedded endstream", async () => {
  const { bytes, content } = contentFixture("BEFORE endstream AFTER", "indirect", "\n");
  const baseline = await extractText(bytes);
  expect(baseline.filter(Boolean)).toEqual(["BEFORE endstream AFTER", "TAIL TEXT MUST SURVIVE"]);
  const parsed = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  expect(parsed.context.lookup(PDFRef.of(5), PDFStream).getContents().length).toBeLessThan(content.length);
  const encode = vi.fn(async () => new Uint8Array());
  const output = await optimize(bytes, 82, encode);
  expect(output).toBe(bytes);
  expect(encode).not.toHaveBeenCalled();
  expect(await extractText(output)).toEqual(baseline);
});

it.each([
  ["direct", "BEFORE endstream AFTER"],
  ["indirect", "BEFORE ordinary AFTER"],
] as const)("optimizes intact %s Length streams while preserving independently decoded text", async (length, text) => {
  const { bytes, content } = contentFixture(text, length);
  const output = await optimize(bytes, 82, async () => new Uint8Array());
  expect(output).not.toBe(bytes);
  expect(output.length).toBeLessThan(bytes.length);
  expect(await extractText(output)).toEqual(await extractText(bytes));
  const after = await PDFDocument.load(output, { updateMetadata: false });
  expect(after.context.lookup(PDFRef.of(5), PDFStream).getContents()).toEqual(content);
});

it.each(["missing", "unresolved", "wrong-type"] as const)(
  "keeps original streams with %s Length declarations",
  async (length) => {
    const { bytes } = contentFixture("SYNTHETIC TEXT", length);
    expect(await optimize(bytes, 82, async () => new Uint8Array())).toBe(bytes);
  },
);

it.each([
  ["direct", -1],
  ["direct", 2],
  ["indirect", -1],
  ["indirect", 1],
  ["indirect", 0.5],
  ["indirect", -1000],
  ["indirect", Number.MAX_SAFE_INTEGER],
] as const)("keeps original %s streams with a Length mismatch of %s", async (length, adjustment) => {
  const { bytes } = contentFixture("SYNTHETIC TEXT", length, "", adjustment);
  expect(await optimize(bytes, 82, async () => new Uint8Array())).toBe(bytes);
});

it("keeps a valid indirect stream when fallback parsing omits its final payload newline", async () => {
  const { bytes } = contentFixture("SYNTHETIC TEXT", "indirect", "\n", 0, "");
  expect(await optimize(bytes, 82, async () => new Uint8Array())).toBe(bytes);
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
