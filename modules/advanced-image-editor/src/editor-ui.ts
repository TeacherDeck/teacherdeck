// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Color, Point } from "./core/model.ts";
import type { Rect } from "./core/geometry.ts";
export type Tool =
  | "move"
  | "crop"
  | "rectangle"
  | "polygon"
  | "color"
  | "brush"
  | "eraser"
  | "mask-hide"
  | "mask-restore"
  | "perspective"
  | "eyedropper"
  | "hand";
export const TOOL_OPTIONS: { value: Tool; label: string }[] = [
  { value: "move", label: "이동" },
  { value: "crop", label: "자르기" },
  { value: "rectangle", label: "사각형 선택" },
  { value: "polygon", label: "다각형 선택" },
  { value: "color", label: "색상 선택" },
  { value: "brush", label: "브러시" },
  { value: "eraser", label: "지우개" },
  { value: "mask-hide", label: "마스크 지우기" },
  { value: "mask-restore", label: "마스크 복원" },
  { value: "perspective", label: "원근 보정" },
  { value: "eyedropper", label: "스포이트" },
  { value: "hand", label: "손 도구" },
];
export const CHANNEL_OPTIONS = [
  { value: "rgb", label: "전체 RGB" },
  { value: "r", label: "빨강 R" },
  { value: "g", label: "초록 G" },
  { value: "b", label: "파랑 B" },
] as const;
export const FONT_OPTIONS = [
  { value: "Malgun Gothic", label: "맑은 고딕" },
  { value: "Gulim", label: "굴림" },
  { value: "Batang", label: "바탕" },
  { value: "Arial", label: "Arial" },
  { value: "sans-serif", label: "기본 글꼴" },
];
export const DEFAULT_FONT = "Malgun Gothic";
export function colorHex(color: Color): string {
  return (
    "#" +
    color
      .slice(0, 3)
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function parseColor(value: string): Color {
  const hex = value.replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex)
    ? [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255]
    : [0, 0, 0, 255];
}
export function dragRectangle(start: Point, end: Point, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width - 1, Math.floor(Math.min(start.x, end.x))));
  const y = Math.max(0, Math.min(height - 1, Math.floor(Math.min(start.y, end.y))));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(Math.abs(end.x - start.x)))),
    height: Math.max(1, Math.min(height - y, Math.ceil(Math.abs(end.y - start.y)))),
  };
}
/** Two fallback metrics distinguish a missing installed family without font downloads. */
export function fontAvailable(family: string): boolean {
  if (["sans-serif", "serif", "monospace"].includes(family)) return true;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  const quoted = JSON.stringify(family);
  const sample = "mmmmmmmmWWWWiiii가나다123";
  return ["monospace", "serif"].some((fallback) => {
    context.font = `32px ${fallback}`;
    const base = context.measureText(sample).width;
    context.font = `32px ${quoted},${fallback}`;
    return Math.abs(context.measureText(sample).width - base) > 0.1;
  });
}
