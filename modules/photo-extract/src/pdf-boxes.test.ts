// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { cropBox, DEFAULT_INSETS, detectBoxes, studentIdentity, wordLines, type Rect, type Word } from "./pdf-boxes.ts";
import { planPhotos, validNamePattern } from "./batch.ts";
function page(width = 400, height = 500) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x: number, y: number, value: number) => {
    const i = (y * width + x) * 4;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  };
  const border = ({ x, y, width: w, height: h }: Rect) => {
    for (let xx = x; xx < x + w; xx++) {
      paint(xx, y, 0);
      paint(xx, y + h - 1, 0);
    }
    for (let yy = y; yy < y + h; yy++) {
      paint(x, yy, 0);
      paint(x + w - 1, yy, 0);
    }
  };
  return { pixels, width, height, paint, border };
}
describe("NEIS PDF photo coordinates and identity", () => {
  it("detects separate boxes in row order and excludes page borders and tiny noise", () => {
    const p = page();
    const boxes = [
      { x: 30, y: 40, width: 90, height: 120 },
      { x: 200, y: 45, width: 90, height: 120 },
      { x: 30, y: 240, width: 90, height: 120 },
    ];
    p.border({ x: 1, y: 1, width: 398, height: 498 });
    boxes.forEach(p.border);
    p.border({ x: 350, y: 450, width: 4, height: 5 });
    expect(detectBoxes(p.pixels, p.width, p.height)).toEqual(boxes);
  });
  it("connects short border breaks and rejects invalid pixel allocations", () => {
    const p = page(),
      box = { x: 30, y: 40, width: 90, height: 120 };
    p.border(box);
    p.paint(65, 40, 255);
    p.paint(66, 40, 255);
    expect(detectBoxes(p.pixels, p.width, p.height)).toEqual([box]);
    expect(() => detectBoxes(p.pixels, 1, 1)).toThrow("PAGE_LIMIT");
  });
  it("removes the border and label while preserving photo pixels and bounded margin changes", () => {
    const p = page(),
      box = { x: 30, y: 40, width: 90, height: 120 };
    const words: Word[] = [{ x: 45, y: 140, width: 55, height: 10, text: "1번 가상가" }];
    expect(cropBox(box, words, p.pixels, p.width, p.height, DEFAULT_INSETS)).toEqual({
      x: 34,
      y: 44,
      width: 82,
      height: 94,
    });
    expect(cropBox(box, words, p.pixels, p.width, p.height, { top: 3, bottom: 4, left: 5, right: 6 })).toEqual({
      x: 39,
      y: 47,
      width: 71,
      height: 87,
    });
    expect(() => cropBox(box, words, p.pixels, p.width, p.height, { ...DEFAULT_INSETS, left: 100 })).toThrow(
      "EMPTY_CROP",
    );
  });
  it("uses unambiguous page headers and rejects missing, conflicting, or unrelated identity text", () => {
    expect(studentIdentity("1번\n가상가", "2026학년도 2학년 3반")).toEqual({
      grade: 2,
      classNumber: 3,
      number: 1,
      name: "가상가",
    });
    expect(studentIdentity("1번 가상가", "2학년 3반 2학년 4반")).toBeNull();
    expect(studentIdentity("2학년 3반 1번 가상가", "")).toEqual({
      grade: 2,
      classNumber: 3,
      number: 1,
      name: "가상가",
    });
    expect(studentIdentity("1번 가상가", "")).toBeNull();
    expect(studentIdentity("1번 가상가 2026.3.2", "2학년 3반")).toBeNull();
    expect(studentIdentity("1번 성명 가상가", "2학년 3반")?.name).toBe("가상가");
    expect(studentIdentity("1번 이름: 가상가", "2학년 3반")?.name).toBe("가상가");
    expect(studentIdentity("1번 가상가 담임", "2학년 3반")).toBeNull();
  });
  it("joins spatially split labels and custom name fields without losing unknown photos", () => {
    expect(
      wordLines([
        { x: 80, y: 10, width: 20, height: 8, text: "가상가" },
        { x: 20, y: 10, width: 30, height: 8, text: "1번" },
      ]),
    ).toEqual(["1번 가상가"]);
    expect(validNamePattern("{학년}_{반}_{번호}_{이름}")).toBe(true);
    expect(validNamePattern("{알수없는키}")).toBe(false);
    expect(validNamePattern("{이름")).toBe(false);
    const input = {
      file: { handle: "pdf-1", name: "합성.pdf", ext: "pdf", size: 1, modifiedAt: 0 },
      students: [
        { grade: 2, classNumber: 3, number: 1, name: "가상가", row: 0, col: 0, sheet: "1쪽", text: "", photoKey: "p1" },
      ],
      photos: ["p1", "p2"].map((key) => ({ key, bytes: new Uint8Array([1]), mime: "image/png", extension: "png" })),
      warnings: [],
    };
    expect(planPhotos([input], {}, "{학년}_{반}_{번호}_{이름}").map((photo) => photo.filename)).toEqual([
      "2_3_1_가상가.png",
      "미확인_002.png",
    ]);
  });
});
