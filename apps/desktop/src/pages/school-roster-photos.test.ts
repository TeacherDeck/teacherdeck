// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { rosterPhotoRows, rosterPhotoDocument, type RosterPhotoRow } from "./school-roster-photos.ts";
import { emptyDocument, appendRoster } from "./school-data-model.ts";
import type { TimeAlertRosterPhotosPreview } from "../generated/TimeAlertRosterPhotosPreview.ts";
function preview(overlap = false): TimeAlertRosterPhotosPreview {
  const anchor = (rel: string) =>
    `<oneCellAnchor><from><row>0</row><col>0</col></from><pic><blip r:embed="${rel}"/></pic></oneCellAnchor>`;
  return {
    sessionHandle: "synthetic",
    expectedRevision: 0,
    document: null,
    photoKeys: [
      { partKey: "xl/media/first.png", photoKey: "photo-a", thumbnailBase64: null },
      { partKey: "xl/media/second.png", photoKey: "photo-b", thumbnailBase64: null },
    ],
    workbook: {
      photoCount: 2,
      parts: {
        "xl/workbook.xml": '<workbook xmlns:r="urn:r"><sheets><sheet name="합성" r:id="sheet"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="sheet" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml":
          '<worksheet xmlns:r="urn:r"><sheetData><row><c r="A2" t="inlineStr"><is><t>1학년 2반 3번 합성학생</t></is></c></row></sheetData><drawing r:id="drawing"/></worksheet>',
        "xl/worksheets/_rels/sheet1.xml.rels":
          '<Relationships><Relationship Id="drawing" Target="../drawings/drawing.xml"/></Relationships>',
        "xl/drawings/drawing.xml": `<wsDr xmlns:r="urn:r">${anchor("a")}${overlap ? anchor("b") : ""}</wsDr>`,
        "xl/drawings/_rels/drawing.xml.rels":
          '<Relationships><Relationship Id="a" Target="../media/first.png"/><Relationship Id="b" Target="../media/second.png"/></Relationships>',
      },
    },
  };
}
function seeded() {
  const d = emptyDocument();
  for (const [id, term] of [
    ["old", 1],
    ["next", 2],
  ] as const)
    d.semesters.push({
      id,
      academicYear: 2026,
      term,
      startDate: term === 1 ? "2026-03-01" : "2026-08-01",
      endDate: term === 1 ? "2026-07-31" : "2026-12-31",
      readOnly: false,
      archived: false,
    });
  let n = 0;
  return appendRoster(d, "old", "1,2,3,합성학생", () => `id-${++n}`);
}
function row(): RosterPhotoRow {
  return {
    rowKey: "row-0",
    grade: 2,
    classNumber: 3,
    number: 4,
    name: "합성학생",
    photoKey: "photo-a",
    suggestionKey: "",
    existingStudentId: "",
    warning: "",
  };
}
describe("native photo-roster review", () => {
  it("confirms only a unique anchor and retains opaque native media keys", async () => {
    const parsed = await rosterPhotoRows(preview());
    expect(parsed.rows[0]?.photoKey).toBe("photo-a");
    expect(parsed.rows[0]?.existingStudentId).toBe("");
  });
  it("overlapping different images remain unconfirmed even through a fallback", async () => {
    const parsed = await rosterPhotoRows(preview(true));
    expect(parsed.rows[0]?.photoKey).toBe("");
    expect(parsed.rows[0]?.suggestionKey).toBe("");
    expect(parsed.warnings.join(" ")).toContain("겹쳐");
  });
  it("rejects external relationships before generating a roster draft", async () => {
    const input = preview();
    input.workbook.parts["xl/drawings/_rels/drawing.xml.rels"] =
      '<Relationships><Relationship Id="a" Target="https://invalid.example.invalid/photo" TargetMode="External"/></Relationships>';
    await expect(rosterPhotoRows(input)).rejects.toThrow("외부");
  });
  it("equal names create distinct masters unless the teacher explicitly connects the old student", () => {
    const before = seeded();
    let n = 20;
    const automatic = rosterPhotoDocument(before, "next", [row()], () => `id-${++n}`);
    expect(automatic.document.students).toHaveLength(2);
    const linked = rosterPhotoDocument(
      before,
      "next",
      [{ ...row(), existingStudentId: before.students[0]?.id ?? "missing" }],
      () => `id-${++n}`,
    );
    expect(linked.document.students).toHaveLength(1);
    expect(linked.matches[0]?.studentId).toBe(before.students[0]?.id);
    expect(linked.document.enrollments.filter((e) => e.studentId === before.students[0]?.id)).toHaveLength(2);
    expect(before.enrollments).toHaveLength(1);
  });
  it("rejects duplicate academic identity and conflicting current enrollment without mutating saved data", () => {
    const before = seeded();
    expect(() => rosterPhotoDocument(before, "next", [row(), row()])).toThrow("중복");
    expect(() =>
      rosterPhotoDocument(before, "old", [{ ...row(), grade: 1, classNumber: 2, number: 3, name: "합성다른" }]),
    ).toThrow("다른 이름");
    expect(before.students[0]?.name).toBe("합성학생");
  });
});
