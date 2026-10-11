// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { canReencodeJpeg } from "./jpeg.ts";
const frame = [255, 192, 0, 17, 8, 0, 2, 0, 3, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 218];
it("limits decoding to matching plain RGB dimensions before bitmap allocation", () => {
  expect(canReencodeJpeg(new Uint8Array([255, 216, ...frame]), 3, 2)).toBe(true);
  expect(canReencodeJpeg(new Uint8Array([255, 216, ...frame]), 2, 3)).toBe(false);
  expect(canReencodeJpeg(new Uint8Array([255, 216, 255, 224, 255, 255, ...frame]), 3, 2)).toBe(false);
});
it("preserves EXIF orientation, ICC and Adobe-transform image bytes by excluding them from reencoding", () => {
  for (const orientation of [3, 6])
    expect(
      canReencodeJpeg(
        new Uint8Array([255, 216, 255, 225, 0, 10, 69, 120, 105, 102, 0, 0, orientation, 0, ...frame]),
        3,
        2,
      ),
    ).toBe(false);
  for (const marker of [226, 238])
    expect(canReencodeJpeg(new Uint8Array([255, 216, 255, marker, 0, 4, 0, 0, ...frame]), 3, 2)).toBe(false);
});
