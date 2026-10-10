// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { HOLIDAYS } from "./holidays.ts";
import { calendar, counts, parseDays, parseRoster, plan, type PlanInput, type Teacher } from "./planner.ts";
const teacher = (id: string, extra: Partial<Teacher> = {}): Teacher => ({
  id,
  name: `교사${id}`,
  past: 0,
  excluded: [],
  weekdays: [],
  fixed: [],
  ...extra,
});
function input(extra: Partial<PlanInput> = {}): PlanInput {
  return {
    year: 2026,
    month: 10,
    perDay: 1,
    weekends: true,
    excluded: [],
    teachers: [teacher("A"), teacher("B"), teacher("C")],
    manual: {},
    holidays: {},
    ...extra,
  };
}
describe("duty planner", () => {
  it("uses actual leap dates and month boundaries", () => {
    expect(calendar(input({ year: 2024, month: 2 }))).toHaveLength(29);
    expect(calendar(input({ year: 2025, month: 2 }))).toHaveLength(28);
    expect(calendar(input({ month: 12 }))[30]?.date).toBe("2026-12-31");
    expect(calendar(input({ month: 0 }))).toEqual([]);
  });
  it("excludes verified holidays including newly added holidays, but not September 28", () => {
    expect(Object.keys(HOLIDAYS)).toHaveLength(22);
    for (const [month, day] of [
      [5, 1],
      [7, 17],
    ] as const)
      expect(calendar(input({ month, holidays: HOLIDAYS })).find((d) => d.day === day)?.excluded).toBe(true);
    expect(calendar(input({ month: 9, holidays: HOLIDAYS })).find((d) => d.day === 28)?.excluded).toBe(false);
    expect(calendar(input({ year: 2027, month: 5, holidays: HOLIDAYS })).find((d) => d.day === 1)?.reason).toBe("주말");
  });
  it.each([1, 2, 3])("fills %i distinct teachers per day and balances totals", (perDay) => {
    const i = input({ perDay });
    const result = plan(i);
    expect(result.issues).toEqual([]);
    for (const day of calendar(i)) expect(result.assignments[String(day.day)]).toHaveLength(day.excluded ? 0 : perDay);
    const values = Object.values(counts(i, result.assignments));
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });
  it("includes historical and fixed counts and is repeatable without mutating history", () => {
    const i = input({ teachers: [teacher("A", { past: 100, fixed: [1] }), teacher("B"), teacher("C")] });
    const before = structuredClone(i);
    const result = plan(i);
    expect(result.assignments["1"]).toEqual(["A"]);
    expect(counts(i, result.assignments)["A"]).toBe(1);
    expect(plan(i)).toEqual(result);
    expect(i).toEqual(before);
  });
  it("reports fixed/excluded conflicts without releasing constraints", () => {
    expect(plan(input({ teachers: [teacher("A", { fixed: [1], excluded: [1] })] })).issues.length).toBeGreaterThan(0);
    expect(plan(input({ excluded: [1], teachers: [teacher("A", { fixed: [1] })] })).issues.length).toBeGreaterThan(0);
    expect(
      plan(input({ teachers: [teacher("A", { fixed: [1] }), teacher("B", { fixed: [1] })] })).issues.length,
    ).toBeGreaterThan(0);
  });
  it("preserves valid manual replacements and rejects conflicts", () => {
    const i = input({ manual: { "1": ["C"] } });
    expect(plan(i).assignments["1"]).toEqual(["C"]);
    expect(
      plan(input({ manual: { "1": ["C"] }, teachers: [teacher("A", { fixed: [1] }), teacher("C")] })).issues.length,
    ).toBeGreaterThan(0);
    expect(plan(input({ perDay: 2, manual: { "1": ["A", "A"] } })).issues.length).toBeGreaterThan(0);
  });
  it("reports nonexistent fixed and manual dates", () => {
    expect(plan(input({ month: 2, teachers: [teacher("A", { fixed: [31] })] })).issues.length).toBeGreaterThan(0);
    expect(plan(input({ month: 2, manual: { "31": ["A"] } })).issues.length).toBeGreaterThan(0);
  });
  it("respects exclusions and detects impossible daily capacity", () => {
    const i = input({ teachers: [teacher("A", { weekdays: [1] }), teacher("B")] });
    const result = plan(i);
    for (const d of calendar(i).filter((d) => d.weekday === 1))
      expect(result.assignments[String(d.day)]).toEqual(["B"]);
    expect(plan(input({ perDay: 3, teachers: [teacher("A"), teacher("B")] })).issues.length).toBeGreaterThan(0);
  });
  it("finds global cumulative optimum rather than locking a greedy prefix", () => {
    const i = input({
      weekends: false,
      excluded: Array.from({ length: 29 }, (_, n) => n + 3),
      teachers: [teacher("A"), teacher("B", { excluded: [2] })],
    });
    const result = plan(i);
    expect(result.issues).toEqual([]);
    expect(result.assignments["1"]).toEqual(["B"]);
    expect(result.assignments["2"]).toEqual(["A"]);
  });
  it("handles 500 teachers, 31 days, and 3 slots in a bounded time", () => {
    const i = input({
      weekends: false,
      perDay: 3,
      teachers: Array.from({ length: 500 }, (_, n) => teacher(String(n))),
    });
    const start = performance.now();
    const result = plan(i);
    expect(result.issues).toEqual([]);
    expect(Object.values(result.assignments).flat()).toHaveLength(93);
    expect(performance.now() - start).toBeLessThan(5000);
  });
  it("matches exhaustive global fairness for constrained synthetic cases", () => {
    for (let seed = 0; seed < 24; seed++) {
      const teachers = Array.from({ length: 3 }, (_, n) =>
        teacher(String(n), {
          past: (seed + n) % 4,
          excluded: [1, 2, 3, 4].filter((d) => ((seed + 1) * (n + 2) + d) % 5 === 0),
        }),
      );
      const i = input({ weekends: false, teachers, excluded: Array.from({ length: 27 }, (_, n) => n + 5) });
      let best = Infinity;
      function enumerate(day: number, totals: number[]) {
        if (day === 5) {
          best = Math.min(
            best,
            totals.reduce((sum, count) => sum + count * count, 0),
          );
          return;
        }
        teachers.forEach((t, index) => {
          if (t.excluded.includes(day)) return;
          const next = [...totals];
          next[index] = (next[index] ?? 0) + 1;
          enumerate(day + 1, next);
        });
      }
      enumerate(
        1,
        teachers.map((t) => t.past),
      );
      const result = plan(i);
      const projected = counts(i, result.assignments);
      expect(result.issues).toEqual([]);
      expect(teachers.reduce((sum, t) => sum + (t.past + (projected[t.id] ?? 0)) ** 2, 0)).toBe(best);
    }
  });
  it("parses synthetic roster and rejects bad or duplicate values", () => {
    expect(parseRoster("교사A\t3\n교사B,0", [])?.map((t) => t.past)).toEqual([3, 0]);
    expect(parseRoster("교사A\n교사A", [])).toBeNull();
    expect(parseRoster("교사A,-1", [])).toBeNull();
    expect(parseDays("1, 5 31")).toEqual([1, 5, 31]);
    expect(parseDays("0,32")).toBeNull();
  });
});
