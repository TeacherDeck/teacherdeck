// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
// Text drawing adapted from Klecks render-text.ts at 7b1d4744b648de6133b0d45073af4efd2f998148.
// Changes: descriptor coordinates, canvas factory, no BB/selection dependency; retain editable descriptor.
/*
MIT License

Copyright (c) 2026 bitbof (bitbof.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import {
  assertDimensions,
  assertMemoryBudget,
  createRaster,
  EditorError,
  identityAdjustments,
  layerSize,
} from "./model.ts";
import type { Color, EditorDocument, Layer, Raster } from "./model.ts";
import { applyAdjustments } from "./color.ts";
import { documentToLocal, layerBounds, sampleBilinear } from "./geometry.ts";
export type EditorCanvas = HTMLCanvasElement | OffscreenCanvas;
export interface RasterizeOptions {
  applyAdjustments?: boolean;
  applyMask?: boolean;
}
/** Image document ink, supplied by the user's layer descriptor, encoded as CSS eight-digit hex. */
function canvasInk(color: Color): string {
  return (
    "#" +
    color
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function createCanvas(width: number, height: number): EditorCanvas {
  assertDimensions(width, height);
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new EditorError("layer", "이미지를 그릴 수 있는 환경이 필요해요.");
}
export function canvasContext(canvas: EditorCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new EditorError("layer", "이미지 그리기 환경을 열 수 없어요.");
  return context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}
export function rasterCanvas(raster: Raster): EditorCanvas {
  const canvas = createCanvas(raster.width, raster.height);
  canvasContext(canvas).putImageData(
    new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height),
    0,
    0,
  );
  return canvas;
}
function descriptorRaster(
  layer: Exclude<
    Layer,
    {
      kind: "pixel";
    }
  >,
): Raster {
  const { width, height } = layerSize(layer);
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  if (layer.kind === "text") {
    const p = layer.text;
    ctx.save();
    ctx.textAlign = p.align;
    ctx.textBaseline = "top";
    const fontArr = [p.fontSize + "px " + (p.fontFamily || "sans-serif")];
    if (p.bold) fontArr.unshift("bold");
    if (p.italic) fontArr.unshift("italic");
    ctx.font = fontArr.join(" ");
    ctx.fillStyle = canvasInk(p.color);
    const lines = p.content.split("\n").map((line) => line.replaceAll("\t", "    "));
    lines.forEach((line, lineIndex) => {
      const x = p.align === "center" ? width / 2 : p.align === "right" ? width : 0;
      const y = p.fontSize * p.lineHeight * lineIndex;
      ctx.fillText(line, x, y);
    });
    ctx.restore();
  } else {
    const p = layer.shape;
    ctx.strokeStyle = canvasInk(p.color);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = p.strokeWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const pad = p.strokeWidth / 2;
    if (p.type === "rectangle") ctx.strokeRect(pad, pad, width - p.strokeWidth, height - p.strokeWidth);
    else {
      const y = height / 2;
      const end = width - pad;
      const head = Math.min(width * 0.3, height * 0.4);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(end, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end, y);
      ctx.lineTo(end - head, y - head);
      ctx.lineTo(end - head, y + head);
      ctx.closePath();
      ctx.fill();
    }
  }
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}
export function rasterizeLayer(layer: Layer, options: RasterizeOptions = {}): Raster {
  if (layer.kind !== "pixel") return descriptorRaster(layer);
  const raster =
    options.applyAdjustments === false
      ? { ...layer.pixels, data: layer.pixels.data.slice() }
      : applyAdjustments(layer.pixels, layer.adjustments);
  if (layer.mask && options.applyMask !== false)
    for (let i = 0; i < layer.mask.length; i++)
      raster.data[i * 4 + 3] = (defined(raster.data[i * 4 + 3]) * defined(layer.mask[i])) / 255;
  return raster;
}
export function renderLayerTransformed(
  layer: Layer,
  options: RasterizeOptions = {},
): {
  raster: Raster;
  left: number;
  top: number;
} {
  const bounds = layerBounds(layer);
  assertDimensions(bounds.width, bounds.height);
  const source = rasterizeLayer(layer, options);
  const raster = createRaster(bounds.width, bounds.height);
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const local = documentToLocal({ x: bounds.x + x + 0.5, y: bounds.y + y + 0.5 }, layer.transform);
      raster.data.set(sampleBilinear(source, local.x - 0.5, local.y - 0.5, "transparent"), (y * raster.width + x) * 4);
    }
  return { raster, left: bounds.x, top: bounds.y };
}
export function compositePixel(
  destination: Uint8ClampedArray,
  index: number,
  source: readonly number[],
  opacity: number,
  blend: Layer["blend"],
): void {
  const sa = (defined(source[3]) / 255) * opacity,
    da = defined(destination[index + 3]) / 255,
    alpha = sa + da * (1 - sa);
  if (alpha === 0) return;
  for (let c = 0; c < 3; c++) {
    const s = defined(source[c]) / 255,
      d = defined(destination[index + c]) / 255;
    const mixed = blend === "multiply" ? s * d : blend === "screen" ? s + d - s * d : s;
    destination[index + c] = (255 * ((1 - sa) * da * d + (1 - da) * sa * s + sa * da * mixed)) / alpha;
  }
  destination[index + 3] = alpha * 255;
}
export function renderDocumentPixels(
  doc: EditorDocument,
  options: {
    compareOriginal?: boolean;
  } = {},
): Raster {
  const maximumLayerBytes = Math.max(
    0,
    ...doc.layers.map((l) => {
      const s = layerSize(l);
      return s.width * s.height * 4;
    }),
  );
  assertMemoryBudget(doc, doc.width * doc.height * 4 + maximumLayerBytes * 2);
  const output = createRaster(doc.width, doc.height);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    const source = rasterizeLayer(layer, { applyAdjustments: !options.compareOriginal });
    const bounds = layerBounds(layer);
    for (let y = Math.max(0, bounds.y); y < Math.min(doc.height, bounds.y + bounds.height); y++)
      for (let x = Math.max(0, bounds.x); x < Math.min(doc.width, bounds.x + bounds.width); x++) {
        const p = documentToLocal({ x: x + 0.5, y: y + 0.5 }, layer.transform);
        compositePixel(
          output.data,
          (y * doc.width + x) * 4,
          sampleBilinear(source, p.x - 0.5, p.y - 0.5, "transparent"),
          layer.opacity,
          layer.blend,
        );
      }
  }
  return output;
}
export function renderDocumentCanvas(
  doc: EditorDocument,
  options: {
    maxDimension?: number;
    compareOriginal?: boolean;
  } = {},
): EditorCanvas {
  const scale = Math.min(
    1,
    (options.maxDimension ?? Math.max(doc.width, doc.height)) / Math.max(doc.width, doc.height),
  );
  const width = Math.max(1, Math.round(doc.width * scale)),
    height = Math.max(1, Math.round(doc.height * scale));
  const maximumLayerBytes = Math.max(
    0,
    ...doc.layers.map((l) => {
      const s = layerSize(l);
      return Math.max(1, Math.ceil(s.width * scale)) * Math.max(1, Math.ceil(s.height * scale)) * 4;
    }),
  );
  assertMemoryBudget(doc, width * height * 8 + maximumLayerBytes * 3);
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  ctx.scale(scale, scale);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    const originalSize = layerSize(layer),
      localWidth = Math.max(1, Math.ceil(originalSize.width * scale)),
      localHeight = Math.max(1, Math.ceil(originalSize.height * scale));
    let preview: Layer = layer;
    if (scale < 1) {
      if (layer.kind === "pixel") {
        const pixels = createRaster(localWidth, localHeight);
        const mask = layer.mask ? new Uint8Array(localWidth * localHeight) : null;
        for (let y = 0; y < localHeight; y++)
          for (let x = 0; x < localWidth; x++) {
            const sourceIndex =
              Math.min(layer.pixels.height - 1, Math.floor(((y + 0.5) * originalSize.height) / localHeight)) *
                originalSize.width +
              Math.min(layer.pixels.width - 1, Math.floor(((x + 0.5) * originalSize.width) / localWidth));
            pixels.data.set(layer.pixels.data.subarray(sourceIndex * 4, sourceIndex * 4 + 4), (y * localWidth + x) * 4);
            if (mask) mask[y * localWidth + x] = defined(defined(layer.mask)[sourceIndex]);
          }
        preview = { ...layer, pixels, mask };
      } else if (layer.kind === "text")
        preview = {
          ...layer,
          text: { ...layer.text, width: localWidth, height: localHeight, fontSize: layer.text.fontSize * scale },
        };
      else
        preview = {
          ...layer,
          shape: {
            ...layer.shape,
            width: localWidth,
            height: localHeight,
            strokeWidth: layer.shape.strokeWidth * scale,
          },
        };
    }
    const source = rasterCanvas(rasterizeLayer(preview, { applyAdjustments: !options.compareOriginal }));
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend === "normal" ? "source-over" : layer.blend;
    ctx.translate(layer.transform.x, layer.transform.y);
    ctx.rotate((layer.transform.rotation * Math.PI) / 180);
    ctx.transform(1, 0, layer.transform.shear ?? 0, 1, 0, 0);
    ctx.scale(layer.transform.scaleX, layer.transform.scaleY);
    ctx.drawImage(source, 0, 0, originalSize.width, originalSize.height);
    ctx.restore();
    source.width = 1;
    source.height = 1;
  }
  return canvas;
}
export function rasterizeDescriptor(doc: EditorDocument, id: string): void {
  const index = doc.layers.findIndex((l) => l.id === id);
  const layer = doc.layers[index];
  if (!layer || layer.locked) throw new EditorError("layer", "잠기지 않은 레이어를 선택하세요.");
  if (layer.kind === "pixel") return;
  const size = layerSize(layer);
  assertMemoryBudget(doc, size.width * size.height * 8);
  const raster = rasterizeLayer(layer);
  doc.layers[index] = {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blend: layer.blend,
    transform: { ...layer.transform },
    kind: "pixel",
    pixels: raster,
    mask: null,
    adjustments: identityAdjustments(),
  };
}
export function mergeDown(doc: EditorDocument, id: string): void {
  const index = doc.layers.findIndex((l) => l.id === id);
  const top = doc.layers[index],
    bottom = doc.layers[index - 1];
  if (!top || !bottom || top.locked || bottom.locked)
    throw new EditorError("layer", "병합할 두 레이어를 확인해주세요.");
  if (top.blend !== "normal" || bottom.blend !== "normal")
    throw new EditorError("layer", "일반 혼합 모드 레이어끼리 병합할 수 있어요.");
  assertMemoryBudget(doc, doc.width * doc.height * 12);
  const pixels = renderDocumentPixels({ ...doc, layers: [bottom, top], selection: null });
  doc.layers.splice(index - 1, 2, {
    id: bottom.id,
    name: bottom.name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    kind: "pixel",
    pixels,
    mask: null,
    adjustments: identityAdjustments(),
  });
}
