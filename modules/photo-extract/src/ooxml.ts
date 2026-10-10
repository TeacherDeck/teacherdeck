// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Parts } from "./archive.ts";
import { inspectPhoto } from "./photo.ts";
import { collectStudents, type Anchor, type Cell, type Student } from "./roster.ts";
export interface Photo {
  key: string;
  bytes: Uint8Array<ArrayBuffer>;
  extension: string;
  mime: string;
  preview?: boolean;
}
export interface Sheet {
  name: string;
  students: Student[];
  anchors: Anchor[];
  cells: Cell[];
}
export interface Parsed {
  sheets: Sheet[];
  photos: Photo[];
  warnings: string[];
}
const elements = (parent: Document | Element, name: string): Element[] =>
  Array.from(parent.getElementsByTagNameNS("*", name));
const attr = (element: Element, name: string) =>
  Array.from(element.attributes).find((a) => a.localName === name)?.value ?? "";
export function relationshipPath(source: string): string {
  const slash = source.lastIndexOf("/");
  return `${source.slice(0, slash + 1)}_rels/${source.slice(slash + 1)}.rels`;
}
export function resolvePart(source: string, target: string): string {
  if (
    !target ||
    /[\\:%?#]/.test(target) ||
    Array.from(target).some((char) => char.charCodeAt(0) < 32) ||
    target.startsWith("/")
  )
    throw new Error("INVALID_RELATIONSHIP");
  const path = source.split("/");
  path.pop();
  for (const part of target.split("/")) {
    if (part === "..") {
      if (!path.length) throw new Error("INVALID_RELATIONSHIP");
      path.pop();
    } else if (part !== "." && part) path.push(part);
    else if (!part) throw new Error("INVALID_RELATIONSHIP");
  }
  return path.join("/");
}
function xml(bytes: Uint8Array): Document {
  if (bytes.length > 4 * 1024 * 1024) throw new Error("XML_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) throw new Error("INVALID_XML");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (elements(doc, "parsererror").length) throw new Error("INVALID_XML");
  return doc;
}
function readRelationships(parts: Parts, source: string): Map<string, string> {
  const bytes = parts[relationshipPath(source)];
  const map = new Map<string, string>();
  if (!bytes) return map;
  for (const rel of elements(xml(bytes), "Relationship")) {
    if ((rel.getAttribute("TargetMode") ?? "").toLowerCase() === "external") throw new Error("INVALID_RELATIONSHIP");
    const id = rel.getAttribute("Id") ?? "";
    if (!id || map.has(id)) throw new Error("INVALID_RELATIONSHIP");
    map.set(id, resolvePart(source, rel.getAttribute("Target") ?? ""));
  }
  return map;
}
export const imageType = inspectPhoto;
/** Namespace-neutral OOXML traversal; small XML parts remain on the main thread with yields. */
export async function parseParts(parts: Parts, signal?: AbortSignal, deferCollection = false): Promise<Parsed> {
  const warnings: string[] = [];
  let xmlBytes = 0;
  for (const [path, bytes] of Object.entries(parts))
    if (/\.(xml|rels)$/.test(path)) {
      xmlBytes += bytes.length;
      if (xmlBytes > 16 * 1024 * 1024) throw new Error("XML_LIMIT");
      if (path.endsWith(".rels")) {
        const source = path.replace("/_rels/", "/").replace(/\.rels$/, "");
        readRelationships(parts, source);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw new Error("CANCELLED");
    }
  const shared = parts["xl/sharedStrings.xml"]
    ? elements(xml(parts["xl/sharedStrings.xml"]), "si").map((si) =>
        elements(si, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];
  let sources: { name: string; path: string }[];
  const workbook = parts["xl/workbook.xml"];
  if (workbook) {
    const rels = readRelationships(parts, "xl/workbook.xml");
    sources = elements(xml(workbook), "sheet").map((sheet) => ({
      name: sheet.getAttribute("name") ?? "시트",
      path: rels.get(attr(sheet, "id")) ?? "",
    }));
  } else
    sources = Object.keys(parts)
      .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
      .sort()
      .map((path, i) => ({ name: `시트 ${i + 1}`, path }));
  if (!sources.length || sources.length > 100 || sources.some((s) => !s.path || !parts[s.path]))
    throw new Error("INVALID_WORKBOOK");
  const sheets: Sheet[] = [];
  for (const [index, source] of sources.entries()) {
    if (signal?.aborted) throw new Error("CANCELLED");
    const bytes = parts[source.path];
    if (!bytes) throw new Error("INVALID_WORKBOOK");
    const doc = xml(bytes);
    const cells: Cell[] = [];
    let visited = 0;
    for (const cell of elements(doc, "c")) {
      if (++visited % 500 === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (signal?.aborted) throw new Error("CANCELLED");
      }
      const ref = /^([A-Z]{1,3})(\d+)$/.exec(cell.getAttribute("r") ?? "");
      if (!ref) continue;
      const row = Number(ref[2]) - 1;
      let col = 0;
      for (const char of ref[1] ?? "") col = col * 26 + char.charCodeAt(0) - 64;
      col--;
      if (row < 0 || row > 1048575 || col > 16383) throw new Error("INVALID_WORKBOOK");
      const value = elements(cell, "v")[0]?.textContent ?? "";
      const text = (
        cell.getAttribute("t") === "s"
          ? (shared[Number(value)] ?? "")
          : cell.getAttribute("t") === "inlineStr"
            ? elements(cell, "t")
                .map((t) => t.textContent ?? "")
                .join("")
            : value
      )
        .replace(/\u00a0/g, " ")
        .trim();
      if (text) cells.push({ row, col, text });
      if (cells.length > 100000) throw new Error("XML_LIMIT");
    }
    const collected = deferCollection
      ? { students: [], duplicates: 0, missingHeader: 0 }
      : collectStudents(cells, source.name);
    if (collected.students.length > 1000) throw new Error("ROSTER_LIMIT");
    if (collected.duplicates) warnings.push(`${collected.duplicates}개 중복 학생 셀은 첫 번째 기록을 유지해요.`);
    if (collected.missingHeader)
      warnings.push(`${collected.missingHeader}개 번호·이름 셀에서 학년·반 머리글을 찾지 못했어요.`);
    const rels = readRelationships(parts, source.path);
    let drawings = elements(doc, "drawing")
      .map((d) => rels.get(attr(d, "id")) ?? "")
      .filter(Boolean);
    // Original TimeAlert regression fixtures omit sheet drawing relationships.
    if (!drawings.length && !index && parts["xl/drawings/drawing1.xml"]) drawings = ["xl/drawings/drawing1.xml"];
    const anchors: Anchor[] = [];
    for (const path of drawings) {
      const drawing = parts[path];
      if (!drawing) {
        warnings.push("사진 위치 정보 일부를 찾지 못했어요. 사진 원본은 별도로 유지해요.");
        continue;
      }
      const drawingRels = readRelationships(parts, path);
      const drawingDoc = xml(drawing);
      for (const block of [...elements(drawingDoc, "twoCellAnchor"), ...elements(drawingDoc, "oneCellAnchor")]) {
        const from = elements(block, "from")[0];
        const blip = elements(block, "blip")[0];
        if (!from || !blip) continue;
        const row = Number(elements(from, "row")[0]?.textContent),
          col = Number(elements(from, "col")[0]?.textContent);
        const key = drawingRels.get(attr(blip, "embed"));
        if (
          key &&
          Number.isInteger(row) &&
          row >= 0 &&
          row <= 1048575 &&
          Number.isInteger(col) &&
          col >= 0 &&
          col <= 16383 &&
          parts[key]
        )
          anchors.push({ row, col, key });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (anchors.length > 1000) throw new Error("ROSTER_LIMIT");
    sheets.push({ name: source.name, students: collected.students, anchors, cells });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const photos = Object.entries(parts)
    .filter(([key, bytes]) => key.startsWith("xl/media/") && !key.endsWith("/") && bytes.length)
    .map(([key, bytes]) => ({ key, bytes, ...imageType(bytes) }));
  if (photos.length > 1000) throw new Error("ROSTER_LIMIT");
  return { sheets, photos, warnings };
}
