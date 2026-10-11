// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { layoutTimetableImage, wrapImageText } from "./school-timetable-image.ts";
const measure = (text: string) => [...text].length * 14;
describe("school timetable image layout", () => {
  it("wraps Korean/Unicode text without dropping characters", () => {
    const text = "합성수업,과학🧪긴이름";
    const lines = wrapImageText(text, 56, measure);
    expect(lines.join("")).toBe(text);
    expect(lines.every((line) => measure(line) <= 56)).toBe(true);
  });
  it("uses canonical IDs, all shown periods and weekend cells without changing input", () => {
    const input = {
      title: "합성표",
      periods: 12,
      contexts: [
        { id: "a", label: "동명" },
        { id: "b", label: "동명" },
      ],
      entries: [{ weekday: 7, period: 12, contextId: "b" }],
    };
    const before = structuredClone(input),
      layout = layoutTimetableImage(input, 20, measure);
    expect(layout.rows).toHaveLength(12);
    expect(layout.rows[11]?.cells[6]).toEqual(["동명"]);
    expect(layout.rows[0]?.cells[0]).toEqual([""]);
    expect(input).toEqual(before);
    expect(layout.height).toBeLessThanOrEqual(4096);
  });
  it("rejects invalid IDs/duplicate slots and oversized layout rather than clipping", () => {
    const input = {
      title: "합성표",
      periods: 64,
      contexts: [{ id: "a", label: "합".repeat(80) }],
      entries: Array.from({ length: 64 }, (_, index) => ({ weekday: 1, period: index + 1, contextId: "a" })),
    };
    expect(() => layoutTimetableImage(input, 20, measure)).toThrow("너무 커요");
    expect(() => layoutTimetableImage({ ...input, periods: 65 }, 20, measure)).toThrow();
    expect(() =>
      layoutTimetableImage({ ...input, entries: [{ weekday: 1, period: 1, contextId: "missing" }] }, 20, measure),
    ).toThrow();
    const first = input.entries[0];
    if (!first) throw new Error("synthetic first cell missing");
    expect(() => layoutTimetableImage({ ...input, entries: [first, first] }, 20, measure)).toThrow();
  });
});
