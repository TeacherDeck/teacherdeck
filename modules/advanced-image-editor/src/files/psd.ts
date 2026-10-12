// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// PSD codec adapter uses ag-psd (MIT), without its sample image/brush assets.
import { getLayerImageData, getLayerMaskImageData, initializeCanvas, readPsd, writePsdUint8Array } from "ag-psd";
import type { Layer as PsdLayer, Psd, PixelData, TextStyle, LayerTextData, Color as PsdColor } from "ag-psd";
import { Unzlib } from "fflate";
import {
  assertMemoryBudget,
  createDocument,
  createPixelLayer,
  createTextLayer,
  validateDocument,
} from "../core/model.ts";
import type { EditorDocument, Layer, PixelLayer, Raster, TextLayer, Transform, Color } from "../core/model.ts";
import { checkBytes, checkDimensions, MAX_INPUT_BYTES, MAX_LAYERS, MAX_WORKING_BYTES } from "./limits.ts";
import { psdEncodingScratch } from "./export-budget.ts";

// ImageData-only reading/writing never creates a DOM Canvas; this also works inside a Worker.
initializeCanvas(
  () => {
    throw new Error("UNEXPECTED_CANVAS");
  },
  (width, height) =>
    ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: "srgb" }) as ImageData,
);

export interface ImportOptions {
  complexText?: "reject" | "simplify";
  unsupported?: "reject" | "composite";
  fontReplacements?: Record<string, string>;
  /** Live editor, history and cached-preview bytes outside the codec. Input copies are counted by the codec. */
  reservedBytes?: number;
}
export interface ImportedDocument {
  document: EditorDocument;
  warnings: string[];
  fonts: string[];
  flattened: boolean;
}
export class PsdImportError extends Error {
  readonly code: "PSD_UNSUPPORTED" | "PSD_COMPLEX_TEXT" | "PSD_NO_COMPOSITE";
  readonly reasons: string[];
  constructor(code: "PSD_UNSUPPORTED" | "PSD_COMPLEX_TEXT" | "PSD_NO_COMPOSITE", reasons: string[]) {
    super(code);
    this.name = "PsdImportError";
    this.code = code;
    this.reasons = reasons;
  }
}
const finite = (value: number | undefined, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
function psdHeader(bytes: Uint8Array): void {
  if (bytes.length < 26 || bytes.length > MAX_INPUT_BYTES) throw new Error("INPUT_LIMIT");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x38425053 || v.getUint16(4) !== 1 || v.getUint16(22) !== 8 || v.getUint16(24) !== 3)
    throw new PsdImportError("PSD_UNSUPPORTED", ["8-bit RGB PSD 파일만 열 수 있어요."]);
  checkDimensions(v.getUint32(18), v.getUint32(14));
}
function raster(image: PixelData | undefined): Raster | null {
  if (!image) return null;
  checkDimensions(image.width, image.height);
  if (
    !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  )
    throw new Error("INVALID_PSD");
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length),
  };
}
/** Validate a zlib stream in bounded input pieces before ag-psd's pako inflation allocates its result. */
function boundedZlib(bytes: Uint8Array, expected: number): void {
  checkBytes(expected);
  let output = 0,
    final = false;
  const decoder = new Unzlib((chunk, last) => {
    output += chunk.length;
    if (output > expected) throw new Error("MEMORY_LIMIT");
    final = last;
  });
  for (let at = 0; at < bytes.length; at += 64) decoder.push(bytes.subarray(at, at + 64), at + 64 >= bytes.length);
  if (!final || output !== expected) throw new Error("INVALID_PSD");
}
/** PackBits row lengths and expansion must match declared bitmap dimensions before the codec writes pixels. */
function validateRle(bytes: Uint8Array, width: number, height: number, channels = 1): void {
  const rows = height * channels;
  if (bytes.length < rows * 2) throw new Error("INVALID_PSD");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = rows * 2;
  for (let row = 0; row < rows; row++) {
    const end = at + view.getUint16(row * 2);
    if (end > bytes.length) throw new Error("INVALID_PSD");
    let expanded = 0;
    while (at < end) {
      const control = bytes[at++] ?? 128;
      if (control < 128) {
        const count = control + 1;
        at += count;
        expanded += count;
      } else if (control > 128) {
        at++;
        expanded += 257 - control;
      }
      if (at > end || expanded > width) throw new Error("INVALID_PSD");
    }
    if (expanded !== width) throw new Error("INVALID_PSD");
  }
  if (at !== bytes.length) throw new Error("INVALID_PSD");
}
function validateLayerCompression(layer: PsdLayer): void {
  for (const channel of layer.rawData?.channels ?? []) {
    if (!channel.data) continue;
    const rect = channel.id === -2 ? layer.mask : channel.id === -3 ? layer.realMask : layer;
    const width = Math.max(0, finite(rect?.right) - finite(rect?.left)),
      height = Math.max(0, finite(rect?.bottom) - finite(rect?.top));
    if (width && height) checkDimensions(width, height);
    if (channel.compression === 0 && channel.data.length !== width * height) throw new Error("INVALID_PSD");
    if (channel.compression === 1) validateRle(channel.data, width, height);
    if (channel.compression === 2 || channel.compression === 3) boundedZlib(channel.data, width * height);
  }
}
function validateCompositeCompression(psd: Psd): void {
  const bytes = psd.rawCompositeData;
  if (!bytes || bytes.length < 2) return;
  const kind = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
  if (kind === 0 && bytes.length - 2 !== psd.width * psd.height * (psd.channels ?? 3)) throw new Error("INVALID_PSD");
  if (kind === 1) validateRle(bytes.subarray(2), psd.width, psd.height, psd.channels ?? 3);
  if (kind === 2 || kind === 3) boundedZlib(bytes.subarray(2), psd.width * psd.height * (psd.channels ?? 3));
}
function unsupported(layer: PsdLayer): string[] {
  const reasons: string[] = [];
  if (layer.clipping) reasons.push("클리핑 레이어");
  if (layer.adjustment) reasons.push("조정 레이어");
  if (layer.placedLayer) reasons.push("스마트 오브젝트");
  if (
    layer.effects &&
    !layer.effects.disabled &&
    Object.keys(layer.effects).some((key) => !["disabled", "scale"].includes(key))
  )
    reasons.push("레이어 효과");
  if (layer.vectorMask || layer.vectorFill || layer.vectorStroke) reasons.push("벡터 레이어/마스크");
  if (layer.realMask || layer.filterEffectsMasks || layer.pixelSource || layer.artboard) reasons.push("특수 레이어");
  if (layer.fillOpacity !== undefined && layer.fillOpacity !== 1) reasons.push("채우기 불투명도");
  if (layer.knockout || layer.blendInteriorElements === false || layer.channelBlendingRestrictions?.length)
    reasons.push("고급 혼합 설정");
  const ranges = layer.blendingRanges;
  if (ranges) {
    const values = [
      ranges.compositeGrayBlendSource,
      ranges.compositeGraphBlendDestinationRange,
      ...ranges.ranges.flatMap((r) => [r.sourceRange, r.destRange]),
    ];
    if (values.some((a) => a.join(",") !== "0,0,255,255")) reasons.push("조건부 혼합");
  }
  const mask = layer.mask;
  if (
    mask &&
    (mask.disabled ||
      mask.fromVectorData ||
      mask.userMaskFeather ||
      mask.vectorMaskFeather ||
      (mask.userMaskDensity !== undefined && mask.userMaskDensity !== 1) ||
      (mask.vectorMaskDensity !== undefined && mask.vectorMaskDensity !== 1))
  )
    reasons.push("복잡한 마스크");
  if (layer.text && mask && !mask.disabled) reasons.push("글자 마스크");
  if (!layer.children && !["normal", "multiply", "screen"].includes(layer.blendMode ?? "normal"))
    reasons.push("지원하지 않는 혼합 모드");
  return reasons;
}
function color(value: PsdColor | undefined): Color {
  if (!value) return [0, 0, 0, 255];
  if ("r" in value) return [value.r, value.g, value.b, "a" in value ? value.a : 255];
  if ("fr" in value) return [value.fr * 255, value.fg * 255, value.fb * 255, 255];
  throw new Error("PSD_COMPLEX_TEXT");
}
function simpleStyle(style: TextStyle): boolean {
  return !(
    style.strokeFlag ||
    style.underline ||
    style.strikethrough ||
    style.tracking ||
    style.baselineShift ||
    style.fontCaps ||
    style.fontBaseline ||
    style.characterDirection ||
    (style.horizontalScale !== undefined && style.horizontalScale !== 1) ||
    (style.verticalScale !== undefined && style.verticalScale !== 1)
  );
}
function styleKey(style: TextStyle): string {
  return JSON.stringify({
    font: style.font?.name ?? "Arial",
    size: style.fontSize ?? 24,
    bold: !!style.fauxBold,
    italic: !!style.fauxItalic,
    color: color(style.fillColor),
    leading: style.leading ?? null,
  });
}
function textTransform(text: LayerTextData, layer: PsdLayer): Transform | null {
  const m = text.transform ?? [1, 0, 0, 1, finite(layer.left), finite(layer.top)];
  if (m.length !== 6 || !m.every(Number.isFinite)) return null;
  const [a, b, c, d, tx, ty] = m as [number, number, number, number, number, number];
  const scaleX = Math.hypot(a, b),
    scaleY = (a * d - b * c) / scaleX;
  if (scaleX < 0.001 || Math.abs(scaleY) < 0.001) return null;
  const shear = (a * c + b * d) / (scaleX * scaleY);
  return {
    x: tx,
    y: ty,
    scaleX,
    scaleY,
    rotation: (Math.atan2(b, a) * 180) / Math.PI,
    ...(Math.abs(shear) > 0.000001 ? { shear } : {}),
  };
}
function readText(layer: PsdLayer, options: ImportOptions): { layer: TextLayer; converted: boolean } {
  const t = layer.text;
  if (!t) throw new Error("INVALID_PSD");
  const style = t.style ?? t.styleRuns?.[0]?.style ?? {};
  const transform = textTransform(t, layer);
  let complex =
    !transform ||
    t.orientation === "vertical" ||
    !!t.textPath ||
    (t.warp?.style !== undefined && t.warp.style !== "none") ||
    !simpleStyle(style);
  try {
    const baseKey = styleKey(style);
    complex ||= (t.styleRuns ?? []).some(
      (run) => !simpleStyle({ ...style, ...run.style }) || styleKey({ ...style, ...run.style }) !== baseKey,
    );
  } catch {
    complex = true;
  }
  const paragraph = t.paragraphStyle ?? t.paragraphStyleRuns?.[0]?.style ?? {};
  const align = paragraph.justification ?? "left";
  complex ||=
    !["left", "center", "right"].includes(align) ||
    !!paragraph.firstLineIndent ||
    !!paragraph.startIndent ||
    !!paragraph.endIndent ||
    !!paragraph.spaceBefore ||
    !!paragraph.spaceAfter ||
    (t.paragraphStyleRuns ?? []).some((run) => (run.style.justification ?? align) !== align);
  if (complex && options.complexText !== "simplify")
    throw new PsdImportError("PSD_COMPLEX_TEXT", [
      "글자의 복잡한 서식을 단일 스타일로 바꾸면 내용을 수정할 수 있어요.",
    ]);
  const fontSize = Math.max(1, Math.min(1_000, finite(style.fontSize, 24)));
  const box = t.boxBounds;
  const width = Math.max(
    1,
    Math.ceil(box && box.length === 4 ? (box[2] ?? 0) - (box[0] ?? 0) : finite(layer.right) - finite(layer.left)),
  );
  const height = Math.max(
    1,
    Math.ceil(box && box.length === 4 ? (box[3] ?? 0) - (box[1] ?? 0) : finite(layer.bottom) - finite(layer.top)),
  );
  checkDimensions(width, height);
  const font = style.font?.name ?? "Arial";
  let fill: Color;
  try {
    fill = color(style.fillColor);
  } catch {
    fill = [0, 0, 0, 255];
  }
  const content = t.text.replace(/\r\n?/g, "\n").split(String.fromCharCode(0)).join("");
  if (content.length > 20_000) throw new Error("TEXT_LIMIT");
  const result = createTextLayer(
    {
      content,
      fontFamily: options.fontReplacements?.[font] ?? font,
      fontSize,
      color: fill,
      bold: !!style.fauxBold,
      italic: !!style.fauxItalic,
      align: ["left", "center", "right"].includes(align) ? (align as "left" | "center" | "right") : "left",
      lineHeight: Math.max(0.5, Math.min(5, finite(style.leading, fontSize * 1.25) / fontSize)),
      width,
      height,
    },
    layer.name ?? "글자",
  );
  result.transform = transform ?? { x: finite(layer.left), y: finite(layer.top), scaleX: 1, scaleY: 1, rotation: 0 };
  if (t.shapeType === "point" && transform) result.transform.y -= fontSize * result.transform.scaleY;
  return { layer: result, converted: complex };
}
function readMask(layer: PsdLayer, pixels: Raster): Uint8Array | null {
  const mask = layer.mask;
  if (!mask || mask.disabled) return null;
  const source = raster(getLayerMaskImageData(layer));
  if (!source) return null;
  const result = new Uint8Array(pixels.width * pixels.height);
  result.fill(mask.defaultColor ?? 255);
  const x = finite(mask.left) - (mask.positionRelativeToLayer ? 0 : finite(layer.left));
  const y = finite(mask.top) - (mask.positionRelativeToLayer ? 0 : finite(layer.top));
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error("INVALID_PSD");
  for (let sy = 0; sy < source.height; sy++)
    for (let sx = 0; sx < source.width; sx++) {
      const dx = sx + x,
        dy = sy + y;
      if (dx >= 0 && dy >= 0 && dx < pixels.width && dy < pixels.height)
        result[dy * pixels.width + dx] = source.data[(sy * source.width + sx) * 4] ?? 0;
    }
  return result;
}

export function decodePsd(bytes: Uint8Array, options: ImportOptions = {}): ImportedDocument {
  psdHeader(bytes);
  // ag-psd's raw composite view currently reaches the backing buffer end; constrain it to this file's byte slice.
  const input = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : Uint8Array.from(bytes);
  const psd = readPsd(input, {
    useRawData: true,
    useImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
    totalMemoryLimit: MAX_WORKING_BYTES,
    throwForMissingFeatures: true,
    logMissingFeatures: false,
  });
  const flattened: { layer: PsdLayer; visible: boolean }[] = [];
  const reasons = new Set<string>(),
    warnings: string[] = [];
  let decodingBytes = psd.width * psd.height * 4;
  const walk = (layers: PsdLayer[], parentVisible = true, depth = 0) => {
    if (depth > 16) throw new Error("LAYER_LIMIT");
    for (const layer of layers) {
      unsupported(layer).forEach((r) => reasons.add(r));
      const visible = parentVisible && !layer.hidden;
      if (layer.children) {
        if ((layer.blendMode ?? "pass through") !== "pass through" || (layer.opacity ?? 1) !== 1 || layer.mask)
          reasons.add("복잡한 그룹");
        else if (!warnings.includes("단순 그룹의 폴더 구조를 펼쳤어요."))
          warnings.push("단순 그룹의 폴더 구조를 펼쳤어요.");
        walk(layer.children, visible, depth + 1);
      } else {
        flattened.push({ layer, visible });
        if (flattened.length > MAX_LAYERS) reasons.add("레이어 16개 초과");
        const w = Math.max(1, finite(layer.right) - finite(layer.left)),
          h = Math.max(1, finite(layer.bottom) - finite(layer.top));
        try {
          checkDimensions(w, h);
        } catch {
          reasons.add("레이어 이미지 크기 한도 초과");
        }
        decodingBytes += w * h * 4;
        if (layer.mask) {
          const mw = Math.max(1, finite(layer.mask.right) - finite(layer.mask.left)),
            mh = Math.max(1, finite(layer.mask.bottom) - finite(layer.mask.top));
          try {
            checkDimensions(mw, mh);
          } catch {
            reasons.add("마스크 이미지 크기 한도 초과");
          }
          decodingBytes += mw * mh * 4 + w * h;
        }
      }
    }
  };
  walk(psd.children ?? []);
  if (!flattened.length) reasons.add("편집 가능한 레이어 없음");
  const parsedTexts = new Map<PsdLayer, { layer: TextLayer; converted: boolean }>();
  if (!reasons.size && options.unsupported !== "composite") {
    for (const { layer } of flattened)
      if (layer.text) {
        parsedTexts.set(layer, readText(layer, options));
      }
  }
  const doc = createDocument(psd.width, psd.height);
  if (reasons.size || options.unsupported === "composite") {
    if (options.unsupported !== "composite") throw new PsdImportError("PSD_UNSUPPORTED", [...reasons]);
    assertMemoryBudget(doc, psd.width * psd.height * 12 + bytes.byteLength * 2 + (options.reservedBytes ?? 0));
    validateCompositeCompression(psd);
    // A second metadata-only-layer pass preserves globalAlpha, which the raw composite helper loses.
    // This is necessary to undo PSD's white matte for a transparent composite correctly.
    const compositeRead = readPsd(input, {
      skipLayerImageData: true,
      useImageData: true,
      skipThumbnail: true,
      skipLinkedFilesData: true,
      totalMemoryLimit: MAX_WORKING_BYTES,
      throwForMissingFeatures: true,
      logMissingFeatures: false,
    });
    const composite = raster(compositeRead.imageData);
    if (!composite) throw new PsdImportError("PSD_NO_COMPOSITE", [...reasons]);
    doc.layers.push(createPixelLayer(composite, "PSD 전체 이미지"));
    return {
      document: doc,
      warnings: [...reasons, "전체 이미지로 열었어요. 기존 글자와 레이어는 개별 수정할 수 없어요."],
      fonts: [],
      flattened: true,
    };
  }
  assertMemoryBudget(doc, decodingBytes + bytes.byteLength * 2 + (options.reservedBytes ?? 0));
  const fonts = new Set<string>();
  // ag-psd children retain bottom-to-top order, the same order used by this editor.
  for (const { layer, visible } of flattened) {
    validateLayerCompression(layer);
    let next: Layer;
    if (layer.text) {
      const imported = parsedTexts.get(layer) ?? readText(layer, options);
      next = imported.layer;
      fonts.add(next.text.fontFamily);
      if (imported.converted) warnings.push("글자 서식을 단일 스타일로 바꿨어요. 배치를 확인해주세요.");
    } else {
      const pixels = raster(layer.imageData ?? getLayerImageData(layer)) ?? {
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(4),
      };
      const pixel = createPixelLayer(pixels, layer.name ?? "이미지");
      pixel.mask = readMask(layer, pixels);
      pixel.transform.x = finite(layer.left);
      pixel.transform.y = finite(layer.top);
      next = pixel;
    }
    next.visible = visible;
    next.locked = !!(layer.protected?.composite || layer.protected?.position);
    next.opacity = finite(layer.opacity, 1);
    next.blend = (layer.blendMode ?? "normal") as Layer["blend"];
    doc.layers.push(next);
  }
  validateDocument(doc);
  assertMemoryBudget(doc, decodingBytes + bytes.byteLength + (options.reservedBytes ?? 0));
  return { document: doc, warnings, fonts: [...fonts], flattened: false };
}

export interface PsdRasterizer {
  rasterizeLayer(layer: Layer, options?: { applyAdjustments?: boolean; applyMask?: boolean }): Raster;
  renderLayerTransformed(layer: Layer): { raster: Raster; left: number; top: number };
  renderDocumentPixels(document: EditorDocument): Raster;
}
/** ag-psd's composite RLE scratch is too short for one/two-pixel-wide documents; use PSD raw planar encoding there. */
function narrowComposite(output: Uint8Array, composite: Raster): Uint8Array {
  if (composite.width > 2) return Uint8Array.from(output);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let at = 26;
  for (let section = 0; section < 3; section++) {
    const length = view.getUint32(at);
    at += 4 + length;
    if (at > output.length) throw new Error("INVALID_PSD");
  }
  const channels = view.getUint16(12),
    pixels = composite.width * composite.height;
  const result = new Uint8Array(at + 2 + pixels * channels);
  result.set(output.subarray(0, at));
  // Compression=0, followed by one complete plane per channel. PSD's merged transparency uses a white matte.
  for (let c = 0; c < channels; c++)
    for (let p = 0; p < pixels; p++) {
      const value = composite.data[p * 4 + c] ?? 0,
        alpha = composite.data[p * 4 + 3] ?? 0;
      result[at + 2 + c * pixels + p] =
        c < 3 && channels === 4 && alpha !== 0 && alpha !== 255
          ? (value * alpha) / 255 + 255 * (1 - alpha / 255)
          : value;
    }
  return result;
}
function psdText(layer: TextLayer): LayerTextData {
  const d = layer.text,
    t = layer.transform,
    angle = (t.rotation * Math.PI) / 180;
  return {
    text: d.content.replace(/\n/g, "\r"),
    transform: [
      Math.cos(angle) * t.scaleX,
      Math.sin(angle) * t.scaleX,
      (Math.cos(angle) * (t.shear ?? 0) - Math.sin(angle)) * t.scaleY,
      (Math.sin(angle) * (t.shear ?? 0) + Math.cos(angle)) * t.scaleY,
      t.x,
      t.y,
    ],
    orientation: "horizontal",
    antiAlias: "smooth",
    shapeType: "box",
    boxBounds: [0, 0, d.width, d.height],
    top: 0,
    left: 0,
    bottom: d.height,
    right: d.width,
    bounds: {
      left: { units: "Pixels", value: 0 },
      top: { units: "Pixels", value: 0 },
      right: { units: "Pixels", value: d.width },
      bottom: { units: "Pixels", value: d.height },
    },
    style: {
      font: { name: d.fontFamily },
      fontSize: d.fontSize,
      fauxBold: d.bold,
      fauxItalic: d.italic,
      fillColor: { r: d.color[0], g: d.color[1], b: d.color[2], a: d.color[3] },
      autoLeading: false,
      leading: d.fontSize * d.lineHeight,
    },
    paragraphStyle: { justification: d.align },
  };
}
function exportMask(
  layer: PixelLayer,
  rendered: { raster: Raster; left: number; top: number },
  renderer: PsdRasterizer,
): PsdLayer["mask"] {
  if (!layer.mask) return undefined;
  const transformed = renderer.renderLayerTransformed(layer);
  if (
    transformed.raster.width !== rendered.raster.width ||
    transformed.raster.height !== rendered.raster.height ||
    transformed.left !== rendered.left ||
    transformed.top !== rendered.top
  )
    throw new Error("MASK_ALIGNMENT");
  const source = rendered.raster.data,
    masked = transformed.raster.data;
  const corrected = Uint8ClampedArray.from(source),
    pixels = new Uint8ClampedArray(source.length);
  for (let at = 0; at < source.length; at += 4) {
    const baseAlpha = source[at + 3] ?? 0,
      visibleAlpha = masked[at + 3] ?? 0;
    const gray = baseAlpha ? (visibleAlpha * 255) / baseAlpha : 0;
    pixels[at] = gray;
    pixels[at + 1] = gray;
    pixels[at + 2] = gray;
    pixels[at + 3] = 255;
    // Alpha and a mask cannot be interpolated independently: that would reveal pixels which were fully hidden.
    // Use the masked sample's color where visible, retaining unmasked color where fully hidden for mask restoration.
    if (visibleAlpha) {
      corrected[at] = masked[at] ?? 0;
      corrected[at + 1] = masked[at + 1] ?? 0;
      corrected[at + 2] = masked[at + 2] ?? 0;
    }
  }
  rendered.raster = { ...rendered.raster, data: corrected };
  return {
    left: transformed.left,
    top: transformed.top,
    right: transformed.left + transformed.raster.width,
    bottom: transformed.top + transformed.raster.height,
    defaultColor: 0,
    positionRelativeToLayer: false,
    imageData: { ...transformed.raster, data: pixels },
  };
}
export function encodePsd(document: EditorDocument, renderer: PsdRasterizer): Uint8Array {
  validateDocument(document);
  // Reserve a composite, per-layer transformed copies, channel/writer scratch and the output buffer first.
  assertMemoryBudget(document, psdEncodingScratch(document));
  const children: PsdLayer[] = document.layers.map((layer, index) => {
    const transformed = renderer.renderLayerTransformed(layer.kind === "pixel" ? { ...layer, mask: null } : layer);
    const result: PsdLayer = {
      id: index + 1,
      name: layer.name,
      hidden: !layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blend,
      protected: { composite: layer.locked, position: layer.locked },
      left: transformed.left,
      top: transformed.top,
      right: transformed.left + transformed.raster.width,
      bottom: transformed.top + transformed.raster.height,
      imageData: transformed.raster,
    };
    if (layer.kind === "text") result.text = psdText(layer);
    if (layer.kind === "pixel") {
      const mask = exportMask(layer, transformed, renderer);
      if (mask) result.mask = mask;
      result.imageData = transformed.raster;
    }
    return result;
  });
  const composite = renderer.renderDocumentPixels(document);
  const output = writePsdUint8Array(
    {
      width: document.width,
      height: document.height,
      bitsPerChannel: 8,
      imageData: composite,
      children,
      imageResources: {
        versionInfo: { hasRealMergedData: true, writerName: "TeacherDeck", readerName: "TeacherDeck", fileVersion: 1 },
      },
    },
    { noBackground: true, trimImageData: false, invalidateTextLayers: true, generateThumbnail: false },
  );
  const result = narrowComposite(output, composite);
  checkBytes(result.length, MAX_INPUT_BYTES);
  return result;
}
