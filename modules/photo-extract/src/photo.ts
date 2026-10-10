// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
/** Thumbnail admission only: original bytes are always kept, including unsupported formats. */
export function inspectPhoto(bytes: Uint8Array): { extension: string; mime: string; preview: boolean } {
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let extension = "bin",
    mime = "application/octet-stream",
    width = 0,
    height = 0;
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    extension = "png";
    mime = "image/png";
    if (bytes.length >= 24 && ascii(12, 4) === "IHDR") {
      width = view.getUint32(16);
      height = view.getUint32(20);
    }
  } else if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) {
    extension = "gif";
    mime = "image/gif";
    if (bytes.length >= 10) {
      width = view.getUint16(6, true);
      height = view.getUint16(8, true);
    }
  } else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    extension = "jpg";
    mime = "image/jpeg";
    // Bound marker scanning as well as pixels; unusually large metadata needs no thumbnail.
    for (let offset = 2; offset + 4 <= Math.min(bytes.length, 256 * 1024);) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      ) {
        if (length >= 8) {
          height = view.getUint16(offset + 3);
          width = view.getUint16(offset + 5);
        }
        break;
      }
      offset += length;
    }
  } else if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    extension = "webp";
    mime = "image/webp";
    for (let offset = 12; offset + 8 <= Math.min(bytes.length, 256 * 1024);) {
      const length = view.getUint32(offset + 4, true),
        kind = ascii(offset, 4),
        start = offset + 8;
      if (length > bytes.length - start) break;
      if (kind === "VP8X" && length >= 10) {
        width = 1 + (bytes[start + 4] ?? 0) + ((bytes[start + 5] ?? 0) << 8) + ((bytes[start + 6] ?? 0) << 16);
        height = 1 + (bytes[start + 7] ?? 0) + ((bytes[start + 8] ?? 0) << 8) + ((bytes[start + 9] ?? 0) << 16);
      } else if (
        kind === "VP8 " &&
        length >= 10 &&
        bytes[start + 3] === 157 &&
        bytes[start + 4] === 1 &&
        bytes[start + 5] === 42
      ) {
        width = view.getUint16(start + 6, true) & 0x3fff;
        height = view.getUint16(start + 8, true) & 0x3fff;
      } else if (kind === "VP8L" && length >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      if (width && height) break;
      offset = start + length + (length & 1);
    }
  }
  return {
    extension,
    mime,
    preview: width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16000000,
  };
}
