// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { SchoolDataDocument } from "@deck/sdk";
import type { TimeAlertRosterPhotosPreview } from "../generated/TimeAlertRosterPhotosPreview.ts";
import {
  collectStudents,
  matchPhotos,
  ambiguousAnchorCoordinates,
  type Anchor,
  type Student,
} from "./school-roster-ooxml.ts";
import { readWorkbook, rosterFromWorkbook, relationships, xml, elements, attr } from "./school-workbook.ts";
import { appendRoster, newId } from "./school-data-model.ts";

export interface RosterPhotoRow {
  rowKey: string;
  grade: number;
  classNumber: number;
  number: number;
  name: string;
  photoKey: string;
  suggestionKey: string;
  existingStudentId: string;
  warning: string;
}
/** Existing source-matching rules prove a unique photo position, never an inferred student identity. */
export async function rosterPhotoRows(
  preview: TimeAlertRosterPhotosPreview,
): Promise<{ rows: RosterPhotoRow[]; warnings: string[] }> {
  const sheet = await readWorkbook(preview.workbook),
    parts = preview.workbook.parts;
  const links = relationships(parts, sheet.partKey),
    anchors: Anchor[] = [];
  const opaque = new Map(preview.photoKeys.map((p) => [p.partKey, p.photoKey]));
  for (const drawing of elements(xml(parts[sheet.partKey] ?? ""), "drawing")) {
    const path = links.get(attr(drawing, "id"));
    if (!path || !parts[path]) throw new Error("사진 위치 정보를 읽지 못했어요. 원본을 확인해 주세요.");
    const photoLinks = relationships(parts, path);
    for (const block of [
      ...elements(xml(parts[path] ?? ""), "twoCellAnchor"),
      ...elements(xml(parts[path] ?? ""), "oneCellAnchor"),
    ]) {
      const from = elements(block, "from")[0],
        blip = elements(block, "blip")[0];
      if (!from || !blip) continue;
      const row = Number(elements(from, "row")[0]?.textContent),
        col = Number(elements(from, "col")[0]?.textContent);
      const part = photoLinks.get(attr(blip, "embed")),
        key = part ? opaque.get(part) : undefined;
      if (key && Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 20000 && col >= 0 && col < 512)
        anchors.push({ row, col, key });
      if (anchors.length > 1000) throw new Error("사진 대응은 1,000명 이내로 나누어 주세요.");
    }
  }
  let students = collectStudents(sheet.cells, sheet.name).students;
  const parsed = rosterFromWorkbook(sheet);
  if (!students.length) {
    students = parsed.text.split("\n").map((line, index): Student => {
      const [grade, classNumber, number, ...nameParts] = line.split(","),
        name = nameParts.join(",");
      // A regular table has a different layout; without proven coordinates, require explicit photo selection.
      return {
        row: index,
        col: -1,
        text: line,
        grade: Number(grade),
        classNumber: Number(classNumber),
        number: Number(number),
        name,
        sheet: sheet.name,
        identityConfirmed: false,
      };
    });
  }
  if (students.length > 1000) throw new Error("사진 대응은 1,000명 이내로 나누어 주세요.");
  const matched = matchPhotos(students, anchors),
    ambiguous = ambiguousAnchorCoordinates(anchors).size;
  return {
    rows: matched.map((s, index) => ({
      rowKey: `row-${index}`,
      grade: s.grade,
      classNumber: s.classNumber,
      number: s.number,
      name: s.name,
      photoKey: s.identityConfirmed ? (s.photoKey ?? "") : "",
      suggestionKey: s.suggestionKey ?? (!s.identityConfirmed ? (s.photoKey ?? "") : ""),
      existingStudentId: "",
      warning: s.identityWarning ?? (!s.identityConfirmed ? "학적·이름과 사진을 직접 확인해 주세요." : ""),
    })),
    warnings: [
      ...parsed.warnings.filter((w) => !w.includes("사진 선택")),
      ...(ambiguous ? [`${ambiguous}곳에 서로 다른 사진이 겹쳐 자동 확정하지 않았어요.`] : []),
    ],
  };
}
/** Explicit old-master links preserve identity across semesters; equal names are never sufficient. */
export function rosterPhotoDocument(
  before: SchoolDataDocument,
  semesterId: string,
  rows: RosterPhotoRow[],
  id: () => string = newId,
): { document: SchoolDataDocument; matches: { rowKey: string; studentId: string; photoKey: string }[] } {
  let document = structuredClone(before);
  const matches: { rowKey: string; studentId: string; photoKey: string }[] = [];
  const identities = new Set<string>();
  for (const row of rows) {
    const identity = `${row.grade}:${row.classNumber}:${row.number}`;
    if (identities.has(identity)) throw new Error("중복 학적을 확인해 주세요.");
    identities.add(identity);
    let enrollment = document.enrollments.find(
      (e) =>
        e.semesterId === semesterId &&
        e.grade === row.grade &&
        e.classNumber === row.classNumber &&
        e.studentNumber === row.number,
    );
    if (enrollment) {
      const student = document.students.find((s) => s.id === enrollment?.studentId);
      if (student?.name !== row.name || (row.existingStudentId && row.existingStudentId !== student.id))
        throw new Error("현재 학적의 학생과 다른 이름·연결이 있어요. 기존 명부를 먼저 확인해 주세요.");
    } else {
      const beforeIds = new Set(document.students.map((s) => s.id));
      document = appendRoster(document, semesterId, `${row.grade},${row.classNumber},${row.number},${row.name}`, id);
      enrollment = document.enrollments.find(
        (e) =>
          e.semesterId === semesterId &&
          e.grade === row.grade &&
          e.classNumber === row.classNumber &&
          e.studentNumber === row.number,
      );
      if (!enrollment) throw new Error("학적을 만들지 못했어요.");
      if (row.existingStudentId) {
        if (
          !beforeIds.has(row.existingStudentId) ||
          document.enrollments.some(
            (e) => e.id !== enrollment?.id && e.semesterId === semesterId && e.studentId === row.existingStudentId,
          )
        )
          throw new Error("기존 학생의 이번 학기 연결을 확인해 주세요.");
        const created = enrollment.studentId;
        enrollment.studentId = row.existingStudentId;
        document.students = document.students.filter((s) => s.id !== created);
      }
    }
    if (row.photoKey) matches.push({ rowKey: row.rowKey, studentId: enrollment.studentId, photoKey: row.photoKey });
  }
  return { document, matches };
}
