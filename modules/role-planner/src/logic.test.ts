// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: unit tests for pure logic, mock-host tests for host calls (see modules/timer).
import { describe, expect, it } from "vitest";
import {
  applySetup,
  changePerformer,
  complete,
  completeSelected,
  conditions,
  decodeState,
  draftErrors,
  emptyState,
  generate,
  nextCycle,
  parseJobs,
  parseRoster,
  parseTaskRoster,
  setCondition,
  totalCount,
  undoCompletion,
} from "./logic.ts";

function fixture() {
  let id = 0;
  return applySetup(
    emptyState(),
    parseRoster("1\t학생가\t0\n2\t학생나\t8\n3\t학생다\t0\n4\t학생라\t1", [], () => `s${++id}`),
    [
      { id: "j1", title: "진행", capacity: 1 },
      { id: "j2", title: "기록", capacity: 1 },
    ],
    "합성 배정",
  );
}
describe("role allocation and actual performance", () => {
  it("restores temporary identity and baseline only after explicit same-person confirmation", () => {
    const original = fixture(),
      first = original.students[0];
    if (!first) throw new Error("fixture");
    first.baseCount = 7;
    const done = complete(
      generate(setCondition(original, first.id, false, "j1"), "return-draft", () => 0),
      first.id,
      "return-event",
      "2026-10-01T00:00:00Z",
    );
    const removed = decodeState(applySetup(done, done.students.slice(1), done.jobs, done.label));
    const text = `1\t${first.name}\n2\t${done.students[1]?.name}`;
    expect(parseTaskRoster(removed, text)[0]?.id).not.toBe(first.id);
    const restored = decodeState(applySetup(removed, parseTaskRoster(removed, text, true), done.jobs, done.label));
    expect(restored.students[0]).toEqual(first);
    expect(totalCount(restored, first.id)).toBe(8);
    expect(restored.events).toEqual(done.events);
    expect(() =>
      parseTaskRoster({ ...removed, retiredStudents: [first, { ...first, id: "another-class" }] }, text, true),
    ).toThrow("여러 명");
  });
  it("records selected actual performers atomically without recounting completed or excluded students", () => {
    const draft = generate(fixture(), "bulk-draft", () => 0);
    let n = 0;
    const first = completeSelected(draft, ["s1"], "2026-10-01T00:00:00Z", () => `bulk-${++n}`);
    expect(first.events.map((e) => e.studentId)).toEqual(["s1"]);
    expect(totalCount(first, "s3")).toBe(0);
    const second = completeSelected(first, ["s1", "s3"], "2026-10-01T00:00:00Z", () => `bulk-${++n}`);
    expect(second.events.map((e) => e.studentId)).toEqual(["s1", "s3"]);
    expect(totalCount(second, "s1")).toBe(1);
    expect(() => completeSelected(draft, ["s1", "missing"], "2026-10-01T00:00:00Z")).toThrow();
    expect(draft.events).toEqual([]);
    expect(() => completeSelected(draft, ["s1", "s3"], "2026-10-01T00:00:00Z", () => "same-id")).toThrow("중복");
    expect(draft.events).toEqual([]);
  });
  it("assigns only requested capacity to lowest total counts", () => {
    const state = generate(fixture(), "d1", () => 0);
    expect(state.draft).toHaveLength(2);
    expect(state.draft.map((a) => a.studentId)).toEqual(["s1", "s3"]);
    expect(state.events).toEqual([]);
  });
  it("teacher fixed assignment outranks balancing and exclusions are respected", () => {
    let state = setCondition(fixture(), "s2", false, "j1");
    state = setCondition(state, "s1", true, "");
    const draft = generate(state, "d1", () => 0);
    expect(draft.draft).toContainEqual({ studentId: "s2", jobId: "j1" });
    expect(draft.draft).toContainEqual({ studentId: "s3", jobId: "j2" });
    expect(draftErrors(draft)).toEqual([]);
    expect(totalCount(draft, "s2")).toBe(8);
  });
  it("never silently relaxes fixed/excluded or capacity conflicts", () => {
    const conflict = setCondition(fixture(), "s1", true, "j1");
    expect(conditions(conflict).length).toBeGreaterThan(0);
    expect(() => generate(conflict, "d1")).toThrow();
    let full = setCondition(fixture(), "s1", false, "j1");
    full = setCondition(full, "s2", false, "j1");
    expect(() => generate(full, "d1")).toThrow();
  });
  it("swaps or replaces performers but validates fixed conditions", () => {
    const draft = generate(fixture(), "d1", () => 0);
    expect(changePerformer(draft, "s1", "s4").draft).toContainEqual({ studentId: "s4", jobId: "j1" });
    const swapped = changePerformer(draft, "s1", "s3");
    expect(swapped.draft).toEqual([
      { studentId: "s3", jobId: "j1" },
      { studentId: "s1", jobId: "j2" },
    ]);
    const fixed = generate(setCondition(fixture(), "s1", false, "j1"), "d2", () => 0);
    expect(() => changePerformer(fixed, "s1", "s4")).toThrow();
  });
  it("counts actual performance once; blocks modifications until undone or next cycle", () => {
    const draft = generate(fixture(), "d1", () => 0);
    const done = complete(draft, "s1", "e1", "2026-01-01T00:00:00Z");
    expect(totalCount(done, "s1")).toBe(1);
    expect(complete(done, "s1", "e1", "2026-01-01T00:00:00Z")).toBe(done);
    expect(() => complete(done, "s1", "e2", "2026-01-01T00:00:00Z")).toThrow();
    expect(() => generate(done, "d2")).toThrow();
    expect(() => changePerformer(done, "s3", "s4")).toThrow();
    expect(() => setCondition(done, "s3", true, "")).toThrow();
    const undone = undoCompletion(done);
    expect(totalCount(undone, "s1")).toBe(0);
    expect(generate(undone, "d2", () => 0).draftId).toBe("d2");
    expect(totalCount(nextCycle(done), "s1")).toBe(1);
  });
  it("keeps historical performer/name/role through roster and role changes", () => {
    const done = complete(
      generate(fixture(), "d1", () => 0),
      "s1",
      "e1",
      "2026-01-01T00:00:00Z",
    );
    const changed = applySetup(
      done,
      parseRoster("1\t학생새\n2\t학생나", done.students, () => "new1"),
      [{ id: "new-job", title: "새 역할", capacity: 1 }],
      "새 배정",
    );
    expect(changed.events[0]?.name).toBe("학생가");
    expect(changed.events[0]?.jobTitle).toBe("진행");
    expect(decodeState(changed)).toEqual(changed);
  });
  it("rejects duplicate students/jobs and tampered completion/draft state", () => {
    expect(() => parseRoster("1 학생가\n1 학생나")).toThrow();
    expect(() => parseJobs("자료 1\n자료 2")).toThrow();
    expect(() => decodeState({ ...fixture(), excluded: ["missing"] })).toThrow();
    expect(() => decodeState({ ...fixture(), draft: [{ studentId: "s1", jobId: "j1" }], draftId: "d1" })).toThrow();
    const done = complete(
      generate(fixture(), "d1", () => 0),
      "s1",
      "e1",
      "2026-01-01T00:00:00Z",
    );
    expect(() => decodeState({ ...done, draftId: "other" })).toThrow();
  });
  it("maintains maximum actual-count gap one when small roles rotate among all students", () => {
    let id = 0;
    let state = applySetup(
      emptyState(),
      parseRoster("1 학생가\n2 학생나\n3 학생다\n4 학생라", [], () => `s${++id}`),
      [{ id: "j1", title: "자료", capacity: 2 }],
      "합성",
    );
    for (let cycle = 0; cycle < 20; cycle++) {
      state = generate(state, `d${cycle}`, () => 0);
      for (const a of state.draft)
        state = complete(state, a.studentId, `e${cycle}-${a.studentId}`, "2026-01-01T00:00:00Z");
      const counts = state.students.map((s) => totalCount(state, s.id));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      state = nextCycle(state);
    }
  });
});

describe("large classroom allocation", () => {
  it.each([500, 1000])("allocates %i students with 10000 actual records", (size) => {
    let id = 0;
    const students = parseRoster(
      Array.from({ length: size }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"),
      [],
      () => `s${++id}`,
    );
    const jobs = Array.from({ length: 100 }, (_, i) => ({ id: `j${i}`, title: `합성역할${i}`, capacity: size / 100 }));
    const state = {
      ...applySetup(emptyState(), students, jobs, "합성 대규모"),
      cycle: Math.ceil(10000 / size) + 1,
      events: Array.from({ length: 10000 }, (_, i) => ({
        id: `e${i}`,
        draftId: `d${Math.floor(i / size)}`,
        cycle: Math.floor(i / size) + 1,
        studentId: students[i % size]?.id ?? "",
        number: (i % size) + 1,
        name: students[i % size]?.name ?? "",
        jobId: "j0",
        jobTitle: "합성역할0",
        completedAt: "2026-01-01T00:00:00Z",
      })),
    };
    const start = performance.now(),
      result = generate(state, "large", () => 0),
      elapsed = performance.now() - start;
    expect(result.draft).toHaveLength(size);
    expect(draftErrors(result)).toEqual([]);
    expect(decodeState(result).events).toHaveLength(10000);
    expect(elapsed).toBeLessThan(1000);
    console.info(`role ${size} students + 10000 events: ${elapsed.toFixed(2)} ms`);
  });
});
