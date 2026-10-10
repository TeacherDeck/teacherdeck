// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { unzipLimited } from "./archive.ts";
import { parseParts, resolvePart } from "./ooxml.ts";
import { collectStudents, matchPhotos } from "./roster.ts";
import { planPhotos, safeBase, type Extraction } from "./batch.ts";
import { fixture, fakeJpeg } from "./fixtures.test-support.ts";
const file = { handle: "input-1", name: "합성 명렬표.xls", ext: "xls", size: 100, modifiedAt: 0 };
async function extract(bytes: Uint8Array): Promise<Extraction> {
  const parsed = await parseParts(unzipLimited(bytes));
  return {
    file,
    photos: parsed.photos,
    students: parsed.sheets.flatMap((sheet) => matchPhotos(sheet.students, sheet.anchors)),
    warnings: parsed.warnings,
  };
}
describe("TimeAlert roster extraction parity", () => {
  it.each([14, 24, 33])(
    "keeps all %i students around styled self-closing cells and preserves distinct photo bytes",
    async (count) => {
      const cells = Array.from({ length: count }, (_, i) => ({
        row: Math.floor(i / 8) * 3 + 2,
        col: [0, 2, 5, 7, 9, 12, 16, 21][i % 8] ?? 0,
        text: `3학년 ${(i % 3) + 1}반 ${i + 1}번 가상학생${String.fromCharCode(0xac00 + i)}`,
      }));
      const result = await extract(
        fixture(
          cells,
          cells.map((c) => ({ row: c.row - 1, col: c.col })),
        ),
      );
      expect(result.students).toHaveLength(count);
      expect(result.photos).toHaveLength(count);
      for (const [i, student] of result.students.entries()) {
        expect(student.photoKey).toBe(`xl/media/image${i}.jpeg`);
        expect(result.photos.find((p) => p.key === student.photoKey)?.bytes).toEqual(fakeJpeg(i));
      }
      expect(new Set(planPhotos([result]).map((p) => p.filename)).size).toBe(count);
    },
  );
  it("preserves no-photo students, extra photos and partial exact matches", async () => {
    const result = await extract(
      fixture(
        [
          { row: 2, col: 1, text: "1학년 2반 1번 가상가" },
          { row: 2, col: 5, text: "1학년 2반 2번 가상나" },
          { row: 2, col: 9, text: "1학년 2반 3번 가상다" },
        ],
        [{ row: 1, col: 1 }],
        true,
        { "xl/media/unused.jpeg": fakeJpeg(99) },
      ),
    );
    expect(result.students).toHaveLength(3);
    expect(result.students.filter((s) => s.photoKey)).toHaveLength(1);
    const plans = planPhotos([result]);
    expect(plans).toHaveLength(2);
    expect(plans.find((p) => p.key.includes("unused"))?.filename).toMatch(/^미확인_/);
  });
  it("uses contextual page headers and filters metadata in every pass", () => {
    const cells = [
      { row: 0, col: 0, text: "2026학년도 1학년 7반" },
      { row: 2, col: 0, text: "1번 가상가" },
      { row: 8, col: 0, text: "2학년 3반" },
      { row: 10, col: 0, text: "1번 가상나" },
      { row: 11, col: 0, text: "3번 담임교체" },
      { row: 12, col: 0, text: "담임 : 가상 3학년 3-3-10 반" },
      { row: 13, col: 0, text: "2026.03.02." },
    ];
    const result = collectStudents(cells, "시트");
    expect(result.students.map((s) => [s.grade, s.classNumber, s.number])).toEqual([
      [1, 7, 1],
      [2, 3, 1],
    ]);
    expect(collectStudents([{ row: 1, col: 1, text: "3 2 15 가상가" }], "시트").students[0]?.number).toBe(15);
  });
  it("keeps fallback suggestions unconfirmed and does not assign student names to them", async () => {
    const result = await extract(
      fixture(
        [
          { row: 2, col: 5, text: "1학년 2반 1번 가상가" },
          { row: 2, col: 9, text: "1학년 2반 2번 가상나" },
        ],
        [
          { row: 1, col: 1 },
          { row: 1, col: 5 },
        ],
      ),
    );
    expect(result.students.filter((s) => s.photoKey)).toHaveLength(1);
    expect(result.students.filter((s) => s.suggestionKey)).toHaveLength(1);
    expect(planPhotos([result]).filter((p) => !p.confirmed)[0]?.filename).toMatch(/^미확인_/);
  });
  it("supports workbook relationships, namespaced inline strings and relocated drawing paths", async () => {
    const result = unzipLimited(
      fixture([{ row: 2, col: 1, text: "1학년 2반 1번 가상가" }], [{ row: 1, col: 1 }], false),
    );
    result["xl/workbook.xml"] = strToU8(
      '<w:workbook xmlns:w="urn:book" xmlns:r="urn:rel"><w:sheets><w:sheet name="가상 시트" r:id="sheetRef"/></w:sheets></w:workbook>',
    );
    result["xl/_rels/workbook.xml.rels"] = strToU8(
      '<Relationships><Relationship Target="worksheets/sheet1.xml" Id="sheetRef"/></Relationships>',
    );
    result["xl/worksheets/_rels/sheet1.xml.rels"] = strToU8(
      '<Relationships><Relationship Id="drawingRef" Target="../custom/photo.xml"/></Relationships>',
    );
    result["xl/worksheets/sheet1.xml"] = strToU8(
      new TextDecoder()
        .decode(result["xl/worksheets/sheet1.xml"])
        .replace("</worksheet>", '<drawing xmlns:r="urn:rel" r:id="drawingRef"/></worksheet>'),
    );
    result["xl/custom/photo.xml"] = result["xl/drawings/drawing1.xml"] as Uint8Array<ArrayBuffer>;
    result["xl/custom/_rels/photo.xml.rels"] = result["xl/drawings/_rels/drawing1.xml.rels"] as Uint8Array<ArrayBuffer>;
    const parsed = await parseParts(result);
    expect(parsed.sheets[0]?.name).toBe("가상 시트");
    expect(parsed.sheets[0]?.anchors[0]?.key).toBe("xl/media/image0.jpeg");
  });
});
describe("archive and output safety", () => {
  it("rejects BIFF, malformed paths, external relationships and DTD", async () => {
    expect(() => unzipLimited(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toThrow("INVALID_ARCHIVE");
    expect(() => unzipLimited(zipSync({ "../xl/media/a.jpg": fakeJpeg(1) }))).toThrow("INVALID_ARCHIVE");
    const parts = unzipLimited(fixture([], []));
    parts["xl/drawings/_rels/drawing1.xml.rels"] = strToU8(
      '<Relationships><Relationship Id="a" Target="https://example.invalid/a" TargetMode="External"/></Relationships>',
    );
    await expect(parseParts(parts)).rejects.toThrow("INVALID_RELATIONSHIP");
    const dtd = unzipLimited(fixture([], []));
    dtd["xl/worksheets/sheet1.xml"] = strToU8('<!DOCTYPE a [<!ENTITY xx "value">]><worksheet/>');
    await expect(parseParts(dtd)).rejects.toThrow("INVALID_XML");
    expect(() => resolvePart("xl/drawings/a.xml", "../../../escape.jpg")).toThrow("INVALID_RELATIONSHIP");
  });
  it("enforces actual expanded bytes even on ignored archive members", () => {
    const bytes = zipSync({ "ignored.bin": new Uint8Array(100000) });
    new DataView(bytes.buffer).setUint32(22, 0, true); // forged local declared size cannot bypass actual output accounting
    expect(() => unzipLimited(bytes, 1024)).toThrow();
  });
  it("sanitizes unsafe and reserved names and resolves case-insensitive collisions", async () => {
    expect(safeBase("../CON:*")).not.toContain("/");
    expect(safeBase("CON")).toBe("_CON");
    const result = await extract(
      fixture([], [], true, { "xl/media/a.jpeg": fakeJpeg(1), "xl/media/b.jpeg": fakeJpeg(2) }),
    );
    const plans = planPhotos([result], { "input-1:xl/media/a.jpeg": "Photo", "input-1:xl/media/b.jpeg": "photo" });
    expect(plans.map((p) => p.filename)).toEqual(["Photo.jpg", "photo_2.jpg"]);
    expect(plans[0]?.bytes).toEqual(fakeJpeg(1));
  });
});
