// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { detect, TYPES } from "./logic.ts";
import { ocrBoxes } from "./ocr-layout.ts";

function result(words: unknown[], confidence = 88) {
  return { confidence, blocks: [{ paragraphs: [{ lines: [{ words }] }] }] };
}
const page = { number: 1, width: 300, height: 400, boxes: [] };
describe("local OCR layout", () => {
  it("maps viewport pixels conservatively and detects a synthetic phone across words", () => {
    const parsed = ocrBoxes(
      result([
        { text: "전화번호", bbox: { x0: 10, y0: 20, x1: 100, y1: 60 } },
        { text: "010-0000-0000", bbox: { x0: 120, y0: 20, x1: 420, y1: 60 } },
      ]),
      page,
      600,
      800,
    );
    expect(parsed.boxes[1]).toMatchObject({ x: 59, y: 9, width: 152, height: 22 });
    expect(detect([{ ...page, boxes: parsed.boxes }], [], [...TYPES]).some((c) => c.kind === "전화번호")).toBe(true);
  });
  it("keeps empty and low confidence results distinguishable", () => {
    expect(ocrBoxes(result([], 0), page, 600, 800)).toEqual({ confidence: 0, boxes: [] });
  });
  it.each([
    { x0: -1, y0: 0, x1: 20, y1: 20 },
    { x0: 1, y0: 1, x1: 800, y1: 20 },
    { x0: 1, y0: 1, x1: 20, y1: Infinity },
  ])("rejects invalid engine boxes instead of silently moving them", (bbox) => {
    expect(() => ocrBoxes(result([{ text: "합성", bbox }]), page, 600, 800)).toThrow("OCR_INVALID_BOX");
  });
});
