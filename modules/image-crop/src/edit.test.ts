// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { createDeckTheme } from "@deck/ui";
import {
  centeredRect,
  clampRect,
  orientedSize,
  outputName,
  outputSize,
  transferRect,
  rotateEdit,
  flipEdit,
  rotateRatio,
  type Edit,
} from "./edit.ts";
import { imageHeader } from "./header.ts";
describe("crop geometry", () => {
  it("moves an off-center crop with rotation and flips and restores it after inverse operations", () => {
    const edit: Edit = {
      turns: 0,
      flipX: false,
      flipY: false,
      rect: { x: 10, y: 7, width: 30, height: 20 },
      outputWidth: 60,
    };
    expect(rotateEdit(edit, 100, 80)).toMatchObject({
      turns: 1,
      rect: { x: 53, y: 10, width: 20, height: 30 },
      outputWidth: 60,
    });
    expect(flipEdit(edit, 100, 80, "flipX").rect).toEqual({ x: 60, y: 7, width: 30, height: 20 });
    expect(flipEdit(edit, 100, 80, "flipY").rect).toEqual({ x: 10, y: 53, width: 30, height: 20 });
    let rotated = edit;
    for (let count = 0; count < 4; count++) rotated = rotateEdit(rotated, 100, 80);
    expect(rotated).toEqual(edit);
    expect(flipEdit(flipEdit(edit, 100, 80, "flipX"), 100, 80, "flipX")).toEqual(edit);
    expect(rotateRatio("4:3")).toBe("3:4");
    expect(rotateRatio("9:16")).toBe("16:9");
    expect(rotateRatio("free")).toBe("free");
  });
  it("keeps the same source pixels through every prior rotation and flip combination", () => {
    const selected = (edit: Edit) => {
      const found: number[] = [];
      const size = orientedSize(10, 8, edit.turns);
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 10; x++) {
          let point = { x: x + 0.5, y: y + 0.5 };
          let width = 10,
            height = 8;
          for (let turn = 0; turn < edit.turns; turn++) {
            point = { x: height - point.y, y: point.x };
            [width, height] = [height, width];
          }
          if (edit.flipX) point.x = size.width - point.x;
          if (edit.flipY) point.y = size.height - point.y;
          if (
            point.x >= edit.rect.x &&
            point.y >= edit.rect.y &&
            point.x < edit.rect.x + edit.rect.width &&
            point.y < edit.rect.y + edit.rect.height
          )
            found.push(y * 10 + x);
        }
      return found;
    };
    for (const turns of [0, 1, 2, 3])
      for (const flipX of [false, true])
        for (const flipY of [false, true]) {
          const edit: Edit = { turns, flipX, flipY, rect: { x: 1, y: 2, width: 3, height: 2 } };
          expect(selected(rotateEdit(edit, 10, 8))).toEqual(selected(edit));
          expect(selected(flipEdit(edit, 10, 8, "flipX"))).toEqual(selected(edit));
          expect(selected(flipEdit(edit, 10, 8, "flipY"))).toEqual(selected(edit));
        }
  });
  it("preserves the cropped aspect ratio for resizing and rejects excessive allocation before drawing", () => {
    const edit = {
      turns: 0,
      flipX: false,
      flipY: false,
      rect: { x: 0, y: 0, width: 400, height: 300 },
      outputWidth: 200,
    };
    expect(outputSize(edit)).toEqual({ width: 200, height: 150 });
    expect(() => outputSize({ ...edit, outputWidth: 10000 })).toThrow("OUTPUT_LIMIT");
    expect(() => outputSize({ ...edit, brightness: 201 })).toThrow("INVALID_ADJUSTMENT");
    expect(() =>
      outputSize({
        ...edit,
        annotation: {
          kind: "text",
          text: "合성\n텍스트",
          ink: createDeckTheme("light").colorNeutralForeground1,
          x: 10,
          y: 10,
          width: 50,
          height: 50,
          textPixels: 20,
        },
      }),
    ).toThrow("INVALID_ANNOTATION");
  });
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
    expect(outputName("합성:사진?.png", "jpg")).toBe("합성_사진__자르기.jpg");
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
