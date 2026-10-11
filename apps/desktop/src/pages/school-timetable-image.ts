// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { SchoolWeeklySlot } from "@deck/sdk";
import { WEEKDAYS } from "./school-data-model.ts";
export interface TimetableImageInput {
  title: string;
  periods: number;
  entries: SchoolWeeklySlot[];
  contexts: { id: string; label: string }[];
}
interface ImageTheme {
  font: string;
  fontSize: number;
  lineHeight: number;
  foreground: string;
  background: string;
  border: string;
  header: string;
  saturday: string;
  sunday: string;
}
/** Wrap by Unicode character; no markup, external image, or arbitrary HTML rendering. */
export function wrapImageText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    if (character === "\n") {
      lines.push(line);
      line = "";
      continue;
    }
    if (measure(character) > width) throw new Error("글자가 너무 커서 이미지를 만들 수 없어요.");
    if (line && measure(line + character) > width) {
      lines.push(line);
      line = "";
    }
    line += character;
  }
  lines.push(line);
  return lines;
}
/** The output is bounded independently of window size/DPI; never silently clip rows or lessons. */
export function layoutTimetableImage(
  input: TimetableImageInput,
  lineHeight: number,
  measure: (text: string) => number,
) {
  if (
    !Number.isInteger(input.periods) ||
    input.periods < 1 ||
    input.periods > 64 ||
    !Number.isFinite(lineHeight) ||
    lineHeight < 1
  )
    throw new Error("이미지로 저장할 교시 수와 글꼴을 확인해 주세요.");
  const width = 1600,
    padding = lineHeight,
    firstColumn = lineHeight * 4,
    column = (width - firstColumn) / 7;
  const title = wrapImageText(input.title, width - padding * 2, measure);
  const titleHeight = (title.length + 2) * lineHeight,
    headerHeight = lineHeight * 3;
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const key = `${entry.weekday}:${entry.period}`;
    if (
      entry.weekday < 1 ||
      entry.weekday > 7 ||
      entry.period < 1 ||
      entry.period > input.periods ||
      seen.has(key) ||
      !input.contexts.some((context) => context.id === entry.contextId)
    )
      throw new Error("현재 시간표의 수업과 교시를 확인해 주세요.");
    seen.add(key);
  }
  const rows = Array.from({ length: input.periods }, (_, index) => {
    const cells = WEEKDAYS.map((_, day) => {
      const entry = input.entries.find((entry) => entry.weekday === day + 1 && entry.period === index + 1);
      const label = input.contexts.find((context) => context.id === entry?.contextId)?.label ?? "";
      return wrapImageText(label, column - padding * 2, measure);
    });
    return { cells, height: (Math.max(1, ...cells.map((cell) => cell.length)) + 2) * lineHeight };
  });
  const height = Math.ceil(titleHeight + headerHeight + rows.reduce((height, row) => height + row.height, 0));
  if (width > 4096 || height > 4096 || width * height > 16_000_000)
    throw new Error("시간표 이미지가 너무 커요. 표시할 교시를 줄이거나 수업 이름을 짧게 정리해 주세요.");
  return { width, height, padding, firstColumn, column, title, titleHeight, headerHeight, rows };
}
/** Uses the current Fluent computed palette and system Korean font after font readiness. */
export async function renderTimetablePng(input: TimetableImageInput, table: HTMLTableElement): Promise<string> {
  await document.fonts?.ready;
  const style = getComputedStyle(table),
    headers = table.querySelectorAll("thead th"),
    cell = table.querySelector("td, th");
  const firstHeader = headers[0],
    saturdayHeader = headers[6],
    sundayHeader = headers[7];
  if (!cell || headers.length !== 8 || !firstHeader || !saturdayHeader || !sundayHeader)
    throw new Error("시간표 화면을 먼저 열어 주세요.");
  const header = getComputedStyle(firstHeader),
    fontSize = Number.parseFloat(style.fontSize);
  const theme: ImageTheme = {
    font: style.fontFamily,
    fontSize,
    lineHeight: Number.parseFloat(style.lineHeight) || fontSize * 1.5,
    foreground: style.color,
    background: style.backgroundColor,
    border: getComputedStyle(cell).borderTopColor,
    header: header.backgroundColor,
    saturday: getComputedStyle(saturdayHeader).color,
    sunday: getComputedStyle(sundayHeader).color,
  };
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("시간표 이미지를 만들 수 없어요.");
  ctx.font = `${theme.fontSize}px ${theme.font}`;
  const layout = layoutTimetableImage(input, theme.lineHeight, (text) => ctx.measureText(text).width);
  canvas.width = layout.width;
  canvas.height = layout.height;
  ctx.font = `${theme.fontSize}px ${theme.font}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = theme.foreground;
  layout.title.forEach((text, index) => ctx.fillText(text, layout.padding, layout.padding + index * theme.lineHeight));
  let y = layout.titleHeight;
  ctx.fillStyle = theme.header;
  ctx.fillRect(0, y, layout.width, layout.headerHeight);
  ctx.strokeStyle = theme.border;
  const drawCell = (x: number, cellWidth: number, cellHeight: number, lines: string[], color: string) => {
    ctx.strokeRect(x, y, cellWidth, cellHeight);
    ctx.fillStyle = color;
    lines.forEach((text, index) =>
      ctx.fillText(text, x + layout.padding, y + layout.padding + index * theme.lineHeight),
    );
  };
  drawCell(0, layout.firstColumn, layout.headerHeight, ["교시"], theme.foreground);
  WEEKDAYS.forEach((day, index) =>
    drawCell(
      layout.firstColumn + index * layout.column,
      layout.column,
      layout.headerHeight,
      [day],
      index === 5 ? theme.saturday : index === 6 ? theme.sunday : theme.foreground,
    ),
  );
  y += layout.headerHeight;
  layout.rows.forEach((row, index) => {
    drawCell(0, layout.firstColumn, row.height, [`${index + 1}`], theme.foreground);
    row.cells.forEach((lines, day) =>
      drawCell(layout.firstColumn + day * layout.column, layout.column, row.height, lines, theme.foreground),
    );
    y += row.height;
  });
  const data = canvas.toDataURL("image/png");
  const prefix = "data:image/png;base64,";
  if (!data.startsWith(prefix) || data.length - prefix.length > Math.ceil((16 * 1024 * 1024) / 3) * 4)
    throw new Error("시간표 이미지가 너무 커요. 표시할 교시를 줄여 주세요.");
  return data.slice(prefix.length);
}
