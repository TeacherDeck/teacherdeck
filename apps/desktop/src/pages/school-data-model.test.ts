// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import {
  appendRoster,
  emptyDocument,
  parseDaySlots,
  parseMembership,
  parseWeekly,
  setWeeklyCell,
  setWeeklyEntry,
  formatWeekly,
} from "./school-data-model.ts";
function seeded() {
  const d = emptyDocument();
  d.semesters.push({
    id: "sem",
    academicYear: 2026,
    term: 1,
    startDate: "2026-03-01",
    endDate: "2026-07-31",
    archived: false,
    readOnly: false,
  });
  return d;
}
describe("school data authoring", () => {
  it("keeps distinct IDs for restored classes with the same label while refusing ambiguous pasted labels", () => {
    let serial = 0;
    const d = appendRoster(seeded(), "sem", "1,1,1,합성가\n1,2,1,합성나", () => `id${++serial}`);
    const first = required(d.contexts[0]),
      second = required(d.contexts[1]);
    first.label = second.label = "합성공동";
    const existing = [{ weekday: 1, period: 1, contextId: second.id }];
    const next = setWeeklyEntry(d, "sem", existing, 2, 2, first.id);
    expect(next).toEqual([existing[0], { weekday: 2, period: 2, contextId: first.id }]);
    expect(() => parseWeekly(d, "sem", formatWeekly(d, next))).toThrow("중복");
    expect(existing).toEqual([{ weekday: 1, period: 1, contextId: second.id }]);
  });
  it("replaces and clears grid cells without touching other lessons or losing commas in class names", () => {
    let serial = 0;
    const d = appendRoster(seeded(), "sem", "1,1,1,합성가\n1,2,1,합성나", () => `id${++serial}`);
    const first = required(d.contexts[0]),
      second = required(d.contexts[1]);
    second.label = "합성과학, 심화";
    let text = setWeeklyCell(d, "sem", "", 1, 1, first.id);
    text = setWeeklyCell(d, "sem", text, 7, 64, second.id);
    text = setWeeklyCell(d, "sem", text, 1, 1, second.id);
    expect(parseWeekly(d, "sem", text)).toEqual([
      { weekday: 1, period: 1, contextId: second.id },
      { weekday: 7, period: 64, contextId: second.id },
    ]);
    const cleared = setWeeklyCell(d, "sem", text, 1, 1, "");
    expect(parseWeekly(d, "sem", cleared)).toEqual([{ weekday: 7, period: 64, contextId: second.id }]);
    expect(() => setWeeklyCell(d, "sem", "월,1,없는 수업", 2, 2, first.id)).toThrow("수업 이름");
    expect(() => setWeeklyCell(d, "sem", text, 1, 1, "missing")).toThrow("이 학기의");
    required(d.semesters[0]).readOnly = true;
    expect(() => setWeeklyCell(d, "sem", text, 1, 1, "")).toThrow("수정할 수");
  });
  it("keeps same names and class numbers distinct, rejects identity conflicts without touching original", () => {
    let serial = 0;
    const d = appendRoster(seeded(), "sem", "학년,반,번호,이름\n1,1,1,합성가\n1,2,1,합성가", () => `id${++serial}`);
    expect(d.students).toHaveLength(2);
    expect(d.contexts).toHaveLength(2);
    expect(required(d.enrollments[0]).studentId).not.toBe(required(d.enrollments[1]).studentId);
    const same = appendRoster(d, "sem", "1,1,1,합성가", () => `id${++serial}`);
    expect(same.students).toHaveLength(2);
    expect(() => appendRoster(d, "sem", "1,1,1,다른합성")).toThrow("같은 학년");
    expect(required(d.students[0]).name).toBe("합성가");
    expect(parseMembership(d, "sem", "1,1,1\n1,2,1")).toEqual(d.enrollments.map((e) => e.id));
    expect(() => parseMembership(d, "sem", "1,3,1")).toThrow("학급 명부");
  });
  it("handles 1000 students across classes and preserves roster on invalid rows", () => {
    let serial = 0;
    const rows = Array.from(
      { length: 1000 },
      (_, i) => `1,${Math.floor(i / 100) + 1},${(i % 100) + 1},합성${i + 1}`,
    ).join("\n");
    const started = performance.now(),
      d = appendRoster(seeded(), "sem", rows, () => `id${++serial}`),
      elapsed = performance.now() - started;
    expect(d.enrollments).toHaveLength(1000);
    expect(d.contexts).toHaveLength(10);
    expect(d.students).toHaveLength(1000);
    expect(elapsed).toBeLessThan(500);
    expect(() => appendRoster(d, "sem", "1,1,1,합성1\n1,1,1,충돌")).toThrow();
    expect(d.enrollments).toHaveLength(1000);
  });
  it("keeps period times and timetable memberships as separate validated axes", () => {
    let serial = 0;
    const d = appendRoster(seeded(), "sem", "1,1,1,합성가", () => `id${++serial}`);
    expect(parseDaySlots("1,09:00,09:50\n2,10:00,10:50")).toEqual([
      { period: 1, startMinute: 540, endMinute: 590 },
      { period: 2, startMinute: 600, endMinute: 650 },
    ]);
    expect(required(parseWeekly(d, "sem", "월,1,1학년 1반")[0]).contextId).toBe(required(d.contexts[0]).id);
    expect(() => parseWeekly(d, "sem", "월,1,없는 수업")).toThrow("수업 이름");
    expect(() => parseWeekly(d, "sem", "월,1,1학년 1반\n월,1,1학년 1반")).toThrow("중복");
    expect(() => parseDaySlots("1,09:50,09:00")).toThrow();
    expect(() => parseDaySlots("1,24:01,25:00")).toThrow();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("자료에 필요한 항목을 찾지 못했어요.");
  return value;
}
