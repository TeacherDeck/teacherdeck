// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// NEIS reference: threshold 80, two 3x3 closings, page-area/aspect filtering, grid ordering.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Word extends Rect {
  text: string;
}
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export const DEFAULT_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
const area = (box: Rect) => box.width * box.height;
const gray = (pixels: Uint8ClampedArray, offset: number) =>
  ((pixels[offset] ?? 255) * 299 + (pixels[offset + 1] ?? 255) * 587 + (pixels[offset + 2] ?? 255) * 114) / 1000;

function morphology(input: Uint8Array, width: number, height: number, dilate: boolean): Uint8Array {
  // Separable sliding windows, O(page pixels), no image-sized JS object arrays.
  const horizontal = new Uint8Array(input.length);
  const result = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -2; x < width + 2; x++) {
      if (x + 2 < width && x + 2 >= 0) sum += input[y * width + x + 2] ?? 0;
      if (x - 3 >= 0) sum -= input[y * width + x - 3] ?? 0;
      if (x >= 0 && x < width)
        horizontal[y * width + x] = Number(
          dilate ? sum > 0 : sum === Math.min(width - 1, x + 2) - Math.max(0, x - 2) + 1,
        );
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -2; y < height + 2; y++) {
      if (y + 2 < height && y + 2 >= 0) sum += horizontal[(y + 2) * width + x] ?? 0;
      if (y - 3 >= 0) sum -= horizontal[(y - 3) * width + x] ?? 0;
      if (y >= 0 && y < height)
        result[y * width + x] = Number(dilate ? sum > 0 : sum === Math.min(height - 1, y + 2) - Math.max(0, y - 2) + 1);
    }
  }
  return result;
}
export function detectBoxes(pixels: Uint8ClampedArray, width: number, height: number): Rect[] {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 24_000_000 ||
    pixels.length !== width * height * 4
  )
    throw new Error("PAGE_LIMIT");
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(gray(pixels, i * 4) < 80);
  const closed = morphology(morphology(mask, width, height, true), width, height, false);
  const queue = new Int32Array(width * height);
  const boxes: Rect[] = [];
  for (let seed = 0; seed < closed.length; seed++) {
    if (!closed[seed]) continue;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    closed[seed] = 0;
    let left = width,
      top = height,
      right = 0,
      bottom = 0;
    while (head < tail) {
      const index = queue[head++] ?? 0,
        x = index % width,
        y = Math.floor(index / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            next = yy * width + xx;
          if (xx >= 0 && xx < width && yy >= 0 && yy < height && closed[next]) {
            closed[next] = 0;
            queue[tail++] = next;
          }
        }
    }
    const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    const ratio = area(box) / (width * height),
      aspect = box.height / box.width;
    if (ratio >= 0.002 && ratio <= 0.15 && aspect >= 0.5 && aspect <= 2.5) boxes.push(box);
    if (boxes.length > 2000) throw new Error("PHOTO_LIMIT");
  }
  const kept: Rect[] = [];
  for (const box of boxes.sort((a, b) => area(b) - area(a))) {
    if (
      kept.some((other) => {
        const overlap =
          Math.max(0, Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x)) *
          Math.max(0, Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y));
        return overlap / (area(box) + area(other) - overlap) > 0.3;
      })
    )
      continue;
    kept.push(box);
  }
  const rows: Rect[][] = [];
  for (const box of kept.sort((a, b) => a.y - b.y)) {
    const row = rows.at(-1),
      first = row?.[0];
    if (row && first && Math.abs(box.y - first.y) < first.height * 0.5) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
export function wordsIn(box: Rect, words: Word[], margin = 5): Word[] {
  return words.filter((w) => {
    const x = w.x + w.width / 2,
      y = w.y + w.height / 2;
    return (
      x >= box.x - margin && x <= box.x + box.width + margin && y >= box.y - margin && y <= box.y + box.height + margin
    );
  });
}
export function wordLines(words: Word[]): string[] {
  const rows: Word[][] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.at(-1),
      first = row?.[0];
    if (row && first && Math.abs(word.y - first.y) < 15) row.push(word);
    else rows.push([word]);
  }
  return rows.map((row) =>
    row
      .sort((a, b) => a.x - b.x)
      .map((w) => w.text)
      .join(" "),
  );
}
export function studentIdentity(text: string, header: string) {
  const numbers = (source: string, suffix: string) =>
    [...source.matchAll(new RegExp(`(\\d+)\\s*${suffix}${suffix === "학년" ? "(?!도)" : ""}`, "g"))].map((m) =>
      Number(m[1]),
    );
  const one = (values: number[]) =>
    values.length && new Set(values).size === 1 && (values[0] ?? 0) > 0 && (values[0] ?? 0) <= 9999
      ? values[0]
      : undefined;
  const grades = numbers(text, "학년"),
    classes = numbers(text, "반");
  const grade = one(grades.length ? grades : numbers(header, "학년"));
  const classNumber = one(classes.length ? classes : numbers(header, "반"));
  const number = one(numbers(text, "번"));
  const name = text
    .replace(/\d+\s*(?:학년|반|번)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:성명|이름)(?:\s*[:：]\s*|\s+)/, "");
  if (/(?:^|\s)(?:성명|이름|번호|학번|담임|교사)(?:\s|[:：]|$)/.test(name)) return null;
  if (!grade || !classNumber || !number || !/^[가-힣A-Za-z○·ㆍ.-][가-힣A-Za-z○·ㆍ. -]{0,59}$/.test(name)) return null;
  return { grade, classNumber, number, name };
}
export function cropBox(
  box: Rect,
  words: Word[],
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  insets: Insets,
): Rect {
  if (Object.values(insets).some((v) => !Number.isInteger(v) || v < 0 || v > 500)) throw new Error("INVALID_INSETS");
  const lower = words.filter((w) => w.y > box.y + box.height * 0.45);
  const x = Math.max(0, box.x + 4 + insets.left),
    y = Math.max(0, box.y + 4 + insets.top);
  const right = Math.min(width, box.x + box.width - 4 - insets.right);
  let bottom = Math.min(
    height,
    Math.floor(lower.length ? Math.min(...lower.map((w) => w.y)) - 2 : box.y + box.height * 0.8),
  );
  if (bottom <= y) bottom = Math.min(height, Math.floor(box.y + box.height * 0.75));
  let consecutive = 0;
  for (let row = bottom - 1; row > y + (bottom - y) * 0.65; row--) {
    let dark = 0;
    for (let col = x; col < right; col++) if (gray(pixels, (row * width + col) * 4) < 200) dark++;
    consecutive = dark / Math.max(1, right - x) > 0.15 ? consecutive + 1 : 0;
    if (consecutive >= 4) {
      bottom = Math.min(bottom, row + consecutive + 2);
      break;
    }
  }
  bottom -= insets.bottom;
  if (right <= x || bottom <= y) throw new Error("EMPTY_CROP");
  return { x, y, width: right - x, height: bottom - y };
}
