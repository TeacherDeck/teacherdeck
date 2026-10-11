// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Rect, TextBox } from "./logic.ts";
export interface TextView {
  text: string;
  spans: { start: number; end: number; box: TextBox }[];
  rect: Rect;
}
function readingRect(box: TextBox): Rect {
  // Layout in the text's reading direction; spans still point at original pixel boxes.
  switch (box.rotation) {
    case 90:
      return { x: box.y, y: -box.x - box.width, width: box.height, height: box.width };
    case 180:
      return { x: -box.x - box.width, y: -box.y - box.height, width: box.width, height: box.height };
    case 270:
      return { x: -box.y - box.height, y: box.x, width: box.height, height: box.width };
    default:
      return box;
  }
}
/** Join nearby runs on one baseline, never across a wide column gap. */
export function contextLines(boxes: readonly TextBox[]): TextView[] {
  const pieces = boxes
    .flatMap((box) => {
      const rect = readingRect(box);
      return box.text.split(/\r?\n/).map((text, index, lines) => ({
        text,
        box,
        rotation: box.rotation ?? 0,
        x: rect.x,
        y: rect.y + (index * rect.height) / lines.length,
        width: rect.width,
        height: rect.height / lines.length,
      }));
    })
    .filter((piece) => piece.text.trim());
  pieces.sort((a, b) => a.rotation - b.rotation || a.y + a.height / 2 - b.y - b.height / 2 || a.x - b.x);
  const rows: (typeof pieces)[] = [];
  for (const piece of pieces) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (
      row &&
      first &&
      piece.rotation === first.rotation &&
      Math.abs(piece.y + piece.height / 2 - first.y - first.height / 2) <= Math.min(piece.height, first.height) * 0.45
    )
      row.push(piece);
    else rows.push([piece]);
  }
  const result: TextView[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current: TextView | undefined;
    let previous: (typeof pieces)[number] | undefined;
    for (const piece of row) {
      const gap = previous ? piece.x - previous.x - previous.width : 0;
      if (!current || (previous && gap > Math.max(piece.height, previous.height) * 3)) {
        current = { text: "", spans: [], rect: { x: piece.x, y: piece.y, width: piece.width, height: piece.height } };
        result.push(current);
      } else {
        const latinWords = /[A-Za-z]{2,}$/.test(current.text) && /^[A-Za-z]{2,}/.test(piece.text);
        if (latinWords || gap > piece.height * 0.3) current.text += " ";
        const right = Math.max(current.rect.x + current.rect.width, piece.x + piece.width);
        const bottom = Math.max(current.rect.y + current.rect.height, piece.y + piece.height);
        current.rect.x = Math.min(current.rect.x, piece.x);
        current.rect.y = Math.min(current.rect.y, piece.y);
        current.rect.width = right - current.rect.x;
        current.rect.height = bottom - current.rect.y;
      }
      const start = current.text.length;
      current.text += piece.text;
      current.spans.push({ start, end: current.text.length, box: piece.box });
      previous = piece;
    }
  }
  const fields: TextView[] = [];
  for (let index = 0; index < result.length; index++) {
    const line = result[index];
    if (!line) continue;
    const next = result[index + 1];
    const bareLabel =
      /^(?:성\s*명|이\s*름|학\s*생\s*명|보\s*호\s*자\s*명|영\s*문\s*(?:명|이\s*름)|학\s*번|학\s*생\s*번\s*호|출\s*석\s*번\s*호|주\s*소|거\s*주\s*지|계\s*좌(?:\s*번\s*호)?|생\s*년\s*월\s*일|생\s*일|출\s*생\s*일|(?:student\s+|guardian\s+|full\s+)?name|address)\s*[:：]?\s*$/i.test(
        line.text,
      );
    if (
      bareLabel &&
      next &&
      (line.spans[0]?.box.rotation ?? 0) === (next.spans[0]?.box.rotation ?? 0) &&
      next.rect.y >= line.rect.y + line.rect.height - 1 &&
      next.rect.y - line.rect.y - line.rect.height <= line.rect.height * 1.5 &&
      Math.abs(next.rect.x - line.rect.x) <= line.rect.height * 2 &&
      !labelled(next.text)
    ) {
      const offset = line.text.length + 1;
      fields.push({
        text: `${line.text}\n${next.text}`,
        rect: next.rect,
        spans: [
          ...line.spans,
          ...next.spans.map((span) => ({ ...span, start: span.start + offset, end: span.end + offset })),
        ],
      });
      index++;
    } else fields.push(line);
  }
  return fields;
}
export function labelled(text: string): boolean {
  return /^(?:성\s*명|이\s*름|학\s*번|주\s*소|거\s*주\s*지|연락처|전화|계좌|생년|생일|출생|번호|비고|소속|담당|서명|name\b|address\b|phone\b|date\b)\s*[:：]?|^[^:：\n]{1,24}[:：]/i.test(
    text,
  );
}
