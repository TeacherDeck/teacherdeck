// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Cell {
  row: number;
  col: number;
  text: string;
}
export interface Student extends Cell {
  grade: number;
  classNumber: number;
  number: number;
  name: string;
  sheet: string;
  /** Identity confidence is independent of the photo coordinate match. */
  identityConfirmed?: boolean;
  identityWarning?: string;
  photoKey?: string;
  suggestionKey?: string;
}
export interface Anchor {
  row: number;
  col: number;
  key: string;
}
const metadata = (text: string) =>
  text.includes(":") || text.includes("담임") || /\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}/.test(text);
const strict = [/(\d+)\s*학년\s*(\d+)\s*반\s*(\d+)\s*번\s*(.+)/, /(\d+)\s*[-–]\s*(\d+)\s*[-–]\s*(\d+)\s+(.+)/];
const loose = [/(\d+)\D+(\d+)\D+(\d+)\D+([가-힣A-Za-z][가-힣A-Za-z\s]*)/];
function parse(cell: Cell, patterns: RegExp[], sheet: string): Student | null {
  if (metadata(cell.text)) return null;
  const match = patterns.map((p) => p.exec(cell.text)).find(Boolean);
  if (!match) return null;
  const grade = Number(match[1]),
    classNumber = Number(match[2]),
    number = Number(match[3]);
  const name = (match[4] ?? "").trim().replace(/\s+/g, " ");
  return name && [grade, classNumber, number].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 9999)
    ? { ...cell, grade, classNumber, number, name, sheet, identityConfirmed: patterns === strict }
    : null;
}
/** Port of TimeAlert's strict/contextual/loose passes and (grade,class,number) deduplication. */
export function collectStudents(
  cells: Cell[],
  sheet: string,
): { students: Student[]; missingHeader: number; duplicates: number } {
  if (cells.length > 100000) throw new Error("ROSTER_LIMIT");
  const ordered = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const headers = ordered.flatMap((cell) => {
    const match = /^(?:\d{4}\s*학년도\s*)?(\d+)\s*학년\s*(\d+)\s*반\s*$/.exec(cell.text);
    return match ? [{ ...cell, grade: Number(match[1]), classNumber: Number(match[2]) }] : [];
  });
  if (headers.length > 1000) throw new Error("ROSTER_LIMIT");
  const headerColumns = [...new Set(headers.map((header) => header.col))].sort((a, b) => a - b);
  let missingHeader = 0;
  let candidateCount = 0;
  const contextual = ordered.flatMap((cell) => {
    if (metadata(cell.text)) return [];
    const match = /^(\d+)\s*번\s*([가-힣A-Za-z][가-힣A-Za-z\s·ㆍ.-]*)$/.exec(cell.text);
    if (!match) return [];
    if (++candidateCount > 1000) throw new Error("ROSTER_LIMIT");
    // Headers apply to their column block, even if another block starts on a newer row.
    const column = headerColumns.filter((col) => col <= cell.col).at(-1);
    const scoped = headers.filter((h) => h.col === column && h.row <= cell.row);
    const latestRow = Math.max(...scoped.map((h) => h.row));
    const candidates = scoped.filter((h) => h.row === latestRow);
    const header = candidates[0] ?? (headers.length === 1 ? headers[0] : undefined);
    if (!header) {
      missingHeader++;
      return [];
    }
    if (
      ![header.grade, header.classNumber, Number(match[1])].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 9999)
    )
      return [];
    return [
      {
        ...cell,
        grade: header.grade,
        classNumber: header.classNumber,
        number: Number(match[1]),
        name: (match[2] ?? "").trim().replace(/\s+/g, " "),
        sheet,
        identityConfirmed:
          candidates.length > 0 &&
          candidates.every((h) => h.grade === header.grade && h.classNumber === header.classNumber),
        ...(!candidates.length ||
        candidates.some((h) => h.grade !== header.grade || h.classNumber !== header.classNumber)
          ? { identityWarning: "학년·반 머리글의 적용 범위를 확인해 주세요" }
          : {}),
      },
    ];
  });
  let parsed = [
    ...ordered.flatMap((cell) => {
      const s = parse(cell, strict, sheet);
      return s ? [s] : [];
    }),
    ...contextual,
  ];
  if (!parsed.length)
    parsed = ordered.flatMap((cell) => {
      const s = parse(cell, loose, sheet);
      return s ? [s] : [];
    });
  if (parsed.length > 1000) throw new Error("ROSTER_LIMIT");
  parsed.sort((a, b) => a.row - b.row || a.col - b.col);
  const seen = new Map<string, Student>();
  let duplicates = 0;
  const students = parsed.filter((s) => {
    const key = `${s.grade}-${s.classNumber}-${s.number}`;
    if (seen.has(key)) {
      duplicates++;
      const prior = seen.get(key);
      if (prior && (prior.name !== s.name || prior.identityConfirmed === false || s.identityConfirmed === false)) {
        prior.identityConfirmed = false;
        prior.identityWarning = "중복 학생 정보가 서로 달라 학번·이름을 확인해 주세요";
      }
      return false;
    }
    seen.set(key, s);
    return true;
  });
  return { students, missingHeader, duplicates };
}
/** Only the proven coordinate rule is confirmed. Fallbacks are displayed as suggestions. */
export function matchPhotos(students: Student[], anchors: Anchor[]): Student[] {
  const result = students.map((s) => ({ ...s }));
  const photos = [...anchors].sort((a, b) => a.row - b.row || a.col - b.col);
  const used = new Set<string>();
  for (const photo of photos) {
    const student = result.find((s) => s.row === photo.row + 1 && s.col === photo.col && !s.photoKey);
    if (student && !used.has(photo.key)) {
      student.photoKey = photo.key;
      used.add(photo.key);
    }
  }
  const restStudents = result.filter((s) => !s.photoKey);
  const restPhotos = photos.filter((p) => !used.has(p.key));
  const gaps = restStudents.map((s, i) => s.row - (restPhotos[i]?.row ?? 0));
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
  const deviation = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, gaps.length));
  if (restStudents.length === restPhotos.length && deviation <= 1.5)
    restStudents.forEach((s, i) => {
      const p = restPhotos[i];
      if (p && !used.has(p.key)) {
        s.suggestionKey = p.key;
        used.add(p.key);
      }
    });
  else {
    // Same row-weighted greedy rule; calculate candidates only for bounded school-sized input.
    const pairs = restPhotos
      .flatMap((p, pi) =>
        restStudents.map((s, si) => ({
          p,
          s,
          pi,
          si,
          score: Math.abs(s.row - p.row) * 1000 + Math.abs(s.col - p.col),
        })),
      )
      .sort((a, b) => a.score - b.score || a.pi - b.pi || a.si - b.si);
    for (const { p, s } of pairs)
      if (!used.has(p.key) && !s.suggestionKey) {
        s.suggestionKey = p.key;
        used.add(p.key);
      }
  }
  return result;
}
