// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { changeConditions, isValidAssignment, validSelectedDay } from "./condition-changes.ts";
import { initialState } from "./state.ts";
const seeded = () => {
  const state = initialState(new Date(2026, 9, 1));
  state.input.teachers = ["A", "B"].map((id) => ({
    id,
    name: `합성 교사 ${id}`,
    past: 0,
    fixed: [],
    excluded: [],
    weekdays: [],
  }));
  state.assignments = { "6": ["A"], "7": ["B"] };
  return state;
};
describe("condition changes preserve unrelated results", () => {
  it("removes only the excluded date and retains actual records and memos", () => {
    const state = seeded();
    state.actual = { "6": ["A"] };
    state.memo = { "6": "합성 메모" };
    const next = changeConditions(state, { excluded: [6] }, {});
    expect(next.state.assignments).toEqual({ "7": ["B"] });
    expect(next.state.actual).toEqual(state.actual);
    expect(next.state.memo).toEqual(state.memo);
    expect(next.issues[0]).toContain("6일");
  });
  it("preserves results when adding teachers or changing past counts", () => {
    const state = seeded();
    const teachers = [
      ...state.input.teachers.map((t) => ({ ...t, past: 3 })),
      { id: "C", name: "합성 교사 C", past: 3, fixed: [], excluded: [], weekdays: [] },
    ];
    expect(changeConditions(state, { teachers }, {}).state.assignments).toEqual(state.assignments);
  });
  it("removes only assignments affected by teacher eligibility, slot availability or new fixed conditions", () => {
    const state = seeded();
    const [first, second] = state.input.teachers;
    if (!first || !second) throw new Error("MISSING_SYNTHETIC_TEACHER");
    for (const changed of [
      { ...first, participating: false },
      { ...first, excluded: [6] },
      { ...first, weekdays: [2] },
      { ...first, slotWeekdays: [[1, 3, 4, 5]] },
    ])
      expect(changeConditions(state, { teachers: [changed, second] }, {}).state.assignments).toEqual({
        "7": ["B"],
      });
    const fixed = state.input.teachers.map((t) => (t.id === "B" ? { ...t, fixed: [6] } : t));
    expect(changeConditions(state, { teachers: fixed }, {}).state.assignments).toEqual({ "7": ["B"] });
  });
  it("preserves conflicting manual constraints and identifies them explicitly", () => {
    const state = seeded();
    state.input.manual = { "6": ["A"] };
    const next = changeConditions(state, { excluded: [6] }, {});
    expect(next.state.input.manual).toEqual(state.input.manual);
    expect(next.state.assignments).toEqual({ "7": ["B"] });
    expect(next.issues[1]).toContain("6일 직접 배정과 조건이 겹쳐요");
  });
  it("requires only capacity-mismatched dates to be assigned again", () => {
    const state = seeded();
    state.input.perDay = 2;
    state.assignments = { "6": ["A", "B"], "7": ["B"] };
    state.input.exam = [7];
    expect(changeConditions(state, { perDay: 1 }, {}).state.assignments).toEqual({ "7": ["B"] });
  });
  it("clamps month-end selection including leap years", () => {
    const state = seeded();
    expect(validSelectedDay({ ...state.input, month: 11 }, "31")).toBe("30");
    expect(validSelectedDay({ ...state.input, month: 2 }, "31")).toBe("28");
    expect(validSelectedDay({ ...state.input, year: 2028, month: 2 }, "31")).toBe("29");
    expect(validSelectedDay(state.input, "6")).toBe("6");
  });
});

it("never exports an impossible manual constraint as an assigned CSV teacher", async () => {
  const { exportCsv } = await import("./history.ts");
  const state = seeded();
  state.input.manual = { "6": ["A"] };
  const next = changeConditions(
    state,
    { teachers: state.input.teachers.map((t) => (t.id === "A" ? { ...t, excluded: [6] } : t)) },
    {},
  );
  expect(isValidAssignment(next.state.input, "6", next.state.input.manual["6"] ?? [])).toBe(false);
  expect(next.issues.some((issue) => issue.includes("6일 직접 배정과 조건이 겹쳐요"))).toBe(true);
  const row = exportCsv(next.state)
    .split("\r\n")
    .find((line) => line.startsWith('"2026-10-06"'));
  expect(row).toBe('"2026-10-06","화","","","","",""');
});
