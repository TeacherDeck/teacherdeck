// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { zipSync, strToU8 } from "fflate";
export const fakeJpeg = (id: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, id, 0xff, 0xd9]);
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export function letters(col: number): string {
  let text = "";
  for (let n = col + 1; n; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + ((n - 1) % 26)) + text;
  return text;
}
export interface FixtureCell {
  row: number;
  col: number;
  text: string;
}
export function fixture(
  cells: FixtureCell[],
  anchors: { row: number; col: number }[],
  shared = true,
  extras: Record<string, Uint8Array> = {},
): Uint8Array<ArrayBuffer> {
  const strings = cells.map((cell) => `<si><r><t>${escape(cell.text)}</t></r></si>`).join("");
  const sheet = `<worksheet xmlns="urn:sheet"><sheetData>${cells.map((cell, i) => `<row r="${cell.row + 1}"><c r="${letters(Math.max(0, cell.col - 1))}${cell.row + 1}" s="11"/><c r="${letters(cell.col)}${cell.row + 1}" t="${shared ? "s" : "inlineStr"}">${shared ? `<v>${i}</v>` : `<is><t>${escape(cell.text)}</t></is>`}</c></row>`).join("")}</sheetData></worksheet>`;
  const drawing = `<d:wsDr xmlns:d="urn:drawing" xmlns:a="urn:image" xmlns:r="urn:relations">${anchors.map((anchor, i) => `<d:twoCellAnchor><d:from><d:col>${anchor.col}</d:col><d:row>${anchor.row}</d:row></d:from><a:blip r:embed="picture${i}"/></d:twoCellAnchor>`).join("")}</d:wsDr>`;
  const rels = `<Relationships xmlns="urn:rels">${anchors.map((_, i) => `<Relationship Id="picture${i}" Target="../media/image${i}.jpeg"/>`).join("")}</Relationships>`;
  return zipSync({
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    "xl/sharedStrings.xml": strToU8(`<sst xmlns="urn:sheet">${strings}</sst>`),
    "xl/drawings/drawing1.xml": strToU8(drawing),
    "xl/drawings/_rels/drawing1.xml.rels": strToU8(rels),
    ...Object.fromEntries(anchors.map((_, i) => [`xl/media/image${i}.jpeg`, fakeJpeg(i)])),
    ...extras,
  });
}
