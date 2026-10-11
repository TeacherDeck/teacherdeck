// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type {
  SchoolAccessRequest,
  SchoolAccessResolution,
  SchoolDataDocument,
  SchoolDateChange,
  SchoolDayOverride,
  SchoolDaySlot,
  SchoolGrantRecord,
  SchoolImportPhotoArgs,
  SchoolWorkbookInput,
  SchoolWorkbookOutputArgs,
  SaveSchoolDataArgs,
} from "@deck/sdk";
export interface SchoolDataHost {
  load(): Promise<SchoolDataDocument>;
  save(args: SaveSchoolDataArgs): Promise<SchoolDataDocument>;
  pending(): Promise<SchoolAccessRequest[]>;
  resolveAccess(args: SchoolAccessResolution): Promise<void>;
  grants(): Promise<SchoolGrantRecord[]>;
  revokeGrant(moduleId: string, grantHandle: string): Promise<void>;
  importPhoto(args: SchoolImportPhotoArgs): Promise<SchoolDataDocument>;
  readBackup(): Promise<SchoolDataDocument | null>;
  recover(args: SaveSchoolDataArgs): Promise<SchoolDataDocument>;
  readWorkbook(): Promise<SchoolWorkbookInput | null>;
  writeWorkbook(args: SchoolWorkbookOutputArgs): Promise<boolean>;
}
export function emptyDocument(): SchoolDataDocument {
  return {
    version: 1,
    revision: 0,
    semesters: [],
    students: [],
    enrollments: [],
    contexts: [],
    photos: [],
    timetable: { dayTemplates: [], weeklyTables: [], dayOverrides: [], dateChanges: [] },
  };
}
export const newId = (): string => crypto.randomUUID();
const lines = (text: string) => {
  if (text.length > 1000000) throw new Error("입력은 1,000,000자 이내로 나누어 주세요.");
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => v.split(/[\t,]+/).map((p) => p.trim()));
};
const integer = (value: string | undefined, min: number, max: number) => {
  if (!value || !/^\d+$/.test(value)) throw new Error("숫자 항목을 확인해 주세요.");
  const n = Number(value);
  if (n < min || n > max) throw new Error("숫자 범위를 확인해 주세요.");
  return n;
};
export function appendRoster(
  document: SchoolDataDocument,
  semesterId: string,
  text: string,
  id: () => string = newId,
): SchoolDataDocument {
  const next = structuredClone(document),
    semester = next.semesters.find((s) => s.id === semesterId);
  if (!semester || semester.readOnly) throw new Error("수정할 수 있는 학기를 선택해 주세요.");
  const groups = new Map<string, string[]>();
  for (const row of lines(text)) {
    if (row[0] === "학년") continue;
    if (row.length !== 4) throw new Error("학년, 반, 번호, 이름 순서로 네 항목을 넣어 주세요.");
    const grade = integer(row[0], 1, 9),
      classNumber = integer(row[1], 1, 99),
      studentNumber = integer(row[2], 1, 999),
      name = required(row[3]);
    if (!name || name.length > 40 || Array.from(name).some((c) => c.charCodeAt(0) < 32))
      throw new Error("이름은 40자 이내로 넣어 주세요.");
    let enrollment = next.enrollments.find(
      (e) =>
        e.semesterId === semesterId &&
        e.grade === grade &&
        e.classNumber === classNumber &&
        e.studentNumber === studentNumber,
    );
    if (enrollment) {
      const student = required(next.students.find((s) => s.id === required(enrollment).studentId));
      if (student.name !== name)
        throw new Error("같은 학년·반·번호에 다른 이름이 있어요. 기존 명부에서 먼저 수정해 주세요.");
    } else {
      const studentId = id();
      next.students.push({ id: studentId, name, photoId: null });
      enrollment = { id: id(), studentId, semesterId, grade, classNumber, studentNumber, status: "active" };
      next.enrollments.push(enrollment);
    }
    const key = `${grade}-${classNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    required(groups.get(key)).push(enrollment.id);
  }
  for (const [key, members] of groups) {
    const [grade, classNumber] = key.split("-");
    let context = next.contexts.find(
      (c) => c.kind === "homeroom" && c.semesterId === semesterId && c.label === `${grade}학년 ${classNumber}반`,
    );
    if (!context) {
      context = {
        id: id(),
        semesterId,
        kind: "homeroom",
        label: `${grade}학년 ${classNumber}반`,
        enrollmentIds: [],
        subject: null,
        room: null,
        weeklyTableId: null,
      };
      next.contexts.push(context);
    }
    context.enrollmentIds = [...new Set([...context.enrollmentIds, ...members])];
  }
  return next;
}
export function parseMembership(document: SchoolDataDocument, semesterId: string, text: string): string[] {
  const ids = lines(text).map((r) => {
    if (r.length !== 3) throw new Error("수업 명단은 학년, 반, 번호 순서로 넣어 주세요.");
    const [grade, classNumber, studentNumber] = r.map((v, i) => integer(v, 1, i === 0 ? 9 : i === 1 ? 99 : 999));
    const e = document.enrollments.find(
      (v) =>
        v.semesterId === semesterId &&
        v.grade === grade &&
        v.classNumber === classNumber &&
        v.studentNumber === studentNumber,
    );
    if (!e) throw new Error("학급 명부에 없는 학번이 있어요. 명부를 먼저 추가해 주세요.");
    return e.id;
  });
  if (!ids.length || ids.length > 1000 || new Set(ids).size !== ids.length)
    throw new Error("수업 명단은 중복 없이 1~1,000명으로 넣어 주세요.");
  return ids;
}
const minute = (value: string | undefined) => {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) throw new Error("시각은 09:00처럼 넣어 주세요.");
  const [h, m] = value.split(":").map(Number);
  if (required(h) > 23 || required(m) > 59) throw new Error("시각 범위를 확인해 주세요.");
  return required(h) * 60 + required(m);
};
export function parseDaySlots(text: string): SchoolDaySlot[] {
  const rows = lines(text).map((r) => {
    if (r.length !== 3) throw new Error("교시, 시작 시각, 종료 시각 순서로 넣어 주세요.");
    return { period: integer(r[0], 1, 64), startMinute: minute(r[1]), endMinute: minute(r[2]) };
  });
  if (
    !rows.length ||
    rows.length > 64 ||
    new Set(rows.map((r) => r.period)).size !== rows.length ||
    rows.some((r) => r.startMinute >= r.endMinute)
  )
    throw new Error("일과표의 교시와 시작·종료 순서를 확인해 주세요.");
  return rows;
}
export function parseWeekly(document: SchoolDataDocument, semesterId: string, text: string) {
  const days = ["월", "화", "수", "목", "금", "토", "일"];
  const rows = lines(text).map((r) => {
    if (r.length !== 3) throw new Error("요일, 교시, 수업 이름 순서로 넣어 주세요.");
    const weekday = days.indexOf(required(r[0])) + 1;
    if (!weekday) throw new Error("요일은 월~일로 넣어 주세요.");
    const matches = document.contexts.filter((c) => c.semesterId === semesterId && c.label === r[2]);
    if (matches.length !== 1) throw new Error("수업 이름이 없거나 중복돼요. 수업·분반에서 이름을 확인해 주세요.");
    return { weekday, period: integer(r[1], 1, 64), contextId: required(matches[0]).id };
  });
  if (!rows.length || rows.length > 105 || new Set(rows.map((r) => `${r.weekday}-${r.period}`)).size !== rows.length)
    throw new Error("시간표는 같은 요일·교시를 중복할 수 없어요.");
  return rows;
}
export function newOverride(
  semesterId: string,
  date: string,
  weekday: number,
  dayTemplateId: string,
  weeklyTableId: string,
): SchoolDayOverride {
  return {
    id: newId(),
    semesterId,
    date,
    substituteWeekday: weekday || null,
    dayTemplateId: dayTemplateId || null,
    weeklyTableId: weeklyTableId || null,
  };
}
export function newChange(
  semesterId: string,
  date: string,
  contextId: string,
  kind: SchoolDateChange["kind"],
  from: number,
  to: number,
): SchoolDateChange {
  return {
    id: newId(),
    semesterId,
    date,
    contextId,
    kind,
    fromPeriod: kind === "ADD" ? null : from,
    toPeriod: kind === "CANCEL" ? null : to,
    changeGroupId: null,
  };
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("자료에 필요한 항목을 찾지 못했어요.");
  return value;
}
