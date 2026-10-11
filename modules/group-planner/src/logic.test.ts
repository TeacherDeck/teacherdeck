// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import {
  applySetup,
  conditionErrors,
  confirm,
  decodeState,
  emptyState,
  generate,
  groupErrors,
  moveStudent,
  parsePairs,
  parseRoster,
  setStudentCondition,
  toggleGroupLock,
} from "./logic.ts";
function fixture(size = 8) {
  let id = 0;
  const students = parseRoster(
    Array.from({ length: size }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"),
    [],
    () => `s${++id}`,
  );
  return applySetup(emptyState(), students, "합성 활동", [], "size", 4);
}
describe("group constraints and manual changes", () => {
  it.each([500, 1000])("balances %i students without search and preserves all members", (size) => {
    const state = fixture(size),
      start = performance.now(),
      result = generate(state, () => 0.5);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(groupErrors(result)).toEqual([]);
    expect(result.groups).toHaveLength(Math.ceil(size / 4));
    expect(result.groups.every((g) => g.members.length === 4)).toBe(true);
    expect(decodeState(result)).toEqual(result);
    console.info(`group ${size} students: ${elapsed.toFixed(2)} ms`);
  });
  it("keeps oversized teacher-fixed group before balance", () => {
    let state = fixture();
    for (let i = 1; i <= 6; i++) state = setStudentCondition(state, `s${i}`, false, 1);
    const result = generate(state, () => 0);
    expect(result.groups.map((g) => g.members.length)).toEqual([6, 2]);
    expect(groupErrors(result)).toEqual([]);
  });
  it("handles 1000 students with 200 separation pairs within bounded search", () => {
    const state = fixture(1000);
    state.pairs = Array.from({ length: 200 }, (_, i) => [`s${i * 2 + 1}`, `s${i * 2 + 2}`]);
    const result = generate(state, () => 0.5);
    expect(groupErrors(result)).toEqual([]);
  });
  it("locks whole membership and rejects moves and exclusion conflicts", () => {
    const state = toggleGroupLock(
        generate(fixture(), () => 0),
        1,
      ),
      member = state.groups[0]?.members[0] ?? "";
    expect(generate(state, () => 0.7).groups[0]?.members).toEqual(state.groups[0]?.members);
    expect(() => moveStudent(state, member, 2)).toThrow();
    expect(conditionErrors(setStudentCondition(state, member, true, 0)).length).toBeGreaterThan(0);
    expect(conditionErrors(toggleGroupLock(setStudentCondition(state, member, true, 0), 1))).toEqual([]);
  });
  it("keeps separated pairs apart and reports teacher condition conflicts", () => {
    let state = fixture();
    state = { ...state, pairs: parsePairs("1 2\n2 1", state.students) };
    expect(state.pairs).toHaveLength(1);
    expect(groupErrors(generate(state, () => 0.5))).toEqual([]);
    state = setStudentCondition(setStudentCondition(state, "s1", false, 1), "s2", false, 1);
    expect(() => generate(state)).toThrow(/분리/);
  });
  it("supports manual move and swap, but fixed students cannot change groups", () => {
    const state = generate(fixture(), () => 0.5),
      a = state.groups[0]?.members[0] ?? "",
      b = state.groups[1]?.members[0] ?? "";
    expect(groupErrors(moveStudent(state, a, 2, b))).toEqual([]);
    expect(moveStudent(state, a, 2).groups[1]?.members).toContain(a);
    const fixed = generate(setStudentCondition(fixture(), "s1", false, 1), () => 0.5);
    expect(() => moveStudent(fixed, "s1", 2)).toThrow();
  });
  it("preserves confirmed historical roster, detects repeats and malformed backups", () => {
    const state = confirm(
      generate(fixture(), () => 0.5),
      "history1",
      "2026-01-01T00:00:00Z",
    );
    expect(() => confirm(state, "history2", "2026-01-02T00:00:00Z")).toThrow(/이미 확정/);
    const changed = applySetup(state, fixture(4).students, "다음 활동", [], "count", 2);
    expect(changed.history).toEqual(state.history);
    expect(decodeState(state)).toEqual(state);
    expect(() => decodeState({ ...state, groups: [{ id: 1, members: ["s1", "s1"] }] })).toThrow();
    expect(() => parseRoster("1 이름\n1 다른이름")).toThrow();
    expect(() => parseRoster(Array.from({ length: 1001 }, (_, i) => `${i + 1} 합성학생`).join("\n"))).toThrow();
  });
  it("reports proven impossible separation without changing prior state", () => {
    const state = { ...fixture(4), mode: "count" as const, value: 1, pairs: [["s1", "s2"] as [string, string]] };
    expect(() => generate(state, () => 0.5)).toThrow(/함께 만족할 수 없어요/);
    expect(state.groups).toEqual([]);
  });
});
