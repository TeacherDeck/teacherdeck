// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: unit tests for pure logic, mock-host tests for host calls (see modules/timer).
import { describe, expect, it } from "vitest";
import {
  available,
  complete,
  decodeState,
  emptyState,
  nextRound,
  parseRoster,
  pick,
  replaceRoster,
  setExcluded,
  skip,
  totalCount,
  undoCompletion,
} from "./logic.ts";

function fixture() {
  let id = 0;
  return replaceRoster(
    emptyState(),
    parseRoster("1\t학생가\t0\n2\t학생나\t4\n3\t학생다\t0", [], () => `s${++id}`),
    "합성 수업",
  );
}
describe("presentation completion and teacher priority", () => {
  it("draws from smallest total, teacher choice overrides balance and exclusions override choice", () => {
    const state = fixture();
    expect(pick(state, "", () => 0).pending?.id).toBe("s1");
    expect(pick(state, "s2", () => 0).pending?.id).toBe("s2");
    expect(() => pick(setExcluded(state, "s2", true), "s2")).toThrow();
  });
  it("never increments on draw, redraw, skip or a new round", () => {
    const state = fixture();
    const first = pick(state, "", () => 0);
    const redraw = pick(first, "", () => 0);
    expect(redraw.pending?.id).toBe("s3");
    expect(totalCount(redraw, "s1")).toBe(0);
    expect(totalCount(skip(redraw), "s3")).toBe(0);
    expect(totalCount(nextRound(redraw), "s3")).toBe(0);
  });
  it("counts completion once, excludes completed in round, undo restores eligibility", () => {
    const first = pick(fixture(), "s1");
    const done = complete(first, "e1", "2026-01-01T00:00:00Z");
    expect(totalCount(done, "s1")).toBe(1);
    expect(available(done).map((s) => s.id)).not.toContain("s1");
    expect(complete(done, "e1", "2026-01-01T00:00:00Z")).toBe(done);
    const undone = undoCompletion(done);
    expect(totalCount(undone, "s1")).toBe(0);
    expect(available(undone).map((s) => s.id)).toContain("s1");
  });
  it("preserves snapshot name and previous events through roster replacement", () => {
    const done = complete(pick(fixture(), "s1"), "e1", "2026-01-01T00:00:00Z");
    const students = parseRoster("1\t학생새\n2\t학생나", done.students, () => "new1");
    const changed = replaceRoster(done, students, "수정");
    expect(changed.events[0]?.name).toBe("학생가");
    expect(changed.students[0]?.id).toBe("new1");
    expect(changed.students[1]?.baseCount).toBe(4);
    expect(decodeState(changed)).toEqual(changed);
  });
  it("supports same names with different numbers; rejects duplicate numbers and invalid imported state", () => {
    let id = 0;
    expect(parseRoster("번호\t이름\n1\t학생가\n2\t학생가", [], () => `s${++id}`)).toHaveLength(2);
    expect(() => parseRoster("1 학생가\n1 학생나")).toThrow();
    expect(() => decodeState({ ...fixture(), excluded: ["missing"] })).toThrow();
    expect(() => decodeState({ ...fixture(), students: [...fixture().students, ...fixture().students] })).toThrow();
  });
  it("clears pending on exclusion; never chooses excluded/skipped/completed students", () => {
    let state = setExcluded(fixture(), "s2", true);
    state = skip(pick(state, "s1"));
    state = complete(pick(state, "s3"), "e1", "2026-01-01T00:00:00Z");
    expect(available(state)).toEqual([]);
    expect(() => pick(state)).toThrow();
    const pending = pick(fixture(), "s1");
    expect(setExcluded(pending, "s1", true).pending).toBeNull();
    expect(available(nextRound(state)).map((s) => s.id)).toEqual(["s1", "s3"]);
  });
  it("completes repeated balanced rounds with maximum total gap one", () => {
    let id = 0;
    let state = replaceRoster(
      emptyState(),
      parseRoster("1 학생가\n2 학생나\n3 학생다", [], () => `s${++id}`),
      "합성",
    );
    for (let i = 0; i < 30; i++) {
      if (!available(state).length) state = nextRound(state);
      state = complete(
        pick(state, "", () => 0),
        `e${i}`,
        "2026-01-01T00:00:00Z",
      );
      const counts = state.students.map((s) => totalCount(state, s.id));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });
});

describe("large classroom selection", () => {
  it.each([500, 1000])("selects from %i students with 10000 actual records", (size) => {
    let id = 0;
    const students = parseRoster(
      Array.from({ length: size }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"),
      [],
      () => `s${++id}`,
    );
    const state = {
      ...replaceRoster(emptyState(), students, "합성 대규모"),
      round: Math.ceil(10000 / size) + 1,
      events: Array.from({ length: 10000 }, (_, i) => ({
        id: `e${i}`,
        studentId: students[i % size]?.id ?? "",
        number: (i % size) + 1,
        name: students[i % size]?.name ?? "",
        round: Math.floor(i / size) + 1,
        completedAt: "2026-01-01T00:00:00Z",
      })),
    };
    const start = performance.now(),
      selected = pick(state, "", () => 0),
      elapsed = performance.now() - start;
    expect(selected.pending).not.toBeNull();
    expect(decodeState(selected).events).toHaveLength(10000);
    expect(elapsed).toBeLessThan(1000);
    console.info(`presenter ${size} students + 10000 events: ${elapsed.toFixed(2)} ms`);
  });
});
