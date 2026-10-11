// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  applyWorkbookTimetable,
  readWorkbook,
  rosterFromWorkbook,
  rosterRows,
  timetableFromWorkbook,
  timetableRows,
} from "./school-workbook.ts";
import { appendRoster, emptyDocument } from "./school-data-model.ts";
vi.stubGlobal("crypto", webcrypto);
function input(sheet: string) {
  return {
    photoCount: 0,
    parts: {
      "xl/workbook.xml":
        '<workbook xmlns:r="urn:relationships"><sheets><sheet name="합성 시트" r:id="s2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships><Relationship Id="s2" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml": "<worksheet/>",
      "xl/worksheets/sheet2.xml": sheet,
    },
  };
}
const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
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
  let id = 0;
  return appendRoster(d, "sem", "2,3,1,합성가\n2,3,2,합성나", () => `id${++id}`);
}
describe("same-file OOXML and TimeAlert table contracts", () => {
  it("follows first declared worksheet and namespace-neutral shared and inline rich strings", async () => {
    const source = input(
      `<worksheet xmlns="urn:sheet"><sheetData><row>${inline("A1", "학년*")}${inline("B1", "학급")}${inline("C1", "출석번호")}${inline("D1", "성명")}</row><row><c r="A2"><v>2.0</v></c><c r="B2"><v>3</v></c><c r="C2"><v>1</v></c><c r="D2" t="s"><v>0</v></c></row></sheetData></worksheet>`,
    );
    source.parts["xl/sharedStrings.xml" as keyof typeof source.parts] =
      '<sst xmlns="urn:sheet"><si><r><t>합성</t></r><r><t>가</t></r></si></sst>';
    const sheet = await readWorkbook(source),
      roster = rosterFromWorkbook(sheet);
    expect(sheet.name).toBe("합성 시트");
    expect(roster.text).toBe("2,3,1,합성가");
  });
  it("reads five-digit student code, photo-roster text, and reports binary-photo limits", async () => {
    const sheet = await readWorkbook({
      ...input(
        `<worksheet><sheetData><row>${inline("A1", "학번")}${inline("B1", "이름")}</row><row>${inline("A2", "20301")}${inline("B2", "합성가")}</row></sheetData></worksheet>`,
      ),
      photoCount: 2,
    });
    expect(rosterFromWorkbook(sheet).text).toBe("2,3,1,합성가");
    expect(sheet.warnings[0]).toContain("사진 2장");
    expect(
      rosterFromWorkbook({
        name: "합성",
        partKey: "xl/worksheets/sheet1.xml",
        rows: [],
        cells: [{ row: 2, col: 1, text: "2학년 3반 1번 합성가" }],
        warnings: [],
      }).text,
    ).toBe("2,3,1,합성가");
  });
  it("parses original grid, transposed grid, legacy list and merged period groups", () => {
    const base = { name: "합성", partKey: "xl/worksheets/sheet1.xml", cells: [], warnings: [] };
    const row = timetableFromWorkbook({
      ...base,
      rows: [
        ["", "월", "화", "수", "목", "금"],
        ["1", "수학 2-3 과학실", "", "", "", ""],
        ["2", "", "물리", "", "", ""],
      ],
    });
    expect(row.lessons.map((l) => [l.weekday, l.period, l.subject, l.hint])).toEqual([
      [1, 1, "수학", "2-3 과학실"],
      [2, 2, "물리", ""],
    ]);
    const column = timetableFromWorkbook({
      ...base,
      rows: [
        ["", "1", "2"],
        ["월", "수학", ""],
        ["화", "", "물리"],
      ],
    });
    expect(column.lessons).toHaveLength(2);
    const legacy = timetableFromWorkbook({
      ...base,
      rows: [
        ["요일", "교시", "과목", "분반", "교실"],
        ["월", "1", "수학", "합성A", "과학실"],
      ],
    });
    expect(required(legacy.lessons[0]).division).toBe("합성A");
    const merged = timetableFromWorkbook({
      ...base,
      rows: [
        ["", "월", "화"],
        ["1", "수학", ""],
        ["1", "2-3", ""],
        ["1", "과학실", ""],
      ],
    });
    expect(merged.lessons).toHaveLength(1);
    expect(required(merged.lessons[0]).hint).toBe("2-3 과학실");
  });
  it("expands merged cells with bounded range while keeping sparse photo coordinates", async () => {
    const sheet = await readWorkbook(
      input(
        `<worksheet><sheetData><row>${inline("A1", "합성")}</row></sheetData><mergeCells><mergeCell ref="A1:B2"/></mergeCells></worksheet>`,
      ),
    );
    expect(sheet.rows).toEqual([
      ["합성", "합성"],
      ["합성", "합성"],
    ]);
    expect(sheet.cells).toHaveLength(1);
    await expect(
      readWorkbook(input('<worksheet><mergeCells><mergeCell ref="A1:ZZ20000"/></mergeCells></worksheet>')),
    ).rejects.toThrow();
  });
  it("applies parsed weekly entries after preview with academic class membership and emits reimportable standard rows", () => {
    const d = seeded(),
      parsed = timetableFromWorkbook({
        name: "합성",
        partKey: "xl/worksheets/sheet1.xml",
        cells: [],
        warnings: [],
        rows: [
          ["", "월", "화"],
          ["1", "수학 2-3 과학실", ""],
        ],
      }),
      next = applyWorkbookTimetable(d, "sem", "합성 시간표", parsed.lessons);
    expect(d.timetable.weeklyTables).toHaveLength(0);
    const c = required(next.contexts.find((c) => c.label === "수학 2-3"));
    expect(c.enrollmentIds).toHaveLength(2);
    expect(rosterRows(next, "sem")).toEqual([
      ["학년", "반", "번호", "이름"],
      ["2", "3", "1", "합성가"],
      ["2", "3", "2", "합성나"],
    ]);
    const rows = timetableRows(next, required(next.timetable.weeklyTables[0]).id),
      roundtrip = timetableFromWorkbook({
        name: "합성",
        partKey: "xl/worksheets/sheet1.xml",
        rows,
        cells: [],
        warnings: [],
      });
    expect(required(roundtrip.lessons[0]).subject).toBe("수학");
    expect(required(roundtrip.lessons[0]).hint).toBe("2-3");
  });
  it("rejects DTD, external relationships, missing strings, excessive cells without changing current data", async () => {
    await expect(readWorkbook(input("<!DOCTYPE sheet><worksheet/>"))).rejects.toThrow();
    const external = input("<worksheet/>");
    external.parts["xl/_rels/workbook.xml.rels"] =
      '<Relationships><Relationship Id="s2" Target="https://invalid.example/sheet.xml" TargetMode="External"/></Relationships>';
    await expect(readWorkbook(external)).rejects.toThrow("외부");
    await expect(readWorkbook(input('<worksheet><c r="A1" t="s"><v>99</v></c></worksheet>'))).rejects.toThrow("공유");
  });
  it("accepts legal OPC root-relative paths used by both original TimeAlert templates and rejects root escape", async () => {
    const source = input(`<worksheet><sheetData><row>${inline("A1", "합성")}</row></sheetData></worksheet>`);
    source.parts["xl/_rels/workbook.xml.rels"] =
      '<Relationships><Relationship Id="s2" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
    expect((await readWorkbook(source)).rows).toEqual([["합성"]]);
    source.parts["xl/_rels/workbook.xml.rels"] =
      '<Relationships><Relationship Id="s2" Target="/../xl/worksheets/sheet2.xml"/></Relationships>';
    await expect(readWorkbook(source)).rejects.toThrow("내부 연결");
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("자료에 필요한 항목을 찾지 못했어요.");
  return value;
}
