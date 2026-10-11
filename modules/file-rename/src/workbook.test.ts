// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { unpack, hwpText } from "./archive.worker.ts";
import { workbook, workbookTemplate, rowsFor, hwpxText } from "./workbook.ts";
const encode = (text: string) => new TextEncoder().encode(text);
describe("spreadsheet and original document inputs", () => {
  it("accepts OPC package-root sheet targets but rejects URI and root escape variants", async () => {
    const original = unpack(workbookTemplate());
    const text = new TextDecoder().decode(original["xl/_rels/workbook.xml.rels"]);
    for (const target of ["/xl/worksheets/sheet1.xml", "../xl/worksheets/sheet1.xml"]) {
      const parts = {
        ...original,
        "xl/_rels/workbook.xml.rels": encode(text.replace("worksheets/sheet1.xml", target)),
      };
      const result = await workbook(parts, new AbortController().signal);
      expect(rowsFor(required(result.sheets[0]), 1).rows[0]?.values["학번"]).toBe("00101");
    }
    for (const target of [
      "//example.test/sheet.xml",
      "/../xl/worksheets/sheet1.xml",
      "../../xl/worksheets/sheet1.xml",
      "https://example.test/x.xml",
    ]) {
      const parts = {
        ...original,
        "xl/_rels/workbook.xml.rels": encode(text.replace("worksheets/sheet1.xml", target)),
      };
      await expect(workbook(parts, new AbortController().signal)).rejects.toThrow();
    }
  });
  it("round-trips an actual editable XLSX template with textual leading zeroes", async () => {
    const book = await workbook(unpack(workbookTemplate()), new AbortController().signal);
    expect(book.sheets).toHaveLength(1);
    const table = rowsFor(required(book.sheets[0]), 1);
    expect(table.columns).toEqual(["학번", "번호", "기존이름", "이름", "반"]);
    expect(table.rows[0]?.values["학번"]).toBe("00101");
  });
  it("applies explicit zero number formats but never infers student-ID padding", async () => {
    const parts = unpack(workbookTemplate());
    parts["xl/styles.xml"] = encode(
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    );
    const text = new TextDecoder().decode(parts["xl/worksheets/sheet1.xml"]);
    parts["xl/worksheets/sheet1.xml"] = encode(
      text.replace('<c r="A2" t="inlineStr"><is><t>00101</t></is></c>', '<c r="A2" s="1"><v>101</v></c>'),
    );
    const book = await workbook(parts, new AbortController().signal);
    expect(rowsFor(required(book.sheets[0]), 1).rows[0]?.values["학번"]).toBe("00101");
  });
  it("rejects duplicate headers, external relationships and XML entities", async () => {
    const book = await workbook(unpack(workbookTemplate()), new AbortController().signal);
    const sheet = required(book.sheets[0]);
    required(sheet.cells.find((c) => c.row === 1 && c.col === 2)).value = "학번";
    expect(() => rowsFor(sheet, 1)).toThrow("DUPLICATE_HEADER");
    const parts = unpack(workbookTemplate());
    parts["xl/_rels/workbook.xml.rels"] = encode(
      '<Relationships><Relationship Id="rId1" Target="https://invalid.example.test" TargetMode="External"/></Relationships>',
    );
    await expect(workbook(parts, new AbortController().signal)).rejects.toThrow();
    parts["xl/workbook.xml"] = encode('<!DOCTYPE x [<!ENTITY x "bad">]><workbook/>');
    await expect(workbook(parts, new AbortController().signal)).rejects.toThrow();
  });
  it("reads HWPX paragraph text and rejects decompression abuse", async () => {
    const parts = unpack(
      zipSync({
        "Contents/section0.xml": encode(
          '<hs:sec xmlns:hs="urn:section" xmlns:hp="urn:paragraph"><hp:p><hp:run><hp:t>2026학년도 지구과학</hp:t></hp:run></hp:p></hs:sec>',
        ),
      }),
    );
    expect(await hwpxText(parts, new AbortController().signal)).toBe("2026학년도 지구과학\n");
    expect(() => unpack(zipSync({ "xl/workbook.xml": new Uint8Array(5 * 1024 * 1024) }))).toThrow();
  });
  it("reads uncompressed HWP5 body text and refuses protected/cyclic input", () => {
    const bytes = syntheticHwp();
    expect(hwpText(bytes)).toContain("2026학년도 지구과학");
    const protectedBytes = bytes.slice();
    new DataView(protectedBytes.buffer).setUint32(512 * 4 + 36, 2, true);
    expect(() => hwpText(protectedBytes)).toThrow("PROTECTED_HWP");
    const cycle = bytes.slice();
    new DataView(cycle.buffer).setUint32(512 + 4, 1, true);
    expect(() => hwpText(cycle)).toThrow("INVALID_HWP");
  });
});
function syntheticHwp(): Uint8Array {
  const bytes = new Uint8Array(512 * 5);
  const view = new DataView(bytes.buffer);
  bytes.set([208, 207, 17, 224, 161, 177, 26, 225]);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, 1, true);
  view.setUint32(48, 1, true);
  view.setUint32(56, 4096, true);
  view.setUint32(60, 2, true);
  view.setUint32(64, 1, true);
  view.setUint32(68, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i ? 0xffffffff : 0, true);
  for (let i = 0; i < 128; i++) {
    view.setUint32(512 + i * 4, i === 0 ? 0xfffffffd : i < 4 ? 0xfffffffe : 0xffffffff, true);
    view.setUint32(512 * 3 + i * 4, i < 3 ? i + 1 : i === 3 || i === 4 ? 0xfffffffe : 0xffffffff, true);
  }
  const text = "2026학년도 지구과학";
  const sectionSize = 4 + text.length * 2;
  const record = (index: number, name: string, type: number, start: number, size: number) => {
    const at = 512 * 2 + index * 128;
    for (let i = 0; i < name.length; i++) view.setUint16(at + i * 2, name.charCodeAt(i), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true);
    view.setUint8(at + 66, type);
    view.setUint32(at + 116, start, true);
    view.setBigUint64(at + 120, BigInt(size), true);
  };
  record(0, "Root Entry", 5, 3, 512);
  record(1, "FileHeader", 2, 0, 256);
  record(2, "BodyText", 1, 0xfffffffe, 0);
  record(3, "Section0", 2, 4, sectionSize);
  bytes.set(encode("HWP Document File"), 512 * 4);
  const at = 512 * 4 + 256;
  view.setUint32(at, ((text.length * 2) << 20) | 67, true);
  for (let i = 0; i < text.length; i++) view.setUint16(at + 4 + i * 2, text.charCodeAt(i), true);
  return bytes;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("MISSING_FIXTURE");
  return value;
}
