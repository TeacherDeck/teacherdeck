// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Day, PlanInput } from "./planner.ts";
import type { PlannerState } from "./state.ts";
/** Presentation only: never changes assignment eligibility or user constraints. */
export function calendarStatus(day: Day, input: PlanInput, state: PlannerState, selected: boolean) {
  const holiday = input.holidays[day.date] ?? "";
  const manual = Object.hasOwn(input.manual, String(day.day));
  const fixed = input.teachers.some((t) => t.fixed.includes(day.day));
  const actual = state.actual?.[String(day.day)] ?? [];
  return {
    tone: holiday || day.weekday === 0 ? "red" : day.weekday === 6 ? "blue" : "neutral",
    holiday,
    excluded: day.excluded,
    manual,
    fixed,
    performed: actual.length > 0,
    selected,
    exam: input.exam?.includes(day.day) ?? false,
  };
}
