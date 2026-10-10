// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { clampPos, easeOut, rowStyle, settleMs, settleTarget, stepPx, valueAt } from "./picker.ts";

const ROW = 100;

describe("picker geometry", () => {
  it("draws the selection full size and neighbours smaller and fainter", () => {
    expect(rowStyle(0, ROW)).toEqual({ y: 0, scale: 1, opacity: 1 });
    const near = rowStyle(1, ROW);
    const far = rowStyle(2, ROW);
    expect(near.y).toBe(stepPx(ROW));
    expect(far.y).toBeGreaterThan(near.y);
    expect(far.scale).toBeLessThan(near.scale);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(rowStyle(-1, ROW).y).toBe(-near.y);
    expect(rowStyle(2.5, ROW).opacity).toBe(0);
  });

  it("changes continuously, so the reel never jumps", () => {
    for (let d = -2.5; d < 2.5; d += 0.01) {
      const a = rowStyle(d, ROW);
      const b = rowStyle(d + 0.01, ROW);
      expect(Math.abs(b.y - a.y)).toBeLessThan(1);
      expect(Math.abs(b.scale - a.scale)).toBeLessThan(0.01);
      expect(Math.abs(b.opacity - a.opacity)).toBeLessThan(0.03);
    }
  });

  it("stops hours at 0 and 24 and wraps minutes and seconds", () => {
    expect(clampPos("h", -3)).toBe(0);
    expect(clampPos("h", 30)).toBe(24);
    expect(clampPos("m", -3)).toBe(-3);
    expect(valueAt("h", -1)).toBeNull();
    expect(valueAt("h", 25)).toBeNull();
    expect(valueAt("m", -1)).toBe(59);
    expect(valueAt("s", 61)).toBe(1);
  });

  it("settles on a whole value, further after a flick", () => {
    expect(settleTarget("m", 5.4, 0)).toBe(5);
    expect(settleTarget("m", 5.6, 0)).toBe(6);
    expect(settleTarget("m", 5, 0.02)).toBe(9);
    expect(settleTarget("h", 23.8, 0.05)).toBe(24);
    expect(settleMs(0)).toBeGreaterThan(0);
    expect(settleMs(100)).toBe(600);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });
});
