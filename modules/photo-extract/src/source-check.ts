// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFNumber, PDFStream } from "pdf-lib";
export async function checkSourceImages(bytes: Uint8Array, maxPixels: number): Promise<void> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, object] of source.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFStream) || object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
    const width = object.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = object.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width * height > maxPixels
    )
      throw new Error("SOURCE_IMAGE_TOO_LARGE");
  }
}
