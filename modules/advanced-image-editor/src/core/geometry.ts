// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
import { assertDimensions, assertMemoryBudget, clamp, createRaster, EditorError, layerSize } from "./model.ts";
import type { EditorDocument, Layer, Point, Raster, Transform } from "./model.ts";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function localToDocument(point: Point, transform: Transform): Point {
  const angle = (transform.rotation * Math.PI) / 180;
  const x = point.x * transform.scaleX + point.y * transform.scaleY * (transform.shear ?? 0);
  const y = point.y * transform.scaleY;
  return {
    x: transform.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: transform.y + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
export function documentToLocal(point: Point, transform: Transform): Point {
  const angle = (-transform.rotation * Math.PI) / 180;
  const x = point.x - transform.x;
  const y = point.y - transform.y;
  const ry = x * Math.sin(angle) + y * Math.cos(angle);
  const rx = x * Math.cos(angle) - y * Math.sin(angle);
  return { x: (rx - (transform.shear ?? 0) * ry) / transform.scaleX, y: ry / transform.scaleY };
}
export function layerBounds(layer: Layer): Rect {
  const { width, height } = layerSize(layer);
  const points = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((p) => localToDocument(p, layer.transform));
  const x = Math.floor(Math.min(...points.map((p) => p.x)));
  const y = Math.floor(Math.min(...points.map((p) => p.y)));
  return {
    x,
    y,
    width: Math.ceil(Math.max(...points.map((p) => p.x))) - x,
    height: Math.ceil(Math.max(...points.map((p) => p.y))) - y,
  };
}
/** Alpha-weighted bilinear sampling avoids color fringes on transparent pixels. */
export function sampleBilinear(
  raster: Raster,
  x: number,
  y: number,
  edge: "clamp" | "transparent" = "clamp",
): [number, number, number, number] {
  if (edge === "clamp") {
    if (x < -0.5 || y < -0.5 || x > raster.width - 0.5 || y > raster.height - 0.5) return [0, 0, 0, 0];
    x = clamp(x, 0, raster.width - 1);
    y = clamp(y, 0, raster.height - 1);
  } else if (x <= -1 || y <= -1 || x >= raster.width || y >= raster.height) return [0, 0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0, 0];
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const px = x0 + dx,
        py = y0 + dy;
      if (edge === "transparent" && (px < 0 || py < 0 || px >= raster.width || py >= raster.height)) continue;
      const i = (Math.min(py, raster.height - 1) * raster.width + Math.min(px, raster.width - 1)) * 4;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const a = defined(raster.data[i + 3]) / 255;
      for (let c = 0; c < 3; c++) out[c] = defined(out[c]) + defined(raster.data[i + c]) * a * weight;
      out[3] = defined(out[3]) + a * weight;
    }
  return defined(out[3]) === 0
    ? [0, 0, 0, 0]
    : [
        defined(out[0]) / defined(out[3]),
        defined(out[1]) / defined(out[3]),
        defined(out[2]) / defined(out[3]),
        defined(out[3]) * 255,
      ];
}
export function resizeRaster(raster: Raster, width: number, height: number): Raster {
  const output = createRaster(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sample = sampleBilinear(
        raster,
        ((x + 0.5) * raster.width) / width - 0.5,
        ((y + 0.5) * raster.height) / height - 0.5,
      );
      output.data.set(sample, (y * width + x) * 4);
    }
  return output;
}
export function cropDocument(doc: EditorDocument, rect: Rect): void {
  const { x, y, width, height } = rect;
  assertDimensions(width, height);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x + width > doc.width ||
    y + height > doc.height
  )
    throw new EditorError("geometry", "자르기 영역이 문서 안에 있어야 해요.");
  for (const layer of doc.layers) {
    layer.transform.x -= x;
    layer.transform.y -= y;
  }
  doc.width = width;
  doc.height = height;
  doc.selection = null;
}
export function resizeDocument(doc: EditorDocument, width: number, height: number): void {
  assertDimensions(width, height);
  const sx = width / doc.width,
    sy = height / doc.height;
  for (const layer of doc.layers) {
    const t = layer.transform,
      angle = (t.rotation * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      shear = t.shear ?? 0;
    const a = sx * cos * t.scaleX,
      b = sy * sin * t.scaleX,
      c = sx * (cos * shear - sin) * t.scaleY,
      d = sy * (sin * shear + cos) * t.scaleY;
    const scaleX = Math.hypot(a, b),
      scaleY = (a * d - b * c) / scaleX;
    t.x *= sx;
    t.y *= sy;
    t.rotation = (Math.atan2(b, a) * 180) / Math.PI;
    t.scaleX = scaleX;
    t.scaleY = scaleY;
    t.shear = (a * c + b * d) / (scaleX * scaleY);
  }
  doc.width = width;
  doc.height = height;
  doc.selection = null;
}
export function resizeCanvas(doc: EditorDocument, width: number, height: number, offsetX = 0, offsetY = 0): void {
  assertDimensions(width, height);
  for (const layer of doc.layers) {
    layer.transform.x += offsetX;
    layer.transform.y += offsetY;
  }
  doc.width = width;
  doc.height = height;
  doc.selection = null;
}
/** Four source corners in TL, TR, BR, BL order map to a rectangular output. */
export function perspectiveRaster(
  raster: Raster,
  corners: [Point, Point, Point, Point],
  width: number,
  height: number,
  shouldCancel?: () => boolean,
): Raster {
  assertDimensions(width, height);
  const [a, b, c, d] = corners;
  if (
    corners.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.y < 0 ||
        p.x > raster.width ||
        p.y > raster.height,
    )
  )
    throw new EditorError("geometry", "네 꼭짓점을 이미지 안에서 지정해주세요.");
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p = defined(corners[i]),
      q = defined(corners[(i + 1) % 4]),
      r = defined(corners[(i + 2) % 4]);
    const cross = (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
    if (Math.abs(cross) < 1e-6 || (sign && Math.sign(cross) !== sign))
      throw new EditorError("geometry", "네 꼭짓점은 서로 교차하지 않는 사각형이어야 해요.");
    sign = Math.sign(cross);
  }
  const dx1 = b.x - c.x,
    dx2 = d.x - c.x,
    dx3 = a.x - b.x + c.x - d.x,
    dy1 = b.y - c.y,
    dy2 = d.y - c.y,
    dy3 = a.y - b.y + c.y - d.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(dx3) + Math.abs(dy3) < 1e-9 ? 0 : (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = Math.abs(dx3) + Math.abs(dy3) < 1e-9 ? 0 : (dx1 * dy3 - dx3 * dy1) / determinant;
  if (!Number.isFinite(g) || !Number.isFinite(h))
    throw new EditorError("geometry", "원근 보정 영역을 다시 지정해주세요.");
  const output = createRaster(width, height);
  for (let y = 0; y < height; y++) {
    if (shouldCancel?.()) throw new EditorError("geometry", "작업을 취소했어요.");
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height,
        den = g * u + h * v + 1;
      const sx = ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / den - 0.5;
      const sy = ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / den - 0.5;
      output.data.set(sampleBilinear(raster, sx, sy), (y * width + x) * 4);
    }
  }
  return output;
}
export function applyPerspective(
  doc: EditorDocument,
  id: string,
  corners: [Point, Point, Point, Point],
  width: number,
  height: number,
): void {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer || layer.kind !== "pixel" || layer.locked) throw new EditorError("layer", "사진 레이어를 선택하세요.");
  assertDimensions(width, height);
  assertMemoryBudget(
    doc,
    width * height * (layer.mask ? 9 : 4) + (layer.mask ? layer.pixels.width * layer.pixels.height * 4 : 0),
  );
  const pixels = perspectiveRaster(layer.pixels, corners, width, height);
  if (layer.mask) {
    const maskRaster = createRaster(layer.pixels.width, layer.pixels.height);
    for (let i = 0; i < layer.mask.length; i++) {
      maskRaster.data.set([255, 255, 255, defined(layer.mask[i])], i * 4);
    }
    const warped = perspectiveRaster(maskRaster, corners, width, height);
    layer.mask = Uint8Array.from({ length: width * height }, (_, i) => defined(warped.data[i * 4 + 3]));
  }
  layer.pixels = pixels;
}
