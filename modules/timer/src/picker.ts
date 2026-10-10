// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Wheel-picker geometry for the hh:mm:ss editor (MOD-015: pure, unit-tested). A box's position is
// a float `pos` (5.4 = 40% of the way from 5 to 6). Every row's offset, size and opacity is a
// continuous function of its distance from `pos`, so the reel never jumps while it moves.
import type { Parts } from "./timer.ts";

export type Part = keyof Parts;

/** Size of the rows next to the selected one, and of the rows after those (fraction of full size). */
export const NEAR_SCALE = 0.5;
export const FAR_SCALE = 0.35;
/** Rows further than this from the selection are not drawn. */
export const VISIBLE_DISTANCE = 2.5;

const HOUR_MAX = 24;

/** Pointer travel (px) that moves the reel by one value next to the selection: the pointer and the numbers move together. */
export function stepPx(rowPx: number): number {
  return rowPx * (0.5 + NEAR_SCALE / 2);
}

export interface RowStyle {
  /** Offset of the row's centre from the selection's centre (px). */
  y: number;
  scale: number;
  opacity: number;
}

/** Where and how to draw a row `d` values away from the selection (d may be fractional). */
export function rowStyle(d: number, rowPx: number): RowStyle {
  const ad = Math.abs(d);
  const near = Math.min(ad, 1);
  const far = Math.min(Math.max(ad - 1, 0), 1.5);
  // Centre-to-centre gaps: full row ↔ near row, then near row ↔ far row; rows just touch.
  const a = rowPx * (0.5 + NEAR_SCALE / 2);
  const b = rowPx * (NEAR_SCALE / 2 + FAR_SCALE / 2);
  const y = Math.sign(d) * (a * near + b * far);
  const scale = ad <= 1 ? 1 - (1 - NEAR_SCALE) * near : NEAR_SCALE - (NEAR_SCALE - FAR_SCALE) * Math.min(far, 1);
  const base = ad <= 1 ? 1 - 0.55 * near : 0.45 - 0.25 * Math.min(far, 1);
  const fadeOut = ad > 2 ? Math.max(0, 1 - (ad - 2) / (VISIBLE_DISTANCE - 2)) : 1;
  return { y, scale, opacity: base * fadeOut };
}

/** Hours stop at 0 and 24; minutes and seconds go round. */
export function clampPos(part: Part, pos: number): number {
  return part === "h" ? Math.min(HOUR_MAX, Math.max(0, pos)) : pos;
}

/** The value shown on row `k` (an integer position), or null when hours have no such row. */
export function valueAt(part: Part, k: number): number | null {
  if (part === "h") return k < 0 || k > HOUR_MAX ? null : k;
  return ((k % 60) + 60) % 60;
}

/** Whole position to settle on after a drag, carried a little further by a flick (velocity in values/ms). */
export function settleTarget(part: Part, pos: number, velocity: number): number {
  const MOMENTUM_MS = 180;
  return clampPos(part, Math.round(pos + velocity * MOMENTUM_MS));
}

/** Settle animation length: longer for longer trips, never sluggish. */
export function settleMs(distance: number): number {
  return Math.min(600, 160 + 70 * Math.abs(distance));
}

/** Decelerating curve for settling (ease-out cubic). */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}
