// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Options {
  mode?: "preserve" | "raster";
  dpi: number;
  quality: number;
}
export const DEFAULT_OPTIONS: Options = { mode: "preserve", dpi: 120, quality: 82 };
export function validate(options: Options): void {
  if (
    (options.mode !== undefined && options.mode !== "preserve" && options.mode !== "raster") ||
    !Number.isInteger(options.dpi) ||
    options.dpi < 72 ||
    options.dpi > 300 ||
    !Number.isInteger(options.quality) ||
    options.quality < 30 ||
    options.quality > 100
  )
    throw new Error("INVALID_OPTIONS");
}
export function choose(original: Uint8Array, compressed: Uint8Array): { bytes: Uint8Array; keptOriginal: boolean } {
  return compressed.length < original.length
    ? { bytes: compressed, keptOriginal: false }
    : { bytes: original, keptOriginal: true };
}
export function outputName(name: string): string {
  return `${name.replace(/\.pdf$/i, "")}_compressed.pdf`;
}
