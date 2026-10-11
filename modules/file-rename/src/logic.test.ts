// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: unit tests for pure logic, mock-host tests for host calls (see modules/timer).
import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH, matchRows, metadataFrom, nameError, preview, type Entry, type ExcelRow } from "./logic.ts";
const entry = (name: string, id = name): Entry => ({
  file: { name, handle: id, ext: name.split(".").at(-1) ?? "", size: 5, modifiedAt: 0 },
});
const rows: ExcelRow[] = [
  { row: 2, values: { 학번: "00101", 번호: "01", 이름: "가상학생가", 기존이름: "00101_자료.PDF" } },
  { row: 3, values: { 학번: "00102", 번호: "2", 이름: "가상학생나", 기존이름: "00102_자료.PDF" } },
];
describe("exact spreadsheet mapping", () => {
  it("preserves student-ID zeroes, case and blank keys", () => {
    const list = [entry("00101_자료.PDF"), entry("101_자료.PDF"), entry("_공란.PDF")];
    const result = matchRows(list, rows, DEFAULT_MATCH);
    expect(result.linked.size).toBe(1);
    expect(result.linked.get(list[0]?.file.handle ?? "")?.row).toBe(2);
    expect(result.unused.map((r) => r.row)).toEqual([3]);
  });
  it("normalizes numeric numbers only after explicit opt-in", () => {
    const files = [entry("1_자료.txt")];
    const options = { ...DEFAULT_MATCH, mode: "number" as const, column: "번호" };
    expect(matchRows(files, rows, options).linked.size).toBe(0);
    expect(matchRows(files, rows, { ...options, normalizeNumber: true }).linked.size).toBe(1);
    expect(
      matchRows(files, rows, { ...options, mode: "student", column: "학번", normalizeNumber: true }).linked.size,
    ).toBe(0);
  });
  it("never guesses through duplicate row/file keys or same-row manual connections", () => {
    const duplicates = [required(rows[0]), { row: 4, values: { ...required(rows[0]).values } }];
    expect(matchRows([entry("00101_a.txt")], duplicates, DEFAULT_MATCH).linked.size).toBe(0);
    const files = [entry("00101_a.txt"), entry("00101_b.txt")];
    expect(matchRows(files, rows, DEFAULT_MATCH).linked.size).toBe(0);
    expect(
      matchRows(
        files.map((e) => ({ ...e, manualRow: 2 })),
        rows,
        DEFAULT_MATCH,
      ).linked.size,
    ).toBe(0);
    expect(
      matchRows(
        [
          { ...required(files[0]), manualRow: 2 },
          { ...required(files[1]), manualRow: 3 },
        ],
        rows,
        DEFAULT_MATCH,
      ).linked.size,
    ).toBe(2);
  });
  it("supports exact old-name matching and explicit current order", () => {
    expect(
      matchRows([entry("00101_자료.PDF")], rows, {
        ...DEFAULT_MATCH,
        mode: "oldname",
        column: "기존이름",
        delimiter: "",
      }).linked.size,
    ).toBe(1);
    expect(
      matchRows([entry("00101_자료.pdf")], rows, {
        ...DEFAULT_MATCH,
        mode: "oldname",
        column: "기존이름",
        delimiter: "",
      }).linked.size,
    ).toBe(0);
    const first = entry("a.txt"),
      second = entry("b.txt");
    const result = matchRows([second, first], rows, { ...DEFAULT_MATCH, mode: "order" });
    expect(result.linked.get(second.file.handle)?.row).toBe(2);
  });
});
describe("preview before mutation", () => {
  const naming = { pattern: "{연번}_{원본}_{yymmdd}", start: 7, digits: 3, date: "2026-10-11" };
  it("fixes the date and preserves original extension case", () => {
    expect(preview([entry("자료.PDF")], naming, "pattern", [], DEFAULT_MATCH)[0]?.name).toBe("007_자료_261011.PDF");
  });
  it("blocks unknown/empty/prototype variables, invalid dates and unsafe filenames", () => {
    for (const pattern of ["{missing}", "{constructor}", "{toString}", "NUL", "bad/path"]) {
      expect(
        preview([entry("자료.pdf")], { ...naming, pattern }, "pattern", [], DEFAULT_MATCH)[0]?.errors.length,
      ).toBeGreaterThan(0);
    }
    expect(
      preview([entry("자료.pdf")], { ...naming, date: "2026-02-30" }, "pattern", [], DEFAULT_MATCH)[0]?.errors.length,
    ).toBeGreaterThan(0);
    for (const name of ["CON.txt", "COM¹.txt", "bad.", "bad ", "x\\y.txt"]) {
      expect(nameError(name)).toBeTruthy();
    }
  });
  it("keeps manually edited names across three material modes", () => {
    const file = { ...entry("자료.PDF"), edited: "직접 이름.PDF" };
    for (const mode of ["pattern", "excel", "document"] as const) {
      const result = preview([file], naming, mode, [], DEFAULT_MATCH)[0];
      expect(result?.name).toBe("직접 이름.PDF");
      expect(result?.errors).toEqual([]);
    }
  });
  it("retains Excel grade fields and flags case-insensitive output collisions", () => {
    const result = preview(
      [entry("00101_a.txt")],
      { ...naming, pattern: "{학년}_{이름}" },
      "excel",
      [{ row: 2, values: { 학번: "00101", 학년: "2", 이름: "가상학생가" } }],
      DEFAULT_MATCH,
    );
    expect(result[0]?.name).toBe("2_가상학생가.txt");
    expect(
      preview(
        [
          { ...entry("a.txt"), edited: "NEW.txt" },
          { ...entry("b.txt"), edited: "new.TXT" },
        ],
        naming,
        "pattern",
        [],
        DEFAULT_MATCH,
      ).every((row) => row.errors.length),
    ).toBe(true);
  });
  it("plans 500 distinct files without dropping rows", () => {
    const files = Array.from({ length: 500 }, (_, i) => entry(`자료_${i}.txt`));
    const result = preview(files, naming, "pattern", [], DEFAULT_MATCH);
    expect(result).toHaveLength(500);
    expect(result.every((row) => !row.errors.length)).toBe(true);
    expect(result.at(-1)?.name).toBe("506_자료_499_261011.txt");
  });
  it("extracts original document materials without invented blank replacements", () => {
    const meta = metadataFrom("2026학년도 6월 고3 지구과학 모의평가", "fallback.pdf", []);
    expect(meta).toMatchObject({ year: "2026학년도", month: "06", grade: "고3", main: "과학", sub: "지구과학" });
    const result = preview(
      [{ ...entry("doc.pdf"), metadata: metadataFrom("", "doc.pdf", []) }],
      { ...naming, pattern: "{Year}_{Grade}" },
      "document",
      [],
      DEFAULT_MATCH,
    );
    expect(result[0]?.errors.length).toBeGreaterThan(0);
  });
  it("prefers the exam month over an editing date and preserves the school year", () => {
    for (const date of ["2026년 3월 1일", "2026.03.01", "2026-03-01", "2026/03/01"]) {
      expect(metadataFrom(`편집일 ${date}\n2026학년도 9월 고3 모의평가`, "synthetic.pdf", [])).toMatchObject({
        year: "2026학년도",
        month: "09",
      });
    }
    expect(metadataFrom("2026년 3월 1일 작성", "synthetic.pdf", []).month).toBe("");
    expect(metadataFrom("2026.03 안내문", "synthetic.pdf", []).month).toBe("03");
    expect(metadataFrom("13월 모의평가 / 9월 학력평가", "synthetic.pdf", []).month).toBe("09");
  });
  it("labels semester/quarter month guesses and never invents an exam month", () => {
    expect(metadataFrom("2026학년도 2학기 기말고사", "synthetic.pdf", [])).toMatchObject({
      month: "12",
      source: expect.stringContaining("추정"),
    });
    expect(metadataFrom("2026년 3분기 보고서", "synthetic.pdf", [])).toMatchObject({
      month: "09",
      source: expect.stringContaining("추정"),
    });
    expect(metadataFrom("2026학년도 수능특강", "synthetic.pdf", []).month).toBe("");
  });
  it("excludes subject noise and prefers detailed bracket subjects with user override", () => {
    expect(metadataFrom("2026학년도 대학수학능력시험 제3교시", "synthetic.pdf", [])).toMatchObject({
      subject: "영어",
      main: "영어",
    });
    expect(metadataFrom("2026학년도 대학수학능력시험", "synthetic.pdf", []).main).toBe("");
    expect(metadataFrom("과학탐구 영역 (물리학 II)", "synthetic.pdf", [])).toMatchObject({
      subject: "물리학II",
      main: "과학",
      sub: "물리학II",
    });
    expect(metadataFrom("[지구과학] 탐구보고서", "synthetic.pdf", ["탐구보고서"]).subject).toBe("탐구보고서");
    expect(metadataFrom("제2교시 회의록", "synthetic.pdf", []).subject).toBe("회의록");
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("MISSING_FIXTURE");
  return value;
}
