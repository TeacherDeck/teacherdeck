// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import type { SchoolRosterSnapshot } from "@deck/sdk";
import { linkedStudents } from "./school-roster.ts";

function fixture(): SchoolRosterSnapshot {
  return {
    snapshotId: "snapshot",
    revision: 1,
    semester: {
      id: "semester",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    },
    context: {
      contextId: "context",
      semesterId: "semester",
      kind: "division",
      label: "합성 수업",
      memberCount: 2,
      revision: 1,
    },
    students: [1, 2].map((n) => ({
      studentId: `student-${n}`,
      enrollmentId: `enrollment-${n}`,
      grade: 1,
      classNumber: n,
      studentNumber: 1,
      displayStudentCode: `1-${n}-1`,
      name: "합성학생",
      status: "active",
    })),
  };
}
describe("shared roster identity", () => {
  it("keeps equal names and numbers in different classes distinct", async () => {
    const rows = await linkedStudents(fixture(), []);
    expect(rows.map((s) => s.number)).toEqual([101001, 102001]);
    expect(new Set(rows.map((s) => s.id)).size).toBe(2);
    expect(rows.every((s) => s.id.length <= 80)).toBe(true);
  });
  it("preserves counts across a name/number change and isolates a different semester", async () => {
    const snapshot = fixture();
    const before = await linkedStudents(snapshot, []);
    const first = before[0];
    if (!first) throw new Error("fixture");
    first.baseCount = 7;
    snapshot.students = snapshot.students.map((s) => ({ ...s, name: "합성학생수정", studentNumber: 2 }));
    const after = await linkedStudents(snapshot, before);
    expect(after.map((s) => [s.id, s.baseCount])).toEqual(before.map((s) => [s.id, s.baseCount]));
    snapshot.semester.id = "next-semester";
    expect((await linkedStudents(snapshot, before)).every((s) => s.baseCount === 0)).toBe(true);
  });
  it("does not silently merge duplicate identities and excludes inactive enrollments", async () => {
    const snapshot = fixture();
    snapshot.students = snapshot.students.map((s) => ({ ...s, enrollmentId: "duplicate" }));
    await expect(linkedStudents(snapshot, [])).rejects.toThrow("중복");
    const inactive = fixture();
    inactive.students = inactive.students.map((s) => ({ ...s, status: "transferred" }));
    await expect(linkedStudents(inactive, [])).rejects.toThrow("재학");
  });
});
