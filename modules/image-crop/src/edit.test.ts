// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { centeredRect, clampRect, orientedSize, outputName, transferRect } from "./edit.ts";
import { imageHeader } from "./header.ts";
describe("crop geometry", () => {
  it("clamps free rectangles to positive integer source pixels", () => {
    expect(clampRect({ x: -10, y: 9.6, width: 1000, height: 0 }, 100, 80)).toEqual({
      x: 0,
      y: 10,
      width: 100,
      height: 1,
    });
    expect(clampRect({ x: 99, y: 79, width: 30, height: 40 }, 100, 80)).toEqual({ x: 99, y: 79, width: 1, height: 1 });
    expect(() => clampRect({ x: NaN, y: 0, width: 1, height: 1 }, 100, 80)).toThrow("INVALID_RECT");
  });
  it("centers common ratios and transfers relative framing across sizes", () => {
    expect(centeredRect(400, 300, 1)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    expect(centeredRect(400, 300, 16 / 9)).toEqual({ x: 0, y: 37, width: 400, height: 225 });
    expect(
      transferRect({ x: 50, y: 30, width: 100, height: 60 }, { width: 200, height: 120 }, { width: 400, height: 240 }),
    ).toEqual({ x: 100, y: 60, width: 200, height: 120 });
  });
  it("swaps oriented dimensions only for quarter turns and creates safe output names", () => {
    expect(orientedSize(400, 300, 1)).toEqual({ width: 300, height: 400 });
    expect(orientedSize(400, 300, 2)).toEqual({ width: 400, height: 300 });
    expect(outputName("합성:사진?.png", "jpeg")).toBe("합성_사진__자르기.jpg");
  });
  it("checks encoded dimensions before allocating large decoded images", () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set(new TextEncoder().encode("IHDR"), 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    view.setUint32(16, 10000);
    view.setUint32(20, 10000);
    expect(() => imageHeader(bytes)).toThrow("INVALID_IMAGE");
    view.setUint32(16, 100);
    view.setUint32(20, 100);
    expect(imageHeader(bytes)).toMatchObject({ width: 100, height: 100, ext: "png" });
  });
});
