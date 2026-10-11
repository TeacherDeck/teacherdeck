// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { SchoolRosterSnapshot } from "@deck/sdk";

export interface LinkedStudent { id: string; number: number; name: string; baseCount: number }

/** Stable enrollment identity, independent of name, roster order and current class number. */
export async function linkedStudents(snapshot: SchoolRosterSnapshot, previous: readonly { id: string; baseCount?: number }[]): Promise<LinkedStudent[]> {
  const active = snapshot.students.filter((s) => s.status === "active");
  if (!active.length || active.length > 1000) throw new Error("재학 중인 학생이 1~1,000명인 명부를 선택해 주세요.");
  const oneClass = new Set(active.map((s) => `${s.grade}/${s.classNumber}`)).size === 1;
  const old = new Map(previous.map((s) => [s.id, s.baseCount ?? 0]));
  const result = await Promise.all(active.map(async (s) => {
    const bytes = new TextEncoder().encode(`${snapshot.semester.id}\u0000${s.enrollmentId}`);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const id = `school-${[...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const number = oneClass ? s.studentNumber : s.grade * 100000 + s.classNumber * 1000 + s.studentNumber;
    if (!s.name.trim() || s.name.length > 40 || !Number.isInteger(number) || number < 1 || number > 999999)
      throw new Error("학생의 이름과 학년·반·번호를 공통 자료 설정에서 확인해 주세요.");
    return { id, number, name: s.name, baseCount: old.get(id) ?? 0 };
  }));
  if (new Set(result.map((s) => s.id)).size !== result.length || new Set(result.map((s) => s.number)).size !== result.length)
    throw new Error("명부에 중복된 학생 식별자나 번호가 있어요. 공통 자료 설정에서 확인해 주세요.");
  return result.sort((a, b) => a.number - b.number);
}
