// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
import { assertDimensions, assertMemoryBudget, clamp, createRaster, EditorError, requirePixelLayer } from "./model.ts";
import type { EditorDocument, Point, Raster } from "./model.ts";
import { documentToLocal, localToDocument } from "./geometry.ts";
import type { Rect } from "./geometry.ts";
import { floodFillBits } from "./klecks-flood-fill.ts";
import { applyAdjustments } from "./color.ts";
export type SelectionMode = "replace" | "add" | "subtract";
export function rectangleSelection(width: number, height: number, rect: Rect): Uint8Array {
  assertDimensions(width, height);
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0)
    throw new EditorError("geometry", "선택 영역 크기를 확인해주세요.");
  const mask = new Uint8Array(width * height);
  for (let y = Math.max(0, Math.floor(rect.y)); y < Math.min(height, Math.ceil(rect.y + rect.height)); y++)
    for (let x = Math.max(0, Math.floor(rect.x)); x < Math.min(width, Math.ceil(rect.x + rect.width)); x++)
      mask[y * width + x] = 255;
  return mask;
}
export function polygonSelection(width: number, height: number, points: Point[]): Uint8Array {
  assertDimensions(width, height);
  if (points.length < 3 || points.length > 256 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new EditorError("geometry", "다각형의 꼭짓점을 세 개 이상 지정해주세요.");
  const mask = new Uint8Array(width * height);
  for (
    let y = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))));
    y < Math.min(height, Math.ceil(Math.max(...points.map((p) => p.y))));
    y++
  ) {
    const intersections: number[] = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = defined(points[i]),
        b = defined(points[j]);
      if (a.y > y + 0.5 !== b.y > y + 0.5) intersections.push(((b.x - a.x) * (y + 0.5 - a.y)) / (b.y - a.y) + a.x);
    }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = Math.max(0, Math.ceil(defined(intersections[i]) - 0.5)),
        end = Math.min(width, Math.ceil(defined(intersections[i + 1]) - 0.5));
      mask.fill(255, y * width + start, y * width + Math.max(start, end));
    }
  }
  return mask;
}
export function colorSelection(raster: Raster, x: number, y: number, tolerance = 24, contiguous = true): Uint8Array {
  return floodFillBits(
    raster.data,
    undefined,
    raster.width,
    raster.height,
    x,
    y,
    Math.round(clamp(tolerance, 0, 255)),
    0,
    contiguous,
  ).data;
}
export function selectColorInLayer(
  doc: EditorDocument,
  id: string,
  point: Point,
  tolerance: number,
  contiguous: boolean,
): Uint8Array {
  const layer = requirePixelLayer(doc, id);
  assertMemoryBudget(doc, doc.width * doc.height + layer.pixels.width * layer.pixels.height * 13);
  const p = documentToLocal(point, layer.transform);
  const local = colorSelection(
    applyAdjustments(layer.pixels, layer.adjustments),
    Math.floor(p.x),
    Math.floor(p.y),
    tolerance,
    contiguous,
  );
  const selection = new Uint8Array(doc.width * doc.height);
  for (let y = 0; y < doc.height; y++)
    for (let x = 0; x < doc.width; x++) {
      const pos = documentToLocal({ x: x + 0.5, y: y + 0.5 }, layer.transform);
      const lx = Math.floor(pos.x),
        ly = Math.floor(pos.y);
      if (lx >= 0 && ly >= 0 && lx < layer.pixels.width && ly < layer.pixels.height)
        selection[y * doc.width + x] = defined(local[ly * layer.pixels.width + lx]);
    }
  return selection;
}
export function setSelection(doc: EditorDocument, next: Uint8Array | null, mode: SelectionMode = "replace"): void {
  if (next && next.length !== doc.width * doc.height)
    throw new EditorError("dimensions", "선택 영역 크기가 문서와 맞지 않아요.");
  if (mode === "replace" || !next) {
    doc.selection = next;
    return;
  }
  assertMemoryBudget(doc, doc.width * doc.height);
  const previous = doc.selection;
  const output = new Uint8Array(next.length);
  for (let i = 0; i < output.length; i++)
    output[i] =
      mode === "add"
        ? Math.max(previous?.[i] ?? 0, defined(next[i]))
        : Math.max(0, (previous?.[i] ?? 0) - defined(next[i]));
  doc.selection = output;
}
export function invertSelection(doc: EditorDocument): void {
  assertMemoryBudget(doc, doc.width * doc.height);
  const source = doc.selection;
  doc.selection = Uint8Array.from({ length: doc.width * doc.height }, (_, i) => 255 - (source?.[i] ?? 0));
}
export function applySelectionMask(doc: EditorDocument, id: string, operation: "hide" | "restore" = "hide"): void {
  if (!doc.selection) throw new EditorError("layer", "먼저 배경 영역을 선택하세요.");
  const layer = requirePixelLayer(doc, id);
  assertMemoryBudget(doc, layer.pixels.width * layer.pixels.height);
  const mask = layer.mask?.slice() ?? new Uint8Array(layer.pixels.width * layer.pixels.height).fill(255);
  for (let y = 0; y < layer.pixels.height; y++)
    for (let x = 0; x < layer.pixels.width; x++) {
      const p = localToDocument({ x: x + 0.5, y: y + 0.5 }, layer.transform);
      const dx = Math.floor(p.x),
        dy = Math.floor(p.y);
      if (dx < 0 || dy < 0 || dx >= doc.width || dy >= doc.height) continue;
      const amount = defined(doc.selection[dy * doc.width + dx]) / 255,
        i = y * layer.pixels.width + x;
      mask[i] =
        operation === "hide" ? defined(mask[i]) * (1 - amount) : defined(mask[i]) + (255 - defined(mask[i])) * amount;
    }
  layer.mask = mask;
}
/** Separable box feather. The mask remains independently editable and reversible. */
export function featherMask(doc: EditorDocument, id: string, radius: number): void {
  const layer = requirePixelLayer(doc, id);
  if (!layer.mask) throw new EditorError("layer", "먼저 마스크를 만들어주세요.");
  radius = Math.round(clamp(radius, 0, 64));
  if (radius === 0) return;
  const { width, height } = layer.pixels;
  assertMemoryBudget(doc, width * height * 2);
  const horizontal = new Uint8Array(width * height),
    output = new Uint8Array(width * height),
    source = layer.mask;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) sum += defined(source[y * width + clamp(dx, 0, width - 1)]);
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = Math.round(sum / (radius * 2 + 1));
      sum -= defined(source[y * width + clamp(x - radius, 0, width - 1)]);
      sum += defined(source[y * width + clamp(x + radius + 1, 0, width - 1)]);
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) sum += defined(horizontal[clamp(dy, 0, height - 1) * width + x]);
    for (let y = 0; y < height; y++) {
      output[y * width + x] = Math.round(sum / (radius * 2 + 1));
      sum -= defined(horizontal[clamp(y - radius, 0, height - 1) * width + x]);
      sum += defined(horizontal[clamp(y + radius + 1, 0, height - 1) * width + x]);
    }
  }
  layer.mask = output;
}
export function maskAsRaster(mask: Uint8Array, width: number, height: number): Raster {
  const raster = createRaster(width, height);
  for (let i = 0; i < mask.length; i++) raster.data.set([255, 255, 255, defined(mask[i])], i * 4);
  return raster;
}
