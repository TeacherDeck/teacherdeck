// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
import { clamp, EditorError } from "./model.ts";
import type { Adjustments, Channel, CurvePoint, Level, Raster } from "./model.ts";
export function validateLevel(level: Level): void {
  if (
    !Object.values(level).every(Number.isFinite) ||
    level.black < 0 ||
    level.white > 255 ||
    level.black >= level.white ||
    level.gamma < 0.1 ||
    level.gamma > 10 ||
    level.outputBlack < 0 ||
    level.outputWhite > 255 ||
    level.outputBlack > level.outputWhite
  )
    throw new EditorError("layer", "레벨의 검정·흰색 경계와 감마를 확인해주세요.");
}
/** Monotone Hermite interpolation; duplicate X is rejected rather than divided by zero. */
export function curveLut(input: CurvePoint[]): Uint8ClampedArray {
  const points = input.map((point) => ({ ...point })).sort((a, b) => a.x - b.x);
  if (
    points.length < 2 ||
    points.length > 32 ||
    points.some(
      (p, i) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 255 ||
        p.y < 0 ||
        p.y > 255 ||
        (i > 0 && p.x === defined(points[i - 1]).x),
    )
  )
    throw new EditorError("layer", "곡선 제어점의 입력 값은 서로 달라야 해요.");
  const slopes = points.slice(1).map((p, i) => (p.y - defined(points[i]).y) / (p.x - defined(points[i]).x));
  const tangents = points.map((_p, i) =>
    i === 0
      ? defined(slopes[0])
      : i === points.length - 1
        ? defined(slopes[slopes.length - 1])
        : defined(slopes[i - 1]) * defined(slopes[i]) <= 0
          ? 0
          : (2 * defined(slopes[i - 1]) * defined(slopes[i])) / (defined(slopes[i - 1]) + defined(slopes[i])),
  );
  for (let i = 0; i < slopes.length; i++) {
    const slope = defined(slopes[i]);
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = defined(tangents[i]) / slope;
    const b = defined(tangents[i + 1]) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const factor = 3 / Math.sqrt(magnitude);
      tangents[i] = factor * a * slope;
      tangents[i + 1] = factor * b * slope;
    }
  }
  const lut = new Uint8ClampedArray(256);
  let segment = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= defined(points[0]).x) {
      lut[x] = defined(points[0]).y;
      continue;
    }
    if (x >= defined(points[points.length - 1]).x) {
      lut[x] = defined(points[points.length - 1]).y;
      continue;
    }
    while (x > defined(points[segment + 1]).x) segment++;
    const p = defined(points[segment]);
    const q = defined(points[segment + 1]);
    const h = q.x - p.x;
    const t = (x - p.x) / h;
    lut[x] =
      (2 * t ** 3 - 3 * t ** 2 + 1) * p.y +
      (t ** 3 - 2 * t ** 2 + t) * h * defined(tangents[segment]) +
      (-2 * t ** 3 + 3 * t ** 2) * q.y +
      (t ** 3 - t ** 2) * h * defined(tangents[segment + 1]);
  }
  return lut;
}
function applyLevel(value: number, level: Level): number {
  return (
    level.outputBlack +
    clamp((value - level.black) / (level.white - level.black)) ** (1 / level.gamma) *
      (level.outputWhite - level.outputBlack)
  );
}
export function adjustmentLuts(adjustments: Adjustments): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] {
  if (
    !Number.isFinite(adjustments.brightness) ||
    !Number.isFinite(adjustments.contrast) ||
    Math.abs(adjustments.brightness) > 1 ||
    Math.abs(adjustments.contrast) > 1
  )
    throw new EditorError("layer", "명도와 대비는 -100부터 100까지 조절할 수 있어요.");
  for (const level of Object.values(adjustments.levels)) validateLevel(level);
  const curves = {
    rgb: curveLut(adjustments.curves.rgb),
    r: curveLut(adjustments.curves.r),
    g: curveLut(adjustments.curves.g),
    b: curveLut(adjustments.curves.b),
  };
  const contrast = adjustments.contrast >= 0 ? 1 / Math.max(0.001, 1 - adjustments.contrast) : 1 + adjustments.contrast;
  return (["r", "g", "b"] as const).map((channel: Channel) => {
    const lut = new Uint8ClampedArray(256);
    for (let value = 0; value < 256; value++) {
      let result = clamp((value / 255 + adjustments.brightness - 0.5) * contrast + 0.5, 0, 1) * 255;
      result = applyLevel(result, adjustments.levels.rgb);
      result = applyLevel(result, adjustments.levels[channel]);
      result = defined(curves.rgb[Math.round(clamp(result, 0, 255))]);
      result = defined(curves[channel][Math.round(clamp(result, 0, 255))]);
      lut[value] = result;
    }
    return lut;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}
export function applyAdjustments(raster: Raster, adjustments: Adjustments): Raster {
  const luts = adjustmentLuts(adjustments);
  const data = raster.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    data[i] = defined(luts[0][defined(data[i])]);
    data[i + 1] = defined(luts[1][defined(data[i + 1])]);
    data[i + 2] = defined(luts[2][defined(data[i + 2])]);
  }
  return { width: raster.width, height: raster.height, data };
}
export function histogram(raster: Raster): {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  rgb: Uint32Array;
} {
  const result = {
    r: new Uint32Array(256),
    g: new Uint32Array(256),
    b: new Uint32Array(256),
    rgb: new Uint32Array(256),
  };
  for (let i = 0; i < raster.data.length; i += 4) {
    if (!raster.data[i + 3]) continue;
    const r = defined(raster.data[i]);
    const g = defined(raster.data[i + 1]);
    const b = defined(raster.data[i + 2]);
    result.r[r] = defined(result.r[r]) + 1;
    result.g[g] = defined(result.g[g]) + 1;
    result.b[b] = defined(result.b[b]) + 1;
    const value = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    result.rgb[value] = defined(result.rgb[value]) + 1;
  }
  return result;
}
