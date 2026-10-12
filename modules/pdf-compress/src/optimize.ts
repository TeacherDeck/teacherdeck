// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from "pdf-lib";
import { MAX_BYTES, MAX_PAGES, MAX_PIXELS, MAX_OUTPUT } from "./pdf-geometry.ts";
import { canReencodeJpeg } from "./jpeg.ts";
export type Reencode = (bytes: Uint8Array, width: number, height: number, quality: number) => Promise<Uint8Array>;
function containsSignature(object: PDFObject, depth = 0): boolean {
  if (depth > 32) return true;
  if (object instanceof PDFRawStream) return containsSignature(object.dict, depth + 1);
  if (object instanceof PDFDict) {
    if (object.get(PDFName.of("Type")) === PDFName.of("Sig") || object.has(PDFName.of("ByteRange"))) return true;
    return object.values().some((value) => containsSignature(value, depth + 1));
  }
  if (object instanceof PDFArray) return object.asArray().some((value) => containsSignature(value, depth + 1));
  return false;
}

/** Preserve page content streams and document structure; only replace supported RGB JPEG streams. */
export async function optimize(
  bytes: Uint8Array,
  quality: number,
  reencode: Reencode,
  progress: (done: number, total: number) => void = () => undefined,
): Promise<Uint8Array> {
  if (bytes.length > MAX_BYTES || !Number.isInteger(quality) || quality < 30 || quality > 100)
    throw new Error("INVALID_INPUT");
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (doc.getPageCount() > MAX_PAGES) throw new Error("TOO_MANY_PAGES");
  const objects = doc.context.enumerateIndirectObjects();
  // pdf-lib's fallback stream parser can stop at an embedded "endstream" when
  // /Length is indirect. Check the original declarations immediately after load:
  // serializing a stream (including toString/sizeInBytes) replaces /Length and
  // would hide that truncation. Unresolved or inconsistent streams stay original.
  for (const [, object] of objects) {
    if (!(object instanceof PDFRawStream)) continue;
    const length = object.dict.lookup(PDFName.of("Length"));
    if (
      !(length instanceof PDFNumber) ||
      !Number.isSafeInteger(length.asNumber()) ||
      length.asNumber() < 0 ||
      length.asNumber() !== object.getContents().length
    )
      return bytes;
  }
  // Rewriting a signed PDF invalidates the signature. Keep it byte-for-byte instead.
  if (objects.some(([, object]) => containsSignature(object))) return bytes;
  const images = objects.filter(
    ([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
  );
  for (const [index, [ref, object]] of images.entries()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    const width = dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS)
      throw new Error("SOURCE_IMAGE_TOO_LARGE");
    const supported =
      dict.get(PDFName.of("Filter")) === PDFName.of("DCTDecode") &&
      dict.get(PDFName.of("ColorSpace")) === PDFName.of("DeviceRGB") &&
      dict.lookupMaybe(PDFName.of("BitsPerComponent"), PDFNumber)?.asNumber() === 8 &&
      !["Decode", "DecodeParms", "Mask", "SMask", "ImageMask", "Alternates"].some((key) => dict.has(PDFName.of(key)));
    if (supported && canReencodeJpeg(object.getContents(), width, height)) {
      const input = object.getContents();
      const output = await reencode(input, width, height, quality);
      if (output.length < input.length) {
        const next = dict.clone(doc.context);
        next.set(PDFName.of("Length"), PDFNumber.of(output.length));
        doc.context.assign(ref, PDFRawStream.of(next, output));
      }
    }
    progress(index + 1, images.length);
  }
  const output = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  if (output.length > MAX_OUTPUT) throw new Error("OUTPUT_TOO_LARGE");
  return output;
}
