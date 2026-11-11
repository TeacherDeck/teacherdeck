// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
export type Color = [number, number, number, number];
// These are editable document attributes, independent of the surrounding TeacherDeck UI theme.
const DEFAULT_DOCUMENT_FONT = "sans-serif";
const DEFAULT_DOCUMENT_TEXT_SIZE = 48;
const DEFAULT_DOCUMENT_LINE_HEIGHT = 1.25;
const rasterVersions = new WeakMap<ArrayBufferLike, number>();
/** In-place tile edits invalidate the persistent worker's layer cache. */
export function markRasterChanged(data: Uint8Array | Uint8ClampedArray): void {
  rasterVersions.set(data.buffer, (rasterVersions.get(data.buffer) ?? 0) + 1);
}
export function rasterVersion(data: Uint8Array | Uint8ClampedArray): number {
  return rasterVersions.get(data.buffer) ?? 0;
}
export interface Point {
  x: number;
  y: number;
}
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  shear?: number;
}
export type BlendMode = "normal" | "multiply" | "screen";
export interface Level {
  black: number;
  white: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}
export interface CurvePoint {
  x: number;
  y: number;
}
export type Channel = "rgb" | "r" | "g" | "b";
export interface Adjustments {
  brightness: number;
  contrast: number;
  levels: Record<Channel, Level>;
  curves: Record<Channel, CurvePoint[]>;
}
export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Transform;
}
export interface PixelLayer extends LayerBase {
  kind: "pixel";
  pixels: Raster;
  mask: Uint8Array | null;
  adjustments: Adjustments;
}
export interface TextDescriptor {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: Color;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  lineHeight: number;
  width: number;
  height: number;
}
export interface TextLayer extends LayerBase {
  kind: "text";
  text: TextDescriptor;
}
export interface ShapeDescriptor {
  type: "rectangle" | "arrow";
  width: number;
  height: number;
  color: Color;
  strokeWidth: number;
}
export interface ShapeLayer extends LayerBase {
  kind: "shape";
  shape: ShapeDescriptor;
}
export type Layer = PixelLayer | TextLayer | ShapeLayer;
/** Layer order is bottom to top. Selection coordinates are document pixels. */
export interface EditorDocument {
  version: 1;
  width: number;
  height: number;
  layers: Layer[];
  selection: Uint8Array | null;
  revision: number;
}
export const LIMITS = {
  maxPixels: 24000000,
  maxDimension: 10000,
  maxLayers: 16,
  maxTextLength: 20_000,
  minScale: 1 / 10_000,
  maxScale: 10_000,
  managedBytes: 256 * 1024 * 1024,
  historyBytes: 64 * 1024 * 1024,
} as const;
export class EditorError extends Error {
  readonly code: "dimensions" | "memory" | "layer" | "geometry" | "history";
  constructor(code: EditorError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "EditorError";
  }
}
export const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));
export function assertDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > LIMITS.maxDimension ||
    height > LIMITS.maxDimension ||
    width * height > LIMITS.maxPixels
  )
    throw new EditorError("dimensions", "이미지 크기가 지원 한도를 넘어요.");
}
export function identityTransform(): Transform {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
}
export function identityAdjustments(): Adjustments {
  const level = (): Level => ({ black: 0, white: 255, gamma: 1, outputBlack: 0, outputWhite: 255 });
  const curve = (): CurvePoint[] => [
    { x: 0, y: 0 },
    { x: 255, y: 255 },
  ];
  return {
    brightness: 0,
    contrast: 0,
    levels: { rgb: level(), r: level(), g: level(), b: level() },
    curves: { rgb: curve(), r: curve(), g: curve(), b: curve() },
  };
}
export function createRaster(width: number, height: number, data?: Uint8ClampedArray): Raster {
  assertDimensions(width, height);
  if (data && data.byteLength !== width * height * 4)
    throw new EditorError("dimensions", "이미지 픽셀 크기가 맞지 않아요.");
  return { width, height, data: data ?? new Uint8ClampedArray(width * height * 4) };
}
export function createDocument(width = 1200, height = 800): EditorDocument {
  assertDimensions(width, height);
  return { version: 1, width, height, layers: [], selection: null, revision: 0 };
}
function base(name: string, id?: string): LayerBase {
  return {
    id: id ?? crypto.randomUUID(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blend: "normal",
    transform: identityTransform(),
  };
}
export function createPixelLayer(pixels: Raster, name = "이미지", id?: string): PixelLayer {
  return { ...base(name, id), kind: "pixel", pixels, mask: null, adjustments: identityAdjustments() };
}
export function createTextLayer(text: Partial<TextDescriptor> = {}, name = "글자", id?: string): TextLayer {
  return {
    ...base(name, id),
    kind: "text",
    text: {
      content: "글자를 입력하세요",
      fontFamily: DEFAULT_DOCUMENT_FONT,
      fontSize: DEFAULT_DOCUMENT_TEXT_SIZE,
      color: [0, 0, 0, 255],
      bold: false,
      italic: false,
      align: "left",
      lineHeight: DEFAULT_DOCUMENT_LINE_HEIGHT,
      width: 600,
      height: 180,
      ...text,
    },
  };
}
export function createShapeLayer(shape: Partial<ShapeDescriptor> = {}, name = "도형", id?: string): ShapeLayer {
  return {
    ...base(name, id),
    kind: "shape",
    shape: { type: "rectangle", width: 300, height: 180, color: [0, 0, 0, 255], strokeWidth: 4, ...shape },
  };
}
export function layerSize(layer: Layer): {
  width: number;
  height: number;
} {
  return layer.kind === "pixel" ? layer.pixels : layer.kind === "text" ? layer.text : layer.shape;
}
export function requirePixelLayer(doc: EditorDocument, id: string): PixelLayer {
  const layer = doc.layers.find((item) => item.id === id);
  if (!layer || layer.kind !== "pixel" || layer.locked)
    throw new EditorError("layer", "잠기지 않은 이미지 레이어를 선택하세요.");
  return layer;
}
export function managedDocumentBytes(doc: EditorDocument): number {
  let bytes = 0;
  for (const layer of doc.layers) {
    bytes += (layer.name.length + layer.id.length) * 2 + 512;
    if (layer.kind === "text") bytes += (layer.text.content.length + layer.text.fontFamily.length) * 2;
    if (layer.kind === "pixel")
      bytes += Object.values(layer.adjustments.curves).reduce((sum, points) => sum + points.length * 16, 0);
  }
  for (const buffer of documentBuffers(doc)) bytes += buffer.byteLength;
  return bytes;
}
/** Views retain their entire backing buffer. Count each allocation once, including selection views. */
export function documentBuffers(doc: EditorDocument): Set<ArrayBufferLike> {
  const buffers = new Set<ArrayBufferLike>();
  if (doc.selection) buffers.add(doc.selection.buffer);
  for (const layer of doc.layers)
    if (layer.kind === "pixel") {
      buffers.add(layer.pixels.data.buffer);
      if (layer.mask) buffers.add(layer.mask.buffer);
    }
  return buffers;
}
/** Main document plus persistent worker cache and bounded preview intermediates share one budget. */
export function previewMemoryHeadroom(doc: EditorDocument, maxDimension = 1400): number {
  const scale = Math.min(1, maxDimension / Math.max(doc.width, doc.height));
  const outputPixels = Math.max(1, Math.ceil(doc.width * scale)) * Math.max(1, Math.ceil(doc.height * scale));
  const layerPixels = Math.max(
    0,
    ...doc.layers.map((layer) => {
      const size = layerSize(layer);
      return Math.max(1, Math.ceil(size.width * scale)) * Math.max(1, Math.ceil(size.height * scale));
    }),
  );
  return managedDocumentBytes(doc) + outputPixels * 8 + layerPixels * 20;
}
/** Call before decode/render allocation; transientBytes includes source, decode, compositor and output copies. */
export function assertMemoryBudget(doc: EditorDocument, transientBytes = 0, historyBytes = 0): void {
  if (
    !Number.isSafeInteger(transientBytes) ||
    transientBytes < 0 ||
    managedDocumentBytes(doc) + transientBytes + historyBytes > LIMITS.managedBytes
  )
    throw new EditorError("memory", "작업 메모리 한도를 넘어요. 이미지나 레이어 크기를 줄여주세요.");
}
export function validateDocument(doc: EditorDocument): void {
  assertDimensions(doc.width, doc.height);
  if (
    doc.version !== 1 ||
    doc.layers.length > LIMITS.maxLayers ||
    new Set(doc.layers.map((l) => l.id)).size !== doc.layers.length ||
    (doc.selection && doc.selection.length !== doc.width * doc.height)
  )
    throw new EditorError("layer", "작업 파일의 레이어 정보가 올바르지 않아요.");
  for (const layer of doc.layers) {
    const { width, height } = layerSize(layer);
    assertDimensions(width, height);
    if (
      ![layer.opacity, ...Object.values(layer.transform)].every(Number.isFinite) ||
      layer.opacity < 0 ||
      layer.opacity > 1 ||
      [layer.transform.scaleX, layer.transform.scaleY].some(
        (scale) => Math.abs(scale) < LIMITS.minScale || Math.abs(scale) > LIMITS.maxScale,
      ) ||
      Math.abs(layer.transform.shear ?? 0) > 100
    )
      throw new EditorError("geometry", "레이어 위치와 크기를 확인해주세요.");
    if (
      layer.kind === "pixel" &&
      (layer.pixels.data.length !== width * height * 4 || (layer.mask && layer.mask.length !== width * height))
    )
      throw new EditorError("dimensions", "레이어 픽셀 크기가 맞지 않아요.");
    if (
      layer.kind === "text" &&
      (!Number.isFinite(layer.text.fontSize) ||
        layer.text.fontSize < 1 ||
        layer.text.fontSize > 2048 ||
        !Number.isFinite(layer.text.lineHeight) ||
        layer.text.lineHeight < 0.5 ||
        layer.text.lineHeight > 10 ||
        layer.text.content.length > LIMITS.maxTextLength)
    )
      throw new EditorError("layer", "글자 크기와 줄 간격을 확인해주세요.");
    if (
      layer.kind === "shape" &&
      (!Number.isFinite(layer.shape.strokeWidth) || layer.shape.strokeWidth < 1 || layer.shape.strokeWidth > 2048)
    )
      throw new EditorError("layer", "도형 선 두께를 확인해주세요.");
  }
  assertMemoryBudget(doc);
}
/** Descriptors are copied; untouched pixel buffers are shared until an explicit pixel transaction. */
export function cloneDocumentMetadata(doc: EditorDocument): EditorDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.kind === "pixel"
        ? {
            ...layer,
            transform: { ...layer.transform },
            pixels: { ...layer.pixels },
            adjustments: structuredClone(layer.adjustments),
          }
        : layer.kind === "text"
          ? { ...layer, transform: { ...layer.transform }, text: structuredClone(layer.text) }
          : { ...layer, transform: { ...layer.transform }, shape: structuredClone(layer.shape) },
    ),
  };
}
export function addLayer(doc: EditorDocument, layer: Layer): void {
  if (doc.layers.length >= LIMITS.maxLayers) throw new EditorError("layer", "레이어는 최대 16개까지 만들 수 있어요.");
  doc.layers.push(layer);
  validateDocument(doc);
}
export function duplicateLayer(doc: EditorDocument, id: string): Layer {
  const index = doc.layers.findIndex((l) => l.id === id);
  if (index < 0) throw new EditorError("layer", "레이어를 선택하세요.");
  const source = defined(doc.layers[index]);
  const bytes = source.kind === "pixel" ? source.pixels.data.byteLength + (source.mask?.byteLength ?? 0) : 0;
  assertMemoryBudget(doc, bytes);
  const layer = structuredClone(source);
  layer.id = crypto.randomUUID();
  layer.name += " 복사";
  if (doc.layers.length >= LIMITS.maxLayers) throw new EditorError("layer", "레이어는 최대 16개까지 만들 수 있어요.");
  doc.layers.splice(index + 1, 0, layer);
  return layer;
}
