// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { choose, validate, outputName } from "./logic.ts";
describe("PDF compression result", () => {
  it("keeps original bytes if a rewrite increases or keeps the file size", () => {
    const original = new Uint8Array([1, 2, 3]);
    expect(choose(original, new Uint8Array(4))).toEqual({ bytes: original, keptOriginal: true });
    expect(choose(original, new Uint8Array(3)).bytes).toBe(original);
    expect(choose(original, new Uint8Array(2)).keptOriginal).toBe(false);
  });
  it("validates quality and resolution bounds without changing the source suffix", () => {
    validate({ dpi: 120, quality: 82 });
    expect(() => validate({ dpi: 30, quality: 80 })).toThrow("INVALID_OPTIONS");
    expect(() => validate({ dpi: 120, quality: NaN })).toThrow("INVALID_OPTIONS");
    expect(outputName("합성.PDF")).toBe("합성_compressed.pdf");
  });
});
