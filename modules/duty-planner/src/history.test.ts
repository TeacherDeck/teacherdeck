// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { initialState } from "./state.ts";
import { averagePast, plan } from "./planner.ts";
import {
  closeMonth,
  cumulativeInput,
  decodeBackup,
  encodeBackup,
  exportCsv,
  exportLegacy,
  loadMonths,
  recordAssigned,
  saveMonth,
  selectCurrent,
  switchMonth,
} from "./history.ts";
function sample() {
  const s = initialState(new Date(2026, 9, 1));
  s.input.teachers = [
    { id: "A", name: "교사A", past: 2, fixed: [], excluded: [], weekdays: [] },
    { id: "B", name: "교사B", past: 0, fixed: [], excluded: [], weekdays: [] },
  ];
  return s;
}
describe("monthly performance ledger", () => {
  it("reslots a flexible fixed teacher to keep the remaining slot feasible", () => {
    const s = sample();
    s.input.perDay = 2;
    s.input.excluded = Array.from({ length: 30 }, (_, i) => i + 2);
    const a = s.input.teachers[0],
      b = s.input.teachers[1];
    if (!a || !b) throw new Error("fixture missing");
    a.fixed = [1];
    a.slotWeekdays = [[4], [4]];
    b.slotWeekdays = [[4], []];
    expect(plan(s.input).issues).toEqual([]);
    expect(plan(s.input).assignments["1"]).toEqual(["B", "A"]);
  });
  it("prefers a complete monthly record if latest-pointer save failed and restores holiday exclusions in exports", () => {
    const old = sample(),
      newer = { ...old, memo: { "1": "수정된 합성 메모" } };
    expect(selectCurrent(old, { "2026-10": newer })).toBe(newer);
    const v = JSON.parse(exportLegacy({ "2026-10": newer }));
    expect(v.months[0].data.find((d: { date: string }) => d.date === "10/09").exclude).toBe(true);
    expect(exportCsv(newer)).toContain('"2026-10-09","금","제외"');
  });

  it("avoids consecutive assignments while preserving equal totals and deterministic rotation", () => {
    const s = sample();
    s.input.teachers.push({ id: "C", name: "교사C", past: 0, fixed: [], excluded: [], weekdays: [] });
    s.input.teachers = s.input.teachers.map((t) => ({ ...t, past: 0 }));
    s.input.weekends = false;
    s.input.excluded = Array.from({ length: 25 }, (_, i) => i + 7);
    const result = plan(s.input);
    expect(result.issues).toEqual([]);
    expect(plan(s.input)).toEqual(result);
    for (let day = 2; day <= 6; day++)
      expect(result.assignments[String(day)]?.[0]).not.toBe(result.assignments[String(day - 1)]?.[0]);
    for (const id of ["A", "B", "C"])
      expect(Object.values(result.assignments).filter((row) => row.includes(id))).toHaveLength(2);
  });

  it("uses slot-specific weekdays with fixed teachers, and rejects reversed direct assignments", () => {
    const s = sample();
    s.input.perDay = 2;
    s.input.excluded = Array.from({ length: 30 }, (_, i) => i + 2);
    const a = s.input.teachers[0],
      b = s.input.teachers[1];
    if (!a || !b) throw new Error("fixture missing");
    a.slotWeekdays = [[], [4]];
    b.slotWeekdays = [[4], []];
    a.fixed = [1];
    expect(plan(s.input).assignments["1"]).toEqual(["B", "A"]);
    s.input.manual = { "1": ["A", "B"] };
    expect(plan(s.input).issues.length).toBeGreaterThan(0);
  });
  it("supports tenth-count baselines and gives a new participant the rounded historical average", () => {
    const s = sample();
    s.input.teachers = s.input.teachers.map((t, i) => ({ ...t, past: i ? 2.6 : 1.3 }));
    expect(averagePast(s.input.teachers)).toBe(2);
    expect(plan(s.input).issues).toEqual([]);
    expect(decodeBackup(encodeBackup({ "2026-10": s }))?.["2026-10"]?.input.teachers[0]?.past).toBe(1.3);
  });
  it("records selected past assignments explicitly and blocks future dates atomically", () => {
    const s = sample();
    s.assignments = { "1": ["A"], "2": ["B"] };
    const updated = recordAssigned(s, [1], new Date(2026, 9, 1));
    expect(updated.actual).toEqual({ "1": ["A"] });
    expect(s.actual).toEqual({});
    expect(() => recordAssigned(s, [1, 2], new Date(2026, 9, 1))).toThrow("FUTURE_PERFORMANCE");
    expect(s.actual).toEqual({});
  });

  it("counts only actual records from other closed months without mutating baseline or counting regeneration", () => {
    const s = sample();
    s.assignments = { "1": ["A"], "2": ["A"] };
    s.actual = { "1": ["B"] };
    const closed = closeMonth(s);
    expect(() => closeMonth(closed)).toThrow("MONTH_ALREADY_CLOSED");
    const next = switchMonth(closed, { "2026-10": closed }, 2026, 11);
    const input = cumulativeInput(next, { "2026-10": closed });
    expect(input.teachers.map((t) => t.past)).toEqual([2, 1]);
    expect(cumulativeInput(closed, { "2026-10": closed }).teachers.map((t) => t.past)).toEqual([2, 0]);
    expect(next.input.teachers.map((t) => t.past)).toEqual([2, 0]);
    expect(
      cumulativeInput(next, { "2026-10": { ...closed, actual: { "1": ["B"], "2": ["B"] } } }).teachers[1]?.past,
    ).toBe(2);
  });
  it("restores distinct months and clears month-specific conditions for a new month", () => {
    const s = sample();
    const first = s.input.teachers[0];
    if (!first) throw new Error("missing fixture");
    first.fixed = [31];
    s.input.exam = [5];
    s.memo = { "5": "합성 메모" };
    const next = switchMonth(s, {}, 2026, 11);
    expect(next.input.teachers[0]?.fixed).toEqual([]);
    expect(next.input.exam).toEqual([]);
    const restored = decodeBackup(encodeBackup({ "2026-10": s, "2026-11": next }));
    expect(restored?.["2026-10"]?.memo).toEqual(s.memo);
    expect(switchMonth(next, restored ?? {}, 2026, 10)).toEqual(restored?.["2026-10"]);
    expect(decodeBackup('{"format":"teacherdeck-duty-v1","months":{"invalid":{}}}')).toBeNull();
  });
  it("preserves one-person exam days and excludes non-participants in the optimizer", () => {
    const s = sample();
    s.input.perDay = 2;
    s.input.exam = [1];
    s.input.excluded = Array.from({ length: 30 }, (_, i) => i + 2);
    const first = s.input.teachers[0];
    if (!first) throw new Error("missing fixture");
    first.participating = false;
    expect(plan(s.input)).toEqual({
      assignments: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), i === 0 ? ["B"] : []])),
      issues: [],
    });
    first.fixed = [1];
    expect(plan(s.input).issues.length).toBeGreaterThan(0);
  });
  it("exports dates, actual records, notes, quoted CSV and original JSON keys", () => {
    const s = sample();
    s.assignments = { "1": ["A"] };
    s.actual = { "1": ["B"] };
    s.memo = { "1": '합성,"메모"' };
    s.closed = true;
    const csv = exportCsv(s);
    expect(csv).toContain('"합성,""메모"""');
    const v = JSON.parse(exportLegacy({ "2026-10": s }));
    expect(v.months[0].data[0].final1).toBe("교사A");
    expect(v.counts).toContainEqual({ name: "교사B", count: 1 });
  });
  it("persists monthly keys through SDK and rejects damaged archive values", async () => {
    const store = new Map<string, unknown>();
    const host = createMockHost({
      module: { id: "duty-planner", version: "0.3.0" },
      granted: ["storage"],
      handlers: {
        "storage.keys": () => [...store.keys()],
        "storage.get": (args) => store.get((args as { key: string }).key) ?? null,
        "storage.set": (args) => {
          const a = args as { key: string; value: unknown };
          store.set(a.key, a.value);
          return null;
        },
      },
    });
    const deck = await connect({ window: host.window });
    const s = sample();
    await saveMonth(deck, s);
    expect((await loadMonths(deck))["2026-10"]?.input).toEqual(s.input);
    store.set("planner.month.2026-11", {});
    await expect(loadMonths(deck)).rejects.toThrow("STORED_DATA_INVALID");
    deck.dispose();
  });
});
