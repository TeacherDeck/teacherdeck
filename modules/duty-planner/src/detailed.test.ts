// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import {
  detailedCounts,
  emptyDetailed,
  planDetailed,
  sanitizeDetailed,
  setDetailedActual,
  setDetailedManual,
  type DetailedState,
  type DutyJob,
} from "./detailed.ts";
import {
  cumulativeInput,
  decodeBackup,
  encodeBackup,
  exportCsv,
  exportLegacy,
  performanceCounts,
  switchMonth,
} from "./history.ts";
import { initialState, sanitizeState } from "./state.ts";
import type { PlanInput } from "./planner.ts";
function fixture() {
  const state = initialState(new Date(2026, 9, 1));
  state.input.teachers = ["A", "B", "C", "D"].map((id) => ({
    id,
    name: `합성교사${id}`,
    past: 0,
    excluded: [],
    weekdays: [],
    fixed: [],
  }));
  const d: DetailedState = {
    ...emptyDetailed(),
    blocks: [
      { id: "am", label: "1교시", start: 540, end: 590 },
      { id: "night", label: "야자", start: 1080, end: 1200 },
    ],
  };
  return { state, input: state.input, d };
}
function job(id: string, day = 6, block = "am", patch: Partial<DutyJob> = {}): DutyJob {
  return {
    id,
    day,
    block,
    task: block === "am" ? "시험감독" : "야자",
    room: id,
    required: 1,
    fixed: [],
    excluded: [],
    ...patch,
  };
}
describe("detailed duty constraints and totals", () => {
  it("fills 120 simultaneous rooms from 500 teachers without duplicate assignment", () => {
    const { input, d } = fixture();
    input.teachers = Array.from({ length: 500 }, (_, n) => ({
      id: `T${n}`,
      name: `합성교사${n}`,
      past: 0,
      excluded: [],
      weekdays: [],
      fixed: [],
    }));
    d.jobs = Array.from({ length: 120 }, (_, n) => job(`r${n}`));
    const result = planDetailed(input, d);
    expect(result.issues).toEqual([]);
    expect(Object.values(result.assignments).flat()).toHaveLength(120);
    expect(new Set(Object.values(result.assignments).flat()).size).toBe(120);
  });
  it("assigns every exam room once per teacher/time, but permits different periods and tasks", () => {
    const { input, d } = fixture();
    d.jobs = [job("room1"), job("room2"), job("room3"), job("night1", 6, "night")];
    const result = planDetailed(input, d);
    expect(result.issues).toEqual([]);
    expect(Object.values(result.assignments).flat()).toHaveLength(4);
    expect(
      new Set([result.assignments["room1"]?.[0], result.assignments["room2"]?.[0], result.assignments["room3"]?.[0]])
        .size,
    ).toBe(3);
    expect(planDetailed(input, d)).toEqual(result);
  });
  it("rejects simultaneous shortage, conflicting pins, excluded dates and overlapping block definitions", () => {
    const { input, d } = fixture();
    d.jobs = Array.from({ length: 5 }, (_, i) => job(`r${i}`));
    expect(planDetailed(input, d).issues).toHaveLength(1);
    d.jobs = [job("r1", 6, "am", { fixed: ["A"] }), job("r2", 6, "am", { fixed: ["A"] })];
    expect(planDetailed(input, d).issues[0]).toContain("같은 시간대");
  });
  it("keeps global fixed dates and task-specific pins ahead of cumulative balance", () => {
    const { input, d } = fixture();
    required(input.teachers[0]).past = 100;
    required(input.teachers[0]).fixed = [6];
    d.jobs = [job("r1", 6, "am", { fixed: ["B"] }), job("r2", 6, "night")];
    const result = planDetailed(input, d);
    expect(result.issues).toEqual([]);
    expect(result.assignments["r1"]).toEqual(["B"]);
    expect(result.assignments["r2"]).toEqual(["A"]);
    required(input.teachers[0]).excluded = [6];
    expect(planDetailed(input, d).issues[0]).toContain("날짜 고정");
  });
  it("does not greedily lock a flexible pin into the only slot allowed to another teacher", () => {
    const { input, d } = fixture();
    input.teachers = input.teachers.slice(0, 2);
    required(input.teachers[1]).slotWeekdays = [[2], []];
    d.jobs = [job("r1", 6, "am", { required: 2, fixed: ["A"] })];
    expect(planDetailed(input, d)).toEqual({ issues: [], assignments: { r1: ["B", "A"] } });
  });
  it("rejects fixed/excluded conflicts without releasing pins or altering existing results", () => {
    const { input, d } = fixture();
    d.jobs = [job("r1", 6, "am", { fixed: ["A"], excluded: ["A"] })];
    d.assignments = { r1: ["B"] };
    const before = structuredClone(d);
    expect(planDetailed(input, d).issues).toHaveLength(1);
    expect(d).toEqual(before);
    d.jobs = [job("r1", 3, "am", { fixed: ["A"] })];
    input.weekends = true;
    expect(planDetailed(input, d).issues[0]).toContain("날짜 제외");
    d.blocks.push({ id: "overlap", label: "겹치는 교시", start: 580, end: 610 });
    d.jobs.push(job("r2", 3, "overlap"));
    expect(planDetailed(input, d).issues[0]).toContain("시간대가 겹쳐");
  });
  it("retains direct edits, rejects same-time manual duplicates and supports actual replacements", () => {
    const { input, d } = fixture();
    d.jobs = [job("r1"), job("r2"), job("n1", 6, "night")];
    d.assignments = { r1: ["A"], r2: ["B"], n1: ["C"] };
    expect(() => setDetailedManual(input, d, "r2", ["A"])).toThrow("DETAILED_CONFLICT");
    const next = setDetailedManual(input, d, "n1", ["A"]);
    expect(planDetailed(input, next).assignments["n1"]).toEqual(["A"]);
    const actual = setDetailedActual(input, d, "r1", ["C"], new Date(2026, 9, 7));
    expect(() => setDetailedActual(input, actual, "r2", ["C"], new Date(2026, 9, 7))).toThrow();
    expect(() => setDetailedActual(input, d, "r1", ["A"], new Date(2026, 9, 5))).toThrow();
    expect(d.actual).toEqual({});
  });
  it("does not allow a manual replacement to remove the final participation of a date-fixed teacher", () => {
    const { input, d } = fixture();
    required(input.teachers[0]).fixed = [6];
    d.jobs = [job("r1"), job("n1", 6, "night")];
    d.assignments = { r1: ["A"], n1: ["B"] };
    expect(() => setDetailedManual(input, d, "r1", ["C"])).toThrow("DETAILED_CONFLICT");
    expect(setDetailedManual(input, d, "n1", ["C"]).assignments).toEqual({ r1: ["A"], n1: ["C"] });
  });
  it("supports different daily bell times, but requires a single shared block for overlapping jobs on one day", () => {
    const { input, d } = fixture();
    d.blocks.push({ id: "short", label: "단축 1교시", start: 550, end: 580 });
    d.jobs = [job("r1"), job("r2", 7, "short")];
    expect(planDetailed(input, d).issues).toEqual([]);
    d.jobs.push(job("r3", 6, "short"));
    expect(planDetailed(input, d).issues[0]).toContain("시간대가 겹쳐");
  });
  it("finds the global minimum cumulative square sum under room eligibility", () => {
    const unrelated = fixture();
    required(unrelated.input.teachers[0]).fixed = [1];
    unrelated.d.jobs = [job("r1")];
    expect(planDetailed(unrelated.input, unrelated.d).issues).toEqual([]);
    expect(unrelated.input.teachers[0]?.fixed).toEqual([1]);
    for (let seed = 0; seed < 20; seed++) {
      const { input, d } = fixture();
      input.teachers = input.teachers.slice(0, 3);
      input.teachers.forEach((t, i) => {
        t.past = ((seed + i * 2) % 5) / 10;
      });
      d.jobs = [job("a"), job("b"), job("c", 7), job("d", 7, "night")];
      if (seed % 2) required(d.jobs[0]).excluded = ["A"];
      if (seed % 3 === 0) required(d.jobs[2]).fixed = ["C"];
      const result = planDetailed(input, d);
      expect(result.issues).toEqual([]);
      const best = exhaustive(input, d);
      const tally = detailedCounts(d, result.assignments);
      const square = input.teachers.reduce(
        (sum, t) => sum + (Math.round(t.past * 10) + (tally[t.id] ?? 0) * 10) ** 2,
        0,
      );
      expect(square).toBe(best);
    }
  });
});
function exhaustive(input: PlanInput, d: DetailedState): number {
  let best = Infinity;
  const counts = new Map<string, number>(),
    used = new Set<string>();
  function visit(index: number) {
    const j = d.jobs[index];
    if (!j) {
      best = Math.min(
        best,
        input.teachers.reduce((sum, t) => sum + (Math.round(t.past * 10) + (counts.get(t.id) ?? 0) * 10) ** 2, 0),
      );
      return;
    }
    for (const t of input.teachers) {
      const key = `${t.id}/${j.day}/${j.block}`;
      if (j.excluded.includes(t.id) || (j.fixed.length && !j.fixed.includes(t.id)) || used.has(key)) continue;
      used.add(key);
      counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
      visit(index + 1);
      used.delete(key);
      counts.set(t.id, (counts.get(t.id) ?? 1) - 1);
    }
  }
  visit(0);
  return best;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("SYNTHETIC_FIXTURE_MISSING");
  return value;
}
describe("detailed migration, backup and actual ledger", () => {
  it("loads old states unchanged and round-trips v2 with conditions and actual records", () => {
    const { state, d } = fixture();
    const before = structuredClone(state);
    expect(sanitizeState(state)).toEqual(before);
    expect(encodeBackup({ "2026-10": state })).toContain("teacherdeck-duty-v1");
    d.jobs = [job("r1")];
    d.assignments = { r1: ["A"] };
    d.manual = { r1: ["A"] };
    d.actual = { r1: ["B"] };
    state.detailed = d;
    state.memo = { "6": "합성 지도일 메모" };
    state.input.exam = [6];
    const backup = encodeBackup({ "2026-10": state });
    expect(backup).toContain("teacherdeck-duty-v2");
    expect(decodeBackup(backup)?.["2026-10"]).toEqual(state);
    expect(() => exportLegacy({ "2026-10": state })).toThrow("LEGACY_FORMAT_LIMIT");
    expect(exportCsv(state)).toContain("시험감독");
    expect(exportCsv(state)).toContain("09:00");
    expect(exportCsv(state)).toContain("합성 지도일 메모");
    expect(exportCsv(state)).toContain('"고사"');
    expect(switchMonth(state, {}, 2026, 11).detailed).toEqual({ ...emptyDetailed(), blocks: d.blocks });
  });
  it("rejects unknown versions, invalid dates, unknown references and invalid actual rows", () => {
    const { state, d } = fixture();
    d.jobs = [job("r1")];
    state.detailed = d;
    expect(sanitizeDetailed({ ...d, version: 2 }, new Set(["A"]), 31)).toBeNull();
    expect(sanitizeState({ ...state, detailed: { ...d, assignments: { r1: ["unknown"] } } })).toBeNull();
    expect(sanitizeState({ ...state, detailed: { ...d, actual: { r1: ["A", "A"] } } })).toBeNull();
    expect(
      sanitizeState({ ...state, input: { ...state.input, month: 2 }, detailed: { ...d, jobs: [job("r1", 30)] } }),
    ).toBeNull();
  });
  it("checks imported overlapping intervals by clock time, not merely their block IDs", () => {
    const { state, input, d } = fixture();
    d.blocks.push({ id: "overlap", label: "별도 이름", start: 570, end: 610 });
    d.jobs = [job("r1"), job("r2", 6, "overlap")];
    d.assignments = { r1: ["A"], r2: ["B"] };
    state.detailed = d;
    expect(decodeBackup(encodeBackup({ "2026-10": state }))?.["2026-10"]?.detailed).toEqual(d);
    expect(() => setDetailedManual(input, d, "r2", ["A"])).toThrow("DETAILED_CONFLICT");
    const recorded = setDetailedActual(input, d, "r1", ["A"], new Date(2026, 9, 7));
    expect(() => setDetailedActual(input, recorded, "r2", ["A"], new Date(2026, 9, 7))).toThrow(
      "DETAILED_ACTUAL_CONFLICT",
    );
    expect(sanitizeState({ ...state, detailed: { ...d, actual: { r1: ["A"], r2: ["A"] } } })).toBeNull();
    expect(setDetailedActual(input, recorded, "r2", ["B"], new Date(2026, 9, 7)).actual).toEqual({
      r1: ["A"],
      r2: ["B"],
    });
  });
  it("counts real duties per job, preserves excluded-day history and re-closes without double counting", () => {
    const { state, d } = fixture();
    d.jobs = [job("r1"), job("n1", 6, "night")];
    d.actual = { r1: ["A"], n1: ["A"] };
    state.detailed = d;
    state.actual = { "6": ["A"] };
    state.input.excluded = [6];
    state.closed = true;
    expect(performanceCounts(state)["A"]).toBe(3);
    const nov = switchMonth(state, {}, 2026, 11);
    expect(cumulativeInput(nov, { "2026-10": state }).teachers[0]?.past).toBe(3);
    const corrected = { ...state, detailed: { ...d, actual: { r1: ["B"], n1: ["A"] } } };
    expect(cumulativeInput(nov, { "2026-10": corrected }).teachers[0]?.past).toBe(2);
    expect(cumulativeInput(nov, { "2026-10": { ...state, closed: false } }).teachers[0]?.past).toBe(0);
  });
});
