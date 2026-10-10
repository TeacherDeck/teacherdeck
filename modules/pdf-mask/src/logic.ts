// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TextBox extends Rect {
  text: string;
}
export interface PageInfo {
  width: number;
  height: number;
  boxes: TextBox[];
  number: number;
}
export const TYPES = ["전화번호", "주민번호", "계좌번호", "생년월일", "주소", "학번", "이름", "검색어"] as const;
export type Kind = (typeof TYPES)[number];
export interface Candidate {
  id: string;
  page: number;
  kind: Kind;
  label: string;
  rect: Rect;
  selected: boolean;
  manual: boolean;
}
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_PAGES = 100;
export const MAX_PIXELS = 24_000_000;
export const MAX_OUTPUT = 128 * 1024 * 1024;
export const MAX_CANDIDATES = 4000;
export function boundRect(rect: Rect, width: number, height: number): Rect {
  if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error("INVALID_RECT");
  const x = Math.max(0, Math.min(width - 1, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.floor(rect.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(rect.width))),
    height: Math.max(1, Math.min(height - y, Math.ceil(rect.height))),
  };
}
export function union(boxes: readonly Rect[]): Rect {
  if (!boxes.length) throw new Error("EMPTY_BOXES");
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
// Cover full involved text objects; proportional character width estimates can leave sensitive pixels.
export function detect(pages: readonly PageInfo[], terms: readonly string[], enabled: readonly Kind[]): Candidate[] {
  if (terms.length > 256 || terms.some((term) => term.length > 200)) throw new Error("TOO_MANY_TERMS");
  const out: Candidate[] = [];
  for (const page of pages) {
    const spans: { start: number; end: number; box: TextBox }[] = [];
    let text = "";
    for (const box of page.boxes) {
      const start = text.length;
      text += box.text;
      spans.push({ start, end: text.length, box });
      text += "\n";
    }
    const add = (start: number, end: number, kind: Kind, label: string) => {
      const found = spans.filter((s) => s.end > start && s.start < end).map((s) => s.box);
      if (!found.length) return;
      const rect = boundRect(union(found), page.width, page.height);
      if (
        out.some(
          (c) =>
            c.page === page.number &&
            c.kind === kind &&
            c.rect.x === rect.x &&
            c.rect.y === rect.y &&
            c.rect.width === rect.width &&
            c.rect.height === rect.height,
        )
      )
        return;
      if (out.length >= MAX_CANDIDATES) throw new Error("TOO_MANY_CANDIDATES");
      out.push({ id: `candidate-${out.length}`, page: page.number, kind, label, rect, selected: true, manual: false });
    };
    const patterns: { kind: Kind; regex: RegExp; group?: number }[] = [
      { kind: "전화번호", regex: /(?<!\d)(?:01[016789]|02|0[3-6][1-5])[-.\s]*\d{3,4}[-.\s]*\d{4}(?!\d)/g },
      { kind: "주민번호", regex: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[-\s]*[1-8]\d{6}(?!\d)/g },
      { kind: "계좌번호", regex: /(?:계좌(?:번호)?|입금계좌)\s*[:：]?\s*([\d][\d\s-]{7,30}\d)/g, group: 1 },
      {
        kind: "생년월일",
        regex:
          /(?:생년월일|생일|출생일)\s*[:：]?\s*((?:19|20)?\d{2}[년.\-/\s]+(?:0?[1-9]|1[0-2])[월.\-/\s]+(?:0?[1-9]|[12]\d|3[01])일?)/g,
        group: 1,
      },
      { kind: "주소", regex: /(?:주소|거주지)\s*[:：]?\s*([^\n]{2,160})/g, group: 1 },
      { kind: "학번", regex: /(?:학번|학생번호|출석번호)\s*[:：]?\s*(\d{1,12})(?!\d)/g, group: 1 },
      { kind: "이름", regex: /(?:성명|이름|학생명|보호자명)\s*[:：]?\s*([가-힣]{2,6})(?![가-힣])/g, group: 1 },
    ];
    for (const pattern of patterns)
      if (enabled.includes(pattern.kind))
        for (const match of text.matchAll(pattern.regex)) {
          const value = pattern.group ? match[pattern.group] : match[0];
          if (!value) continue;
          const start = match.index + match[0].indexOf(value);
          add(start, start + value.length, pattern.kind, value);
        }
    if (enabled.includes("검색어"))
      for (const term of terms) {
        let start = 0;
        while (term && (start = text.indexOf(term, start)) >= 0) {
          add(start, start + term.length, "검색어", term);
          start += term.length;
        }
        const compact = text.replace(/\s/g, "");
        const needle = term.replace(/\s/g, "");
        const indices: number[] = [];
        for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i] ?? "")) indices.push(i);
        start = 0;
        while (needle && (start = compact.indexOf(needle, start)) >= 0) {
          const a = indices[start];
          const b = indices[start + needle.length - 1];
          if (a !== undefined && b !== undefined) add(a, b + 1, "검색어", term);
          start += needle.length;
        }
      }
  }
  return out;
}
export function readTerms(text: string, csv: boolean, skipHeader: boolean): string[] {
  if (text.length > 128 * 1024) throw new Error("LIST_TOO_LARGE");
  const rows: string[] = [];
  if (!csv) rows.push(...text.replace(/^\uFEFF/, "").split(/\r?\n/));
  else {
    let first = "",
      column = 0,
      quoted = false;
    for (let i = 0; i <= text.length; i++) {
      const char = text[i] ?? "\n";
      if (char === '"') {
        if (quoted && text[i + 1] === '"') {
          if (column === 0) first += '"';
          i++;
        } else quoted = !quoted;
      } else if (!quoted && char === ",") column++;
      else if (!quoted && (char === "\n" || char === "\r")) {
        if (char === "\r" && text[i + 1] === "\n") i++;
        rows.push(first);
        first = "";
        column = 0;
      } else if (column === 0) first += char;
    }
    if (quoted) throw new Error("INVALID_CSV");
  }
  const cleaned = rows.map((row) => row.replace(/^\uFEFF/, "").trim());
  if (skipHeader) cleaned.shift();
  const result = [...new Set(cleaned.filter(Boolean))];
  if (result.length > 256 || result.some((term) => term.length > 200)) throw new Error("TOO_MANY_TERMS");
  return result;
}
export function outputName(name: string): string {
  return `${name.replace(/\.pdf$/i, "")}_secure.pdf`;
}
