// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// OOXML traversal is adapted from modules/photo-extract/src/ooxml.ts; table semantics
// follow TimeAlert StandardTemplates and TimetablePasteParser (read-only source).
import type { SchoolDataDocument, SchoolWorkbookInput } from "@deck/sdk";
import { collectStudents, type Cell } from "./school-roster-ooxml.ts";
import { appendRoster, newId } from "./school-data-model.ts";
export const elements = (parent: Document | Element, name: string) =>
  Array.from(parent.getElementsByTagNameNS("*", name));
export const attr = (element: Element, name: string) =>
  Array.from(element.attributes).find((a) => a.localName === name)?.value ?? "";
export function xml(text: string): Document {
  if (new TextEncoder().encode(text).length > 4 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)/i.test(text))
    throw new Error("엑셀 XML의 형식과 크기를 확인해 주세요.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (elements(doc, "parsererror").length) throw new Error("엑셀 XML을 읽지 못했어요.");
  return doc;
}
function relationshipPath(source: string) {
  const at = source.lastIndexOf("/");
  return `${source.slice(0, at + 1)}_rels/${source.slice(at + 1)}.rels`;
}
function resolvePart(source: string, target: string) {
  if (
    !target ||
    /[\\:%?#]/.test(target) ||
    target.startsWith("//") ||
    Array.from(target).some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error("엑셀 내부 연결을 확인해 주세요.");
  // OPC root-relative targets such as /xl/worksheets/sheet1.xml are ZIP parts,
  // never filesystem paths. TimeAlert's shipped templates use this legal form.
  const rootRelative = target.startsWith("/"),
    path = rootRelative ? [] : source.split("/");
  if (!rootRelative) path.pop();
  for (const part of (rootRelative ? target.slice(1) : target).split("/")) {
    if (part === "..") {
      if (!path.length) throw new Error("엑셀 내부 연결을 확인해 주세요.");
      path.pop();
    } else if (part !== "." && part) path.push(part);
    else if (!part) throw new Error("엑셀 내부 연결을 확인해 주세요.");
  }
  return path.join("/");
}
export function relationships(parts: Record<string, string>, source: string) {
  const map = new Map<string, string>(),
    text = parts[relationshipPath(source)];
  if (!text) return map;
  for (const rel of elements(xml(text), "Relationship")) {
    if ((rel.getAttribute("TargetMode") ?? "").toLowerCase() === "external")
      throw new Error("외부 자료를 연결한 엑셀은 읽지 않아요.");
    const id = rel.getAttribute("Id") ?? "";
    if (!id || map.has(id)) throw new Error("엑셀 내부 연결을 확인해 주세요.");
    map.set(id, resolvePart(source, rel.getAttribute("Target") ?? ""));
  }
  return map;
}
function address(ref: string) {
  const match = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!match) throw new Error("엑셀 셀 위치를 확인해 주세요.");
  let col = 0;
  for (const c of required(match[1])) col = col * 26 + c.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  col--;
  if (row < 0 || row >= 20000 || col < 0 || col >= 512) throw new Error("엑셀은 20,000행·512열 이내로 나누어 주세요.");
  return { row, col };
}
export interface WorkbookSheet {
  partKey: string;
  name: string;
  rows: string[][];
  cells: Cell[];
  warnings: string[];
}
/** First declared worksheet, namespace-neutral shared/inline strings and bounded merge expansion. */
export async function readWorkbook(input: SchoolWorkbookInput): Promise<WorkbookSheet> {
  const parts = input.parts;
  let total = 0;
  for (const [path, text] of Object.entries(parts)) {
    total += new TextEncoder().encode(text).length;
    if (total > 16 * 1024 * 1024) throw new Error("엑셀 XML의 크기를 확인해 주세요.");
    if (path.endsWith(".rels")) relationships(parts, path.replace("/_rels/", "/").replace(/\.rels$/, ""));
  }
  const shared = parts["xl/sharedStrings.xml"]
    ? elements(xml(parts["xl/sharedStrings.xml"]), "si").map((si) =>
        elements(si, "t")
          .map((t) => t.textContent ?? "")
          .join(""),
      )
    : [];
  const declared = parts["xl/workbook.xml"] ? elements(xml(parts["xl/workbook.xml"]), "sheet")[0] : undefined;
  const path = declared
    ? relationships(parts, "xl/workbook.xml").get(attr(declared, "id"))
    : Object.keys(parts)
        .filter((p) => /^xl\/worksheets\/[^/]+\.xml$/.test(p))
        .sort()[0];
  if (!path || !parts[path]) throw new Error("명부·시간표가 들어 있는 맨 앞 시트를 확인해 주세요.");
  const doc = xml(parts[path]),
    cells: Cell[] = [],
    lookup = new Map<string, string>();
  let visited = 0;
  for (const cell of elements(doc, "c")) {
    if (++visited > 100000) throw new Error("엑셀 셀은 100,000개 이내로 나누어 주세요.");
    if (visited % 500 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const ref = cell.getAttribute("r");
    if (!ref) continue;
    const { row, col } = address(ref),
      value = elements(cell, "v")[0]?.textContent ?? "",
      type = cell.getAttribute("t");
    if (type === "s" && (!/^\d+$/.test(value) || shared[Number(value)] === undefined))
      throw new Error("엑셀 공유 문자열을 읽지 못했어요.");
    const text = (
      type === "s"
        ? required(shared[Number(value)])
        : type === "inlineStr"
          ? elements(cell, "t")
              .map((t) => t.textContent ?? "")
              .join("")
          : value
    )
      .replace(/\u00a0/g, " ")
      .trim();
    if (lookup.has(`${row}:${col}`)) throw new Error("같은 셀 위치가 중복된 엑셀은 읽지 않아요.");
    lookup.set(`${row}:${col}`, text);
    if (text) cells.push({ row, col, text });
  }
  const rows: string[][] = [];
  for (const { row, col, text } of cells) {
    rows[row] ??= [];
    required(rows[row])[col] = text;
  }
  // Keep the original sparse cells for photo-roster collection. Empty merge cells are
  // expanded in the tabular view, matching TimeAlert XlsxReader's table contract.
  let merged = 0;
  for (const cell of elements(doc, "mergeCell")) {
    const [first, last] = (cell.getAttribute("ref") ?? "").split(":");
    if (!first || !last) throw new Error("병합 셀 범위를 확인해 주세요.");
    const a = address(first),
      b = address(last);
    if (a.row > b.row || a.col > b.col) throw new Error("병합 셀 범위를 확인해 주세요.");
    const value = lookup.get(`${a.row}:${a.col}`) ?? "";
    for (let r = a.row; r <= b.row; r++)
      for (let c = a.col; c <= b.col; c++) {
        if (++merged > 100000) throw new Error("병합 셀 범위가 너무 커요.");
        rows[r] ??= [];
        if (!required(rows[r])[c]) required(rows[r])[c] = value;
      }
  }
  return {
    partKey: path,
    name: declared?.getAttribute("name") ?? "첫 시트",
    rows: Array.from({ length: rows.length }, (_, i) =>
      Array.from({ length: rows[i]?.length ?? 0 }, (_, j) => rows[i]?.[j] ?? ""),
    ),
    cells,
    warnings: input.photoCount
      ? [
          `파일에 사진 ${input.photoCount}장이 있어요. 이 가져오기는 명부·시간표 값만 읽어요. 사진은 학생별 ‘사진 선택’으로 추가해 주세요.`,
        ]
      : [],
  };
}
const normalize = (s: string) => s.replace(/[\s*＊]/g, "");
const int = (s: string) => Number(required(s.trim().split(".")[0]).replace(/\D/g, ""));
export function rosterFromWorkbook(sheet: WorkbookSheet): {
  text: string;
  warnings: string[];
} {
  for (let h = 0; h < sheet.rows.length; h++) {
    const header = required(sheet.rows[h]).map(normalize),
      name = header.findIndex((v) => ["이름", "성명", "학생이름", "학생명"].includes(v)),
      grade = header.indexOf("학년"),
      classNumber = header.findIndex((v) => ["반", "학급", "반명"].includes(v)),
      number = header.findIndex((v) => ["번호", "출석번호", "학생번호"].includes(v)),
      code = header.findIndex((v) => ["학번", "학생학번"].includes(v));
    if (name < 0 || !((grade >= 0 && classNumber >= 0 && number >= 0) || code >= 0)) continue;
    const rows: string[] = [];
    let skipped = 0;
    for (const row of sheet.rows.slice(h + 1)) {
      const studentName = row[name]?.trim();
      if (!studentName) continue;
      let g: number, c: number, n: number;
      if (grade >= 0 && classNumber >= 0 && number >= 0)
        [g, c, n] = [int(row[grade] ?? ""), int(row[classNumber] ?? ""), int(row[number] ?? "")];
      else {
        const value = (row[code] ?? "").trim().replace(/\D/g, "");
        if (value.length !== 5) {
          skipped++;
          continue;
        }
        [g, c, n] = [Number(value.slice(0, 1)), Number(value.slice(1, 3)), Number(value.slice(3, 5))];
      }
      if (
        !(
          required(g) >= 1 &&
          required(g) <= 9 &&
          required(c) >= 1 &&
          required(c) <= 99 &&
          required(n) >= 1 &&
          required(n) <= 999
        ) ||
        /[\r\n\t,]/.test(studentName)
      ) {
        skipped++;
        continue;
      }
      rows.push(`${required(g)},${required(c)},${required(n)},${studentName}`);
    }
    if (!rows.length) throw new Error("머리글 아래에 읽을 수 있는 학생 명단이 없어요.");
    return {
      text: rows.join("\n"),
      warnings: [
        ...sheet.warnings,
        ...(skipped
          ? [`학번·이름을 읽지 못한 ${skipped}줄은 미리보기에 포함하지 않았어요. 원본과 비교해 주세요.`]
          : []),
      ],
    };
  }
  const result = collectStudents(sheet.cells, sheet.name);
  if (!result.students.length) throw new Error("학년·반·번호·이름 머리글 또는 사진명렬표의 학생 정보를 확인해 주세요.");
  return {
    text: result.students.map((s) => `${s.grade},${s.classNumber},${s.number},${s.name}`).join("\n"),
    warnings: [
      ...sheet.warnings,
      ...(result.duplicates ? [`중복 학생 정보 ${result.duplicates}개는 첫 번째만 표시했어요.`] : []),
      ...(result.missingHeader || result.students.some((s) => !s.identityConfirmed)
        ? ["학년·반 머리글 적용이나 학생 정보 일부를 다시 확인해 주세요."]
        : []),
    ],
  };
}
interface Lesson {
  weekday: number;
  period: number;
  subject: string;
  hint: string;
  division: string;
}
const blank = (s: string) => !s.trim() || ["-", "–", "—", ".", "x", "X", "공강", "없음", "·"].includes(s.trim());
function weekday(s: string) {
  const cleaned = s.replace(/[\s()（）[\]<>{}·.,\-/:*]/g, "").replace(/요일$/, "");
  const kor = ["월", "화", "수", "목", "금", "토", "일"].indexOf(cleaned) + 1;
  return (
    kor ||
    [
      ["MON", "MONDAY"],
      ["TUE", "TUESDAY"],
      ["WED", "WEDNESDAY"],
      ["THU", "THURSDAY"],
      ["FRI", "FRIDAY"],
      ["SAT", "SATURDAY"],
      ["SUN", "SUNDAY"],
    ].findIndex((v) => v.includes(cleaned.toUpperCase())) + 1
  );
}
function period(s: string) {
  const match = /\d{1,2}/.exec(s),
    n = Number(match?.[0]),
    rest = s.replace(/\d{1,2}/g, "").replace(/\s/g, "");
  return n >= 1 && n <= 64 && /^[교시제차()[\].:·]*$/.test(rest) ? n : 0;
}
function lesson(day: number, p: number, raw: string, division = "", room = ""): Lesson | null {
  if (!day || !p || blank(raw)) return null;
  const lines = raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter((v) => !blank(v)),
    first = required(lines[0]);
  const words = first.split(/\s+/),
    split = words.findIndex((v) => /^\d+-\d+$|^\d+학년\d+반$/.test(v));
  return {
    weekday: day,
    period: p,
    subject: split > 0 ? words.slice(0, split).join(" ") : first,
    hint: [split > 0 ? words.slice(split).join(" ") : "", ...lines.slice(1), room].filter(Boolean).join(" "),
    division,
  };
}
export function timetableFromWorkbook(sheet: WorkbookSheet): {
  lessons: Lesson[];
  warnings: string[];
} {
  const grid = sheet.rows.map((r) => r.map((v) => v.replace(/\r/g, "").trim())).filter((r) => r.some((v) => v)),
    warnings = [...sheet.warnings],
    lessons: Lesson[] = [];
  for (let h = 0; h < grid.length; h++) {
    const head = required(grid[h]).map(normalize),
      d = head.findIndex((v) => ["요일", "일", "주간"].includes(v)),
      p = head.findIndex((v) => ["교시", "수업교시"].includes(v)),
      subject = head.findIndex((v) => ["과목", "과목명", "수업", "수업명"].includes(v)),
      division = head.findIndex((v) => ["분반", "반", "학급"].includes(v)),
      room = head.findIndex((v) => ["교실", "장소", "수업장소"].includes(v));
    if (d < 0 || p < 0 || subject < 0) continue;
    for (const row of grid.slice(h + 1)) {
      const value = lesson(
        weekday(row[d] ?? ""),
        period(row[p] ?? ""),
        row[subject] ?? "",
        row[division] ?? "",
        row[room] ?? "",
      );
      if (value) lessons.push(value);
      else if (row.some((v) => !blank(v)))
        warnings.push("요일·교시·과목을 읽지 못한 줄이 있어요. 원본과 비교해 주세요.");
    }
    return dedupe(lessons, warnings);
  }
  const h = grid.findIndex((r) => {
    const filled = r.filter((v) => !blank(v)),
      days = filled.filter((v) => weekday(v));
    return days.length >= 2 || (days.length >= 1 && days.length === filled.length);
  });
  const columnDays = grid.filter((r, i) => i !== h && weekday(r[0] ?? "")).length;
  if (h >= 0 && required(grid[h]).filter((v) => weekday(v)).length >= columnDays) {
    const header = required(grid[h]),
      body = grid.slice(h + 1),
      widest = Math.max(0, ...body.map((r) => r.length)),
      shift = weekday(header[0] ?? "") && widest === header.length + 1 ? 1 : 0,
      columns = header.flatMap((v, c) => (weekday(v) ? [{ col: c + shift, day: weekday(v) }] : []));
    if (columns.some((c) => c.col === 0)) {
      for (const [i, row] of body.entries())
        for (const c of columns) {
          const value = lesson(c.day, i + 1, row[c.col] ?? "");
          if (value) lessons.push(value);
        }
      return dedupe(lessons, warnings);
    }
    let current: {
      p: number;
      rows: string[][];
    } = { p: 0, rows: [] };
    const groups: {
      p: number;
      rows: string[][];
    }[] = [];
    for (const row of body) {
      const p = period(row[0] ?? "");
      if (p) {
        if (current.p === p) current.rows.push(row);
        else {
          current = { p, rows: [row] };
          groups.push(current);
        }
      } else if (blank(row[0] ?? "") && current.p) current.rows.push(row);
      else current = { p: 0, rows: [] };
    }
    for (const group of groups)
      for (const c of columns) {
        const value = lesson(c.day, group.p, [...new Set(group.rows.map((r) => r[c.col] ?? ""))].join("\n"));
        if (value) lessons.push(value);
      }
  } else if (columnDays >= 2) {
    const header = required(grid[0]),
      hasHeader = !weekday(header[0] ?? "") && header.slice(1).filter((v) => period(v)).length >= 2,
      body = hasHeader ? grid.slice(1) : grid;
    for (const row of body)
      for (let c = 1; c < row.length; c++) {
        const value = lesson(weekday(row[0] ?? ""), hasHeader ? period(header[c] ?? "") : c, row[c] ?? "");
        if (value) lessons.push(value);
      }
  } else {
    warnings.push("요일 머리글이 없어 왼쪽부터 월~금으로 읽었어요. 적용 전에 요일을 확인해 주세요.");
    const hasPeriod = grid.length >= 2 && grid.every((r) => period(r[0] ?? ""));
    for (const [i, row] of grid.entries())
      for (let c = hasPeriod ? 1 : 0; c < Math.min(row.length, (hasPeriod ? 1 : 0) + 5); c++) {
        const value = lesson(c + (hasPeriod ? 0 : 1), hasPeriod ? period(row[0] ?? "") : i + 1, row[c] ?? "");
        if (value) lessons.push(value);
      }
  }
  return dedupe(lessons, warnings);
}
function dedupe(lessons: Lesson[], warnings: string[]) {
  const seen = new Set<string>();
  let duplicate = 0;
  const result = lessons.filter((l) => {
    const key = `${l.weekday}-${l.period}`;
    if (seen.has(key)) {
      duplicate++;
      return false;
    }
    seen.add(key);
    return true;
  });
  if (duplicate) warnings.push(`같은 요일·교시 ${duplicate}칸이 겹쳐 먼저 나온 수업만 표시해요.`);
  if (!result.length) throw new Error("시간표의 요일·교시·수업을 읽지 못했어요.");
  return { lessons: result, warnings };
}
export function applyWorkbookTimetable(
  document: SchoolDataDocument,
  semesterId: string,
  label: string,
  lessons: Lesson[],
): SchoolDataDocument {
  const d = structuredClone(document),
    entries = lessons.map((l) => {
      const full = [l.subject, l.division, l.hint].filter(Boolean).join(" "),
        group = /(?:^|\s)(\d+)-(\d+)(?:\s|$)/.exec(l.hint),
        contextLabel = l.division
          ? `${l.subject} ${l.division}`
          : group
            ? `${l.subject} ${group[1]}-${group[2]}`
            : l.subject;
      let c = d.contexts.find(
        (v) =>
          v.semesterId === semesterId &&
          (v.label === full || v.label === contextLabel || (v.label === l.subject && !l.division && !group)),
      );
      if (!c) {
        const enrollmentIds = group
          ? d.enrollments
              .filter(
                (e) =>
                  e.semesterId === semesterId && e.grade === Number(group[1]) && e.classNumber === Number(group[2]),
              )
              .map((e) => e.id)
          : [];
        c = {
          id: newId(),
          semesterId,
          kind: "division",
          label: contextLabel,
          subject: l.subject,
          room: l.hint || null,
          enrollmentIds,
          weeklyTableId: null,
        };
        d.contexts.push(c);
      }
      return { weekday: l.weekday, period: l.period, contextId: c.id };
    });
  d.timetable.weeklyTables.push({
    id: newId(),
    semesterId,
    label: label.trim() || "가져온 시간표",
    startDate: null,
    endDate: null,
    entries,
  });
  return d;
}
export function rosterRows(document: SchoolDataDocument, semesterId: string): string[][] {
  const masters = new Map(document.students.map((s) => [s.id, s]));
  return [
    ["학년", "반", "번호", "이름"],
    ...document.enrollments
      .filter((e) => e.semesterId === semesterId)
      .sort((a, b) => a.grade - b.grade || a.classNumber - b.classNumber || a.studentNumber - b.studentNumber)
      .map((e) => [
        String(e.grade),
        String(e.classNumber),
        String(e.studentNumber),
        required(masters.get(e.studentId)).name,
      ]),
  ];
}
export function timetableRows(document: SchoolDataDocument, tableId: string): string[][] {
  const table = document.timetable.weeklyTables.find((t) => t.id === tableId);
  if (!table) throw new Error("내보낼 시간표를 선택해 주세요.");
  const days = Math.max(5, ...table.entries.map((e) => e.weekday)),
    periods = Math.max(7, ...table.entries.map((e) => e.period));
  return [
    ["", ...["월", "화", "수", "목", "금", "토", "일"].slice(0, days)],
    ...Array.from({ length: periods }, (_, i) => [
      String(i + 1),
      ...Array.from({ length: days }, (_, j) => {
        const entry = table.entries.find((e) => e.weekday === j + 1 && e.period === i + 1);
        return entry ? (document.contexts.find((c) => c.id === entry.contextId)?.label ?? "") : "";
      }),
    ]),
  ];
}
export function applyWorkbookRoster(document: SchoolDataDocument, semesterId: string, text: string) {
  return appendRoster(document, semesterId, text);
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("자료에 필요한 항목을 찾지 못했어요.");
  return value;
}
