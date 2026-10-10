// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Same encoded-header checks as the independent compression tool, with a lower crop memory bound.
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_PIXELS = 24_000_000;
export interface ImageHeader {
  width: number;
  height: number;
  mime: string;
  ext: string;
}
export function dimensions(width: number, height: number, maxEdge: number) {
  if (
    ![width, height, maxEdge].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    maxEdge < 1 ||
    width * height > MAX_PIXELS
  )
    throw new Error("INVALID_IMAGE");
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
/** Inspect encoded dimensions before allocating a decoded bitmap; reject animated/unknown containers. */
export function imageHeader(bytes: Uint8Array): ImageHeader {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("INVALID_IMAGE");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width = 0,
    height = 0,
    mime = "",
    ext = "";
  if (bytes.length >= 24 && ascii(1, 3) === "PNG" && bytes[0] === 137 && ascii(12, 4) === "IHDR") {
    width = view.getUint32(16);
    height = view.getUint32(20);
    mime = "image/png";
    ext = "png";
    // APNG would otherwise silently lose frames.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (ascii(offset + 4, 4) === "acTL") throw new Error("ANIMATED_IMAGE");
      if (length > bytes.length - offset - 12) throw new Error("INVALID_IMAGE");
      offset += 12 + length;
    }
  } else if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    mime = "image/webp";
    ext = "webp";
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true),
        kind = ascii(offset, 4),
        start = offset + 8;
      if (length > bytes.length - start) throw new Error("INVALID_IMAGE");
      if (kind === "ANIM" || kind === "ANMF") throw new Error("ANIMATED_IMAGE");
      if (kind === "VP8X" && length >= 10) {
        if ((bytes[start] ?? 0) & 2) throw new Error("ANIMATED_IMAGE");
        width = 1 + (bytes[start + 4] ?? 0) + ((bytes[start + 5] ?? 0) << 8) + ((bytes[start + 6] ?? 0) << 16);
        height = 1 + (bytes[start + 7] ?? 0) + ((bytes[start + 8] ?? 0) << 8) + ((bytes[start + 9] ?? 0) << 16);
      } else if (kind === "VP8 " && length >= 10 && ascii(start + 3, 3) === "\u009d\u0001\u002a") {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (kind === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset = start + length + (length & 1);
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = "image/jpeg";
    ext = "jpg";
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset] !== 0xff) throw new Error("INVALID_IMAGE");
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("INVALID_IMAGE");
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      ) {
        if (length < 8) throw new Error("INVALID_IMAGE");
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += length;
    }
  }
  dimensions(width, height, Math.max(width, height));
  return { width, height, mime, ext };
}
