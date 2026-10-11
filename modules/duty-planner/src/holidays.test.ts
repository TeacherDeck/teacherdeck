// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { HOLIDAYS, HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR } from "./holidays.ts";
import { calendar } from "./planner.ts";
import { initialState } from "./state.ts";
describe("bounded offline holiday coverage", () => {
  it("covers KASI 2027/2028 drafts including newly legislated dates without invented substitutes", () => {
    expect([HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR]).toEqual([2026, 2030]);
    expect(Object.keys(HOLIDAYS)).toHaveLength(103);
    for (const date of [
      "2027-05-01",
      "2027-05-03",
      "2027-07-17",
      "2027-07-19",
      "2027-02-09",
      "2028-10-03",
      "2028-10-05",
    ])
      expect(HOLIDAYS[date]).toBeTruthy();
    for (const date of ["2026-09-28", "2027-06-07", "2028-01-03", "2028-10-06"]) expect(HOLIDAYS[date]).toBeUndefined();
    expect(HOLIDAYS["2028-04-12"]).toBe("국회의원선거일(예정)");
  });
  it("excludes verified lunar dates through 2030 and leaves unannounced elections explicit", () => {
    for (const [year, month, day] of [
      [2029, 2, 13],
      [2029, 5, 20],
      [2029, 9, 22],
      [2030, 2, 3],
      [2030, 5, 9],
      [2030, 9, 12],
    ] as const) {
      const input = initialState(new Date(year, month - 1, 1)).input;
      expect(calendar({ ...input, weekends: false, holidays: HOLIDAYS }).find((d) => d.day === day)?.excluded).toBe(
        true,
      );
    }
    expect(HOLIDAYS["2030-06-05"]).toBeUndefined();
    expect(HOLIDAYS["2030-06-12"]).toBeUndefined();
    expect(Object.keys(HOLIDAYS).every((date) => new Date(date).toISOString().startsWith(date))).toBe(true);
  });
});
