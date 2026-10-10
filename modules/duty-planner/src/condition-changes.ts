// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { calendar, eligibleSlot, slotsForDay, type PlanInput } from "./planner.ts";
import type { PlannerState } from "./state.ts";

export function isValidAssignment(input: PlanInput, key: string, assigned: string[]): boolean {
  const days = calendar(input);
  const day = days.find((item) => String(item.day) === key);
  if (!day) return false;
  if (day.excluded) return assigned.length === 0;
  return (
    assigned.length === slotsForDay(input, day.day) &&
    new Set(assigned).size === assigned.length &&
    input.teachers
      .filter((teacher) => teacher.fixed.includes(day.day))
      .every((teacher) => assigned.includes(teacher.id)) &&
    assigned.every((id, slot) => {
      const teacher = input.teachers.find((item) => item.id === id);
      return (
        teacher &&
        teacher.participating !== false &&
        !teacher.excluded.includes(day.day) &&
        !teacher.weekdays.includes(day.weekday) &&
        eligibleSlot(teacher, day.weekday, slot)
      );
    })
  );
}

/** Preserve valid results; only affected dates need another assignment. Manual constraints remain editable. */
export function changeConditions(state: PlannerState, patch: Partial<PlanInput>, holidays: PlanInput["holidays"]) {
  const input = { ...state.input, ...patch };
  const valid = (key: string, assigned: string[]) => isValidAssignment({ ...input, holidays }, key, assigned);
  const removed = Object.entries(state.assignments)
    .filter(([day, assigned]) => !valid(day, assigned))
    .map(([day]) => day);
  const conflicts = Object.entries(input.manual)
    .filter(([day, assigned]) => !valid(day, assigned))
    .map(([day]) => day);
  const assignments = Object.fromEntries(
    Object.entries(state.assignments).filter(([day, assigned]) => valid(day, assigned)),
  );
  return {
    state: { ...state, input, assignments },
    issues: [
      ...(removed.length
        ? [`${removed.join("·")}일 배정이 바뀐 조건과 맞지 않아 비웠어요. 조건을 확인한 뒤 배정해 주세요.`]
        : []),
      ...(conflicts.length
        ? [`${conflicts.join("·")}일 직접 배정과 조건이 겹쳐요. 직접 배정이나 조건을 조정해 주세요.`]
        : []),
    ],
  };
}

export function validSelectedDay(input: PlanInput, selection: string): string {
  const days = calendar(input);
  const value = Number(selection);
  return String(Math.max(1, Math.min(Number.isInteger(value) ? value : 1, days.length || 1)));
}
