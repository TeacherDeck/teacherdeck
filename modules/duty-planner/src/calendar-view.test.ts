// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { calendarStatus } from "./calendar-view.ts";
import { calendar, type Day } from "./planner.ts";
import { initialState } from "./state.ts";
import { HOLIDAYS } from "./holidays.ts";
function date(days: Day[], n: number): Day {
  const found = days.find((d) => d.day === n);
  if (!found) throw new Error("missing synthetic date");
  return found;
}
describe("calendar visual meaning", () => {
  it("holiday red overrides Saturday blue while weekend exclusions stay independent", () => {
    const state = initialState(new Date(2026, 9, 1));
    const input = { ...state.input, year: 2026, month: 10, holidays: HOLIDAYS, weekends: false };
    const days = calendar(input);
    expect(calendarStatus(date(days, 3), input, state, false)).toMatchObject({
      tone: "red",
      holiday: "개천절",
      excluded: true,
    });
    expect(calendarStatus(date(days, 10), input, state, false)).toMatchObject({
      tone: "blue",
      holiday: "",
      excluded: false,
    });
    expect(calendarStatus(date(days, 11), input, state, false)).toMatchObject({ tone: "red", excluded: false });
  });
  it("manual exclusion does not erase holiday name and independent fixed/actual/selection marks", () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.year = 2026;
    state.input.month = 10;
    state.input.excluded = [9];
    state.input.teachers = [{ id: "a", name: "교사A", past: 0, fixed: [9], excluded: [], weekdays: [] }];
    state.input.manual = { "9": ["a"] };
    state.actual = { "9": ["a"] };
    const input = { ...state.input, holidays: HOLIDAYS };
    const day = date(calendar(input), 9);
    expect(calendarStatus(day, input, state, true)).toMatchObject({
      tone: "red",
      holiday: "한글날",
      excluded: true,
      manual: true,
      fixed: true,
      performed: true,
      selected: true,
    });
  });
});
