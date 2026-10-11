// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { expect, it } from "vitest";
import { checkSourceImages } from "./source-check.ts";
it("checks source image dimensions without decoding and rejects oversized XObjects", async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const image = doc.context.stream(new Uint8Array([0]), {
    Type: "XObject",
    Subtype: "Image",
    Width: 5000,
    Height: 5000,
    BitsPerComponent: 8,
    ColorSpace: "DeviceGray",
  });
  doc.context.register(image);
  await expect(checkSourceImages(await doc.save(), 24_000_000)).rejects.toThrow("SOURCE_IMAGE_TOO_LARGE");
  expect(image).toBeInstanceOf(PDFRawStream);
  image.dict.set(PDFName.of("Width"), PDFNumber.of(1));
  image.dict.set(PDFName.of("Height"), PDFNumber.of(1));
  await expect(checkSourceImages(await doc.save(), 24_000_000)).resolves.toBeUndefined();
});
