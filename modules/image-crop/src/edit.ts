// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Edit {
  turns: number;
  flipX: boolean;
  flipY: boolean;
  rect: Rect;
  outputWidth?: number;
  brightness?: number;
  contrast?: number;
  annotation?: Annotation | undefined;
}
export interface Annotation {
  kind: "text" | "rectangle";
  text: string;
  ink: string;
  x: number;
  y: number;
  width: number;
  height: number;
  textPixels: number;
}
export const DEFAULT_ANNOTATION: Omit<Annotation, "ink"> = {
  kind: "text",
  text: "",
  x: 10,
  y: 10,
  width: 50,
  height: 50,
  textPixels: 32,
};
/** Output limits apply before allocating a canvas, independently of encoded file size. */
export function outputSize(edit: Edit): { width: number; height: number } {
  if (![edit.rect.width, edit.rect.height].every((n) => Number.isSafeInteger(n) && n > 0))
    throw new Error("INVALID_RECT");
  const width = edit.outputWidth ?? edit.rect.width;
  const height = Math.max(1, Math.round((width * edit.rect.height) / edit.rect.width));
  if (!Number.isSafeInteger(width) || width < 1 || width > 10000 || height > 10000 || width * height > 24_000_000)
    throw new Error("OUTPUT_LIMIT");
  for (const value of [edit.brightness ?? 100, edit.contrast ?? 100])
    if (!Number.isFinite(value) || value < 0 || value > 200) throw new Error("INVALID_ADJUSTMENT");
  const a = edit.annotation;
  if (
    a &&
    (!/^#[a-f\d]{6}$/i.test(a.ink) ||
      a.text.length > 200 ||
      Array.from(a.text).some((c) => c.charCodeAt(0) < 32) ||
      ![a.x, a.y, a.width, a.height, a.textPixels].every(Number.isFinite) ||
      a.x < 0 ||
      a.y < 0 ||
      a.x > 100 ||
      a.y > 100 ||
      a.width < 1 ||
      a.width > 100 ||
      a.height < 1 ||
      a.height > 100 ||
      a.textPixels < 1 ||
      a.textPixels > 500 ||
      !["text", "rectangle"].includes(a.kind))
  )
    throw new Error("INVALID_ANNOTATION");
  return { width, height };
}
export const RATIOS = [
  { value: "free", label: "자유롭게", ratio: 0 },
  { value: "1:1", label: "1:1 정사각형", ratio: 1 },
  { value: "4:3", label: "4:3 가로", ratio: 4 / 3 },
  { value: "3:4", label: "3:4 세로", ratio: 3 / 4 },
  { value: "16:9", label: "16:9 가로", ratio: 16 / 9 },
  { value: "9:16", label: "9:16 세로", ratio: 9 / 16 },
];
export function orientedSize(width: number, height: number, turns: number): { width: number; height: number } {
  return Math.abs(turns) % 2 ? { width: height, height: width } : { width, height };
}
export function clampRect(rect: Rect, width: number, height: number, ratio = 0): Rect {
  if (
    ![rect.x, rect.y, rect.width, rect.height, width, height, ratio].every(Number.isFinite) ||
    width < 1 ||
    height < 1
  )
    throw new Error("INVALID_RECT");
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x))),
    y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  let w = Math.max(1, Math.min(width - x, Math.round(rect.width))),
    h = Math.max(1, Math.min(height - y, Math.round(rect.height)));
  if (ratio > 0) {
    if (w / h > ratio) w = Math.max(1, Math.round(h * ratio));
    else h = Math.max(1, Math.round(w / ratio));
    w = Math.min(w, width - x);
    h = Math.min(h, height - y);
  }
  return { x, y, width: w, height: h };
}
export function centeredRect(width: number, height: number, ratio = 0): Rect {
  const rect = clampRect({ x: 0, y: 0, width, height }, width, height, ratio);
  return { ...rect, x: Math.floor((width - rect.width) / 2), y: Math.floor((height - rect.height) / 2) };
}
/** Relative rectangle transfer keeps the same composition across differently sized photos. */
export function transferRect(
  rect: Rect,
  from: { width: number; height: number },
  to: { width: number; height: number },
  ratio = 0,
): Rect {
  return clampRect(
    {
      x: (rect.x / from.width) * to.width,
      y: (rect.y / from.height) * to.height,
      width: (rect.width / from.width) * to.width,
      height: (rect.height / from.height) * to.height,
    },
    to.width,
    to.height,
    ratio,
  );
}
export function outputName(name: string, format: "png" | "jpeg"): string {
  const stem =
    name
      .replace(/\.[^.]*$/, "")
      .replace(/[<>:"/\\|?*]/g, "_")
      .split("")
      .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
      .join("")
      .replace(/[. ]+$/g, "")
      .slice(0, 90) || "이미지";
  return `${stem}_자르기.${format === "jpeg" ? "jpg" : "png"}`;
}
