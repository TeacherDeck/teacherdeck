// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_DECODED_BYTES = 192 * 1024 * 1024;
export const MAX_WORKING_BYTES = 256 * 1024 * 1024;
export const MAX_METADATA_BYTES = 256 * 1024;
export const MAX_LAYERS = 16;
export function checkDimensions(width: number, height: number): number {
  if (
    ![width, height].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    width > 10_000 ||
    height > 10_000 ||
    width * height > 24_000_000
  )
    throw new Error("IMAGE_LIMIT");
  return width * height;
}
export function checkBytes(value: number, limit = MAX_DECODED_BYTES): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error("MEMORY_LIMIT");
}
