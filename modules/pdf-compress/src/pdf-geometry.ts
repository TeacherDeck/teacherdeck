// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TextBox extends Rect {
  text: string;
}
export interface PageInfo {
  width: number;
  height: number;
  boxes: TextBox[];
  number: number;
}
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_PAGES = 100;
export const MAX_PIXELS = 24_000_000;
export const MAX_OUTPUT = 128 * 1024 * 1024;
