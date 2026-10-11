// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { ExcelRow } from "./logic.ts";
import { zipSync } from "fflate";
/** Small editable XLSX template; text cell types preserve leading student-ID zeroes. */
export function workbookTemplate(): Uint8Array {
  const parts: Record<string, Uint8Array> = {};
  const encode = (name: string, text: string) => {
    parts[name] = new TextEncoder().encode(text);
  };
  encode(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  );
  encode(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  );
  encode(
    "xl/workbook.xml",
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="연결 자료" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  encode(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  const data = [
    ["학번", "번호", "기존이름", "이름", "반"],
    ["00101", "1", "00101_자료.pdf", "가상학생가", "1"],
  ];
  encode(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      data
        .map(
          (row, index) =>
            `<row r="${index + 1}">${row.map((value, col) => `<c r="${String.fromCharCode(65 + col)}${index + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`,
        )
        .join("") +
      "</sheetData></worksheet>",
  );
  return zipSync(parts, { level: 6 });
}
export interface Worksheet {
  name: string;
  cells: { row: number; col: number; value: string }[];
}
export interface Workbook {
  sheets: Worksheet[];
}
export type Parts = Record<string, Uint8Array>;
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS("*", name));
function xml(bytes: Uint8Array): Document {
  if (bytes.length > 4 * 1024 * 1024) throw new Error("XML_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new Error("INVALID_XML");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (elements(doc, "parsererror").length) throw new Error("INVALID_XML");
  return doc;
}
function partPath(source: string, target: string): string {
  if (
    !target ||
    target.startsWith("//") ||
    /[\\:%?#]/.test(target) ||
    Array.from(target).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error("INVALID_WORKBOOK");
  const rooted = target.startsWith("/");
  const path = rooted ? [] : source.split("/");
  if (!rooted) path.pop();
  for (const item of (rooted ? target.slice(1) : target).split("/")) {
    if (item === "..") {
      if (!path.length) throw new Error("INVALID_WORKBOOK");
      path.pop();
    } else if (item !== "." && item) path.push(item);
    else if (!item) throw new Error("INVALID_WORKBOOK");
  }
  return path.join("/");
}
export async function workbook(parts: Parts, signal: AbortSignal): Promise<Workbook> {
  const shared = parts["xl/sharedStrings.xml"]
    ? elements(xml(parts["xl/sharedStrings.xml"]), "si").map((si) =>
        elements(si, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];
  const formats = new Map<string, string>();
  let styles: string[] = [];
  if (parts["xl/styles.xml"]) {
    const doc = xml(parts["xl/styles.xml"]);
    for (const format of elements(doc, "numFmt"))
      formats.set(format.getAttribute("numFmtId") ?? "", format.getAttribute("formatCode") ?? "");
    const xfs = elements(doc, "cellXfs")[0];
    if (xfs) styles = elements(xfs, "xf").map((xf) => formats.get(xf.getAttribute("numFmtId") ?? "") ?? "");
  }
  const main = parts["xl/workbook.xml"];
  const relBytes = parts["xl/_rels/workbook.xml.rels"];
  if (!main || !relBytes) throw new Error("INVALID_WORKBOOK");
  const rels = new Map<string, string>();
  for (const rel of elements(xml(relBytes), "Relationship")) {
    if ((rel.getAttribute("TargetMode") ?? "").toLowerCase() === "external") throw new Error("INVALID_WORKBOOK");
    const id = rel.getAttribute("Id") ?? "";
    if (!id || rels.has(id)) throw new Error("INVALID_WORKBOOK");
    rels.set(id, partPath("xl/workbook.xml", rel.getAttribute("Target") ?? ""));
  }
  const sheets: Worksheet[] = [];
  let total = 0;
  for (const sheet of elements(xml(main), "sheet")) {
    if (sheets.length >= 100) throw new Error("WORKBOOK_LIMIT");
    const id = Array.from(sheet.attributes).find((a) => a.localName === "id")?.value ?? "";
    const path = rels.get(id);
    const bytes = path ? parts[path] : undefined;
    if (!bytes) throw new Error("INVALID_WORKBOOK");
    const cells: Worksheet["cells"] = [];
    const seen = new Set<string>();
    for (const cell of elements(xml(bytes), "c")) {
      if (++total > 100000) throw new Error("WORKBOOK_LIMIT");
      if (total % 500 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) throw new Error("CANCELLED");
      }
      const ref = cell.getAttribute("r") ?? "";
      const match = /^([A-Z]{1,3})(\d+)$/.exec(ref);
      if (!match || seen.has(ref)) throw new Error("INVALID_WORKBOOK");
      seen.add(ref);
      const row = Number(match[2]);
      let col = 0;
      for (const c of match[1] ?? "") col = col * 26 + c.charCodeAt(0) - 64;
      if (row > 1048576 || col > 16384) throw new Error("WORKBOOK_LIMIT");
      const raw = elements(cell, "v")[0]?.textContent ?? "";
      let value =
        cell.getAttribute("t") === "s"
          ? (shared[Number(raw)] ?? "")
          : cell.getAttribute("t") === "inlineStr"
            ? elements(cell, "t")
                .map((t) => t.textContent ?? "")
                .join("")
            : raw;
      const format = styles[Number(cell.getAttribute("s") ?? 0)];
      if (format && /^0{1,32}$/.test(format) && /^\d+$/.test(value)) value = value.padStart(format.length, "0");
      if (value.length > 1024) throw new Error("WORKBOOK_LIMIT");
      cells.push({ row, col, value });
    }
    sheets.push({ name: sheet.getAttribute("name") ?? `시트${sheets.length + 1}`, cells });
  }
  if (!sheets.length) throw new Error("INVALID_WORKBOOK");
  return { sheets };
}
export function rowsFor(sheet: Worksheet, header: number): { columns: string[]; rows: ExcelRow[] } {
  const headers = sheet.cells.filter((c) => c.row === header);
  if (!headers.length) throw new Error("NO_HEADER");
  const columns = headers.sort((a, b) => a.col - b.col).map((c) => c.value);
  if (columns.length > 128) throw new Error("HEADER_LIMIT");
  if (columns.some((c) => !c) || new Set(columns).size !== columns.length) throw new Error("DUPLICATE_HEADER");
  const labels = new Map(headers.map((c) => [c.col, c.value]));
  const rows = new Map<number, ExcelRow>();
  for (const cell of sheet.cells) {
    if (cell.row <= header) continue;
    const label = labels.get(cell.col);
    if (!label) continue;
    const row = rows.get(cell.row) ?? { row: cell.row, values: Object.create(null) as Record<string, string> };
    row.values[label] = cell.value;
    rows.set(cell.row, row);
  }
  const result = [...rows.values()].sort((a, b) => a.row - b.row);
  if (result.length > 10000) throw new Error("ROW_LIMIT");
  return { columns, rows: result };
}
export async function hwpxText(parts: Parts, signal: AbortSignal): Promise<string> {
  let text = "";
  const keys = Object.keys(parts)
    .filter((path) => /^Contents\/section\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  for (const path of keys.slice(0, 4)) {
    const bytes = parts[path];
    if (!bytes) continue;
    text +=
      elements(xml(bytes), "p")
        .map((p) =>
          elements(p, "t")
            .map((t) => t.textContent ?? "")
            .join(""),
        )
        .join("\n") + "\n";
    if (text.length > 4000) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal.aborted) throw new Error("CANCELLED");
  }
  if (!text) throw new Error("NO_DOCUMENT_TEXT");
  return text.slice(0, 4000);
}
