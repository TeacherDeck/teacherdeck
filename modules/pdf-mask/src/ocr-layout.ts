// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { boundRect, type PageInfo, type TextBox } from "./logic.ts";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** OCR pixels are in the already rotated PDF viewport. Reject malformed/oversize output. */
export function ocrBoxes(
  data: unknown,
  page: PageInfo,
  pixelWidth: number,
  pixelHeight: number,
): { boxes: TextBox[]; confidence: number } {
  if (![pixelWidth, pixelHeight].every((v) => Number.isFinite(v) && v > 0)) throw new Error("OCR_INVALID_SIZE");
  const root = record(data);
  if (!("blocks" in root) || (root["blocks"] !== null && !Array.isArray(root["blocks"])))
    throw new Error("OCR_INVALID_RESULT");
  if (root["blocks"] === null && typeof root["text"] === "string" && root["text"].trim())
    throw new Error("OCR_INVALID_RESULT");
  const confidence =
    typeof root["confidence"] === "number" && Number.isFinite(root["confidence"]) ? root["confidence"] : 0;
  const boxes: TextBox[] = [];
  let characters = 0;
  for (const block of array(root["blocks"]))
    for (const paragraph of array(record(block)["paragraphs"]))
      for (const line of array(record(paragraph)["lines"]))
        for (const word of array(record(line)["words"])) {
          const item = record(word);
          const text = typeof item["text"] === "string" ? item["text"].trim() : "";
          if (!text) continue;
          characters += text.length;
          if (boxes.length >= 20_000 || characters > 200_000) throw new Error("OCR_TOO_LARGE");
          const bbox = record(item["bbox"]);
          const coords = [bbox["x0"], bbox["y0"], bbox["x1"], bbox["y1"]];
          if (!coords.every((v) => typeof v === "number" && Number.isFinite(v))) throw new Error("OCR_INVALID_BOX");
          const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = coords as number[];
          if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > pixelWidth || y1 > pixelHeight)
            throw new Error("OCR_INVALID_BOX");
          boxes.push({
            text,
            rotation: 0,
            ...boundRect(
              {
                x: (x0 * page.width) / pixelWidth - 1,
                y: (y0 * page.height) / pixelHeight - 1,
                width: ((x1 - x0) * page.width) / pixelWidth + 2,
                height: ((y1 - y0) * page.height) / pixelHeight + 2,
              },
              page.width,
              page.height,
            ),
          });
        }
  return { boxes, confidence };
}
