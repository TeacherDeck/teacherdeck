// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { FileHandleInfo } from "@deck/sdk";
import { documentCategory, documentDate } from "./document-info.ts";
export type Mode = "pattern" | "excel" | "document";
export type MatchMode = "student" | "number" | "oldname" | "order";
export interface Metadata {
  year: string;
  month: string;
  subject: string;
  main: string;
  sub: string;
  grade: string;
  source: string;
  header: string;
}
export interface Entry {
  file: FileHandleInfo;
  edited?: string;
  metadata?: Metadata;
  manualRow?: number;
}
export interface ExcelRow {
  row: number;
  values: Record<string, string>;
}
export interface MatchOptions {
  mode: MatchMode;
  column: string;
  delimiter: string;
  part: number;
  normalizeNumber: boolean;
}
export interface Naming {
  pattern: string;
  start: number;
  digits: number;
  date: string;
}
export interface Preview {
  entry: Entry;
  name: string;
  errors: string[];
  linked?: ExcelRow;
  reason: string;
  materials: Record<string, string>;
}
export const DEFAULT_NAMING: Naming = { pattern: "{연번}_{원본}", start: 1, digits: 3, date: "" };
export const DEFAULT_MATCH: MatchOptions = {
  mode: "student",
  column: "학번",
  delimiter: "_",
  part: 0,
  normalizeNumber: false,
};
export function stem(name: string): string {
  const point = name.lastIndexOf(".");
  return point > 0 ? name.slice(0, point) : name;
}
export function extension(name: string): string {
  return name.slice(stem(name).length);
}
export function nameError(name: string): string | undefined {
  const device = name.split(".")[0]?.toUpperCase() ?? "";
  if (!name || name.length > 240) return "이름은1~240자여야 해요.";
  if (
    /[<>:"/\\|?*]/.test(name) ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159))
  )
    return "금지 문자나 경로 구분자를 바꿔 주세요.";
  if (/[ .]$/.test(name)) return "끝 공백이나 점을 지워 주세요.";
  if (/^(CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/.test(device))
    return "Windows 예약 이름을 바꿔 주세요.";
  return undefined;
}
function key(value: string, options: MatchOptions): string {
  // Student IDs and old names remain exact: no case, trim or zero removal.
  return options.mode === "number" && options.normalizeNumber && /^\d+$/.test(value)
    ? value.replace(/^0+(?=\d)/, "")
    : value;
}
export function fileKey(file: FileHandleInfo, options: MatchOptions): string {
  const value = options.mode === "oldname" ? file.name : stem(file.name);
  return key(options.delimiter ? (value.split(options.delimiter)[options.part] ?? "") : value, options);
}
export function matchRows(
  entries: Entry[],
  rows: ExcelRow[],
  options: MatchOptions,
): { linked: Map<string, ExcelRow>; reasons: Map<string, string>; unused: ExcelRow[] } {
  const linked = new Map<string, ExcelRow>();
  const reasons = new Map<string, string>();
  const uses = new Map<number, string[]>();
  const rowKeys = new Map<string, ExcelRow[]>();
  const fileKeys = new Map<string, Entry[]>();
  for (const row of rows) {
    const value = key(row.values[options.column] ?? "", options);
    if (value) rowKeys.set(value, [...(rowKeys.get(value) ?? []), row]);
  }
  for (const entry of entries) {
    const value = fileKey(entry.file, options);
    if (value) fileKeys.set(value, [...(fileKeys.get(value) ?? []), entry]);
  }
  for (const [index, entry] of entries.entries()) {
    let row: ExcelRow | undefined;
    let reason: string;
    if (entry.manualRow !== undefined) {
      row = rows.find((r) => r.row === entry.manualRow);
      reason = row ? `직접 연결 · ${row.row}행` : "지정한 행을 찾지 못했어요.";
    } else if (options.mode === "order") {
      row = rows[index];
      reason = row ? `현재 목록 순서 · ${row.row}행` : "연결할 엑셀 행이 없어요.";
    } else {
      const value = fileKey(entry.file, options);
      const candidates = rowKeys.get(value) ?? [];
      if (!value) reason = "파일 연결 키가 비어 있어요.";
      else if ((fileKeys.get(value)?.length ?? 0) > 1) reason = "여러 파일의 연결 키가 같아요.";
      else if (candidates.length !== 1)
        reason = candidates.length ? "엑셀 연결 키가 중복돼요." : "정확히 같은 엑셀 키가 없어요.";
      else {
        row = candidates[0];
        reason = `정확 일치 · ${row?.row ?? 0}행`;
      }
    }
    if (row) {
      linked.set(entry.file.handle, row);
      uses.set(row.row, [...(uses.get(row.row) ?? []), entry.file.handle]);
    }
    reasons.set(entry.file.handle, reason);
  }
  for (const handles of uses.values())
    if (handles.length > 1)
      for (const handle of handles) {
        linked.delete(handle);
        reasons.set(handle, "여러 파일이 같은 엑셀 행에 연결돼요. 직접 다른 행을 골라 주세요.");
      }
  const used = new Set([...linked.values()].map((row) => row.row));
  return { linked, reasons, unused: rows.filter((row) => !used.has(row.row)) };
}
function dateValue(token: string, date: string): string | undefined {
  if (!/^(?:yyyy|yy|mm|dd|[ ._\-월일년])+$/i.test(token) || !/y|m|d/i.test(token)) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const checked = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(checked.getTime()) || checked.toISOString().slice(0, 10) !== date) return undefined;
  return token.replace(/yyyy|yy|mm|dd/gi, (t) =>
    t.toLowerCase() === "yyyy"
      ? (match[1] ?? "")
      : t.toLowerCase() === "yy"
        ? (match[1] ?? "").slice(-2)
        : t.toLowerCase() === "mm"
          ? (match[2] ?? "")
          : (match[3] ?? ""),
  );
}
export function preview(
  entries: Entry[],
  naming: Naming,
  mode: Mode,
  rows: ExcelRow[],
  match: MatchOptions,
  sharedOutputFolder = true,
): Preview[] {
  const mapping = matchRows(entries, rows, match);
  const result = entries.map((entry, index): Preview => {
    const linked = mapping.linked.get(entry.file.handle);
    const meta = entry.metadata;
    const materials: Record<string, string> = {
      ...(mode === "document"
        ? {
            연도: meta?.year ?? "",
            월: meta?.month ?? "",
            분류: meta?.subject ?? "",
            상위분류: meta?.main ?? "",
            하위분류: meta?.sub ?? "",
            학년: meta?.grade ?? "",
          }
        : {}),
      ...linked?.values,
      원본: stem(entry.file.name),
      연번: String(naming.start + index).padStart(naming.digits, "0"),
    };
    const aliases: Record<string, string> = {
      Original: "원본",
      Seq: "연번",
      Year: "연도",
      Month: "월",
      Subject: "분류",
      SubjectMain: "상위분류",
      SubjectSub: "하위분류",
      Grade: "학년",
    };
    const errors: string[] = [];
    let name = entry.edited;
    if (name === undefined) {
      const base = naming.pattern.replace(/\{([^{}]+)\}/g, (_all, token: string) => {
        const material = Object.hasOwn(materials, token)
          ? token
          : Object.hasOwn(aliases, token)
            ? (aliases[token] ?? token)
            : token;
        const value = Object.hasOwn(materials, material) ? materials[material] : dateValue(token, naming.date);
        if (value === undefined || value === "") {
          errors.push(`{${token}} 값을 채워 주세요.`);
          return `{${token}}`;
        }
        return value;
      });
      if (/[{}]/.test(base)) errors.push("이름 재료를 완전히 연결해 주세요.");
      name = base + extension(entry.file.name);
    }
    const invalid = nameError(name);
    if (invalid) errors.push(invalid);
    if (mode === "excel" && !linked && entry.edited === undefined)
      errors.push("엑셀 행을 정확히 연결하거나 이름을 직접 입력해 주세요.");
    return {
      entry,
      name,
      errors,
      reason:
        mode === "excel"
          ? (mapping.reasons.get(entry.file.handle) ?? "미연결")
          : mode === "document"
            ? (meta?.source ?? "문서를 분석하거나 값을 직접 입력해 주세요.")
            : "직접 패턴",
      materials,
      ...(linked ? { linked } : {}),
    };
  });
  const occupied = new Map<string, Preview[]>();
  for (const row of result) {
    const lower = row.name.toUpperCase();
    occupied.set(lower, [...(occupied.get(lower) ?? []), row]);
  }
  // Copy results share one new directory, so cross-parent duplicates are also blocked.
  for (const collision of occupied.values())
    if (sharedOutputFolder && collision.length > 1)
      for (const row of collision) row.errors.push("대소문자만 다른 이름을 포함해 결과 이름이 겹쳐요.");
  return result;
}
export function metadataFrom(text: string, filename: string, keywords: string[]): Metadata {
  const header = text.split(/\r?\n/).slice(0, 40).join("\n").slice(0, 1500);
  const content = header || stem(filename);
  const { year, month, inferred } = documentDate(content);
  const { subject, main, sub } = documentCategory(content, keywords);
  const gradeMatch = /(고(?:등학교|등)?|중(?:학교|등)?|초등학교)\s*([1-6])(?:\s*학년|(?!\d))/.exec(content);
  const grade = gradeMatch ? `${gradeMatch[1]?.slice(0, 1)}${gradeMatch[2]}` : "";
  return {
    year,
    month,
    subject,
    main,
    sub,
    grade,
    header,
    source:
      (header ? "문서 상단 추출 · 값을 확인해 주세요" : "파일명 추출 · 문서 본문 미확인") +
      (inferred ? " · 월은 학기·분기에서 추정" : ""),
  };
}
