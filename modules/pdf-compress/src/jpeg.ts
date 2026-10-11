// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
/** Only decode plain 8-bit RGB JPEGs. Browser EXIF/ICC conversion must not alter PDF image interpretation. */
export function canReencodeJpeg(bytes: Uint8Array, width: number, height: number): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let at = 2,
    frame = false;
  while (at < bytes.length) {
    if (bytes[at++] !== 0xff) return false;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda) return frame;
    if (marker === undefined || marker === 0 || marker === 0xd9 || marker === 0xd8) return false;
    if ([0xe1, 0xe2, 0xee].includes(marker)) return false;
    const length = ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
    if (length < 2 || at + length > bytes.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (![0xc0, 0xc2].includes(marker) || length < 17 || bytes[at + 2] !== 8 || bytes[at + 7] !== 3) return false;
      const h = ((bytes[at + 3] ?? 0) << 8) | (bytes[at + 4] ?? 0);
      const w = ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0);
      if (w !== width || h !== height) return false;
      frame = true;
    }
    at += length;
  }
  return false;
}
