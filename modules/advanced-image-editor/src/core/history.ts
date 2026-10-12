// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
import {
  assertMemoryBudget,
  cloneDocumentMetadata,
  documentBuffers,
  EditorError,
  LIMITS,
  markRasterChanged,
  managedDocumentBytes,
  previewMemoryHeadroom,
  requirePixelLayer,
  validateDocument,
} from "./model.ts";
import type { Color, EditorDocument, PixelLayer, Point } from "./model.ts";
import { documentToLocal } from "./geometry.ts";
import { getChangedTiles, HISTORY_TILE_SIZE } from "./klecks-tiles.ts";
export interface BrushOptions {
  size: number;
  hardness: number;
  opacity: number;
  color: Color;
  mode: "paint" | "erase" | "mask-hide" | "mask-restore";
}
interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
  before: Uint8ClampedArray | Uint8Array;
  after?: Uint8ClampedArray | Uint8Array;
}
interface StateEntry {
  type: "state";
  label: string;
  before: EditorDocument;
  after: EditorDocument;
  bytes: number;
}
interface PixelEntry {
  type: "pixels";
  label: string;
  layerId: string;
  target: "pixels" | "mask";
  tiles: Tile[];
  maskCreated: boolean;
  beforeRevision: number;
  afterRevision: number;
  bytes: number;
}
type Entry = StateEntry | PixelEntry;
function entryBytes(before: EditorDocument, after: EditorDocument): number {
  const metadataBytes = (doc: EditorDocument): number =>
    new TextEncoder().encode(
      JSON.stringify({
        width: doc.width,
        height: doc.height,
        layers: doc.layers.map((layer) =>
          layer.kind === "pixel"
            ? {
                ...layer,
                pixels: { width: layer.pixels.width, height: layer.pixels.height },
                mask: Boolean(layer.mask),
              }
            : layer,
        ),
      }),
    ).byteLength;
  const bytes = 2048 + metadataBytes(before) + metadataBytes(after);
  let beforeRetained = 0,
    afterRetained = 0;
  const beforeBuffers = documentBuffers(before),
    afterBuffers = documentBuffers(after);
  for (const buffer of beforeBuffers) if (!afterBuffers.has(buffer)) beforeRetained += buffer.byteLength;
  for (const buffer of afterBuffers) if (!beforeBuffers.has(buffer)) afterRetained += buffer.byteLength;
  // Current document owns one side of each structural transition. Reserve the larger extra side
  // across undo/redo, rather than counting that active plane twice. Tile entries copy both sides.
  return bytes + Math.max(beforeRetained, afterRetained);
}
/** A single history for properties and pixel/mask tiles. Large mutations replace buffers in the draft. */
export class EditorHistory {
  private entries: Entry[] = [];
  private index = 0;
  private revision = 0;
  readonly limit: number;
  constructor(limit: number = LIMITS.historyBytes) {
    this.limit = limit;
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length;
  }
  get memoryBytes(): number {
    return this.entries.reduce((sum, e) => sum + e.bytes, 0);
  }
  clear(): void {
    this.entries = [];
    this.index = 0;
  }
  reserve(doc: EditorDocument, bytes: number, transient = 0): void {
    if (bytes > this.limit)
      throw new EditorError("history", "이 작업을 안전하게 되돌릴 메모리가 부족해요. 영역이나 크기를 줄여주세요.");
    const transientHeadroom = previewMemoryHeadroom(doc) + transient;
    while (
      this.entries.length &&
      (this.memoryBytes + bytes > this.limit ||
        managedDocumentBytes(doc) + transientHeadroom + this.memoryBytes + bytes > LIMITS.managedBytes)
    ) {
      if (this.index > 0) {
        this.entries.shift();
        this.index--;
      } else {
        // At the undo baseline, removing the earliest redo would disconnect the state chain.
        // Trim the farthest future step instead, preserving both ownership accounting and redo order.
        this.entries.pop();
      }
    }
    assertMemoryBudget(doc, transientHeadroom + bytes, this.memoryBytes);
  }
  private push(entry: Entry): void {
    this.entries.splice(this.index);
    this.entries.push(entry);
    this.index = this.entries.length;
  }
  nextRevision(doc: EditorDocument): number {
    this.revision = Math.max(this.revision, doc.revision) + 1;
    return this.revision;
  }
  perform(doc: EditorDocument, label: string, mutator: (draft: EditorDocument) => void): EditorDocument {
    const before = cloneDocumentMetadata(doc),
      after = cloneDocumentMetadata(doc);
    mutator(after);
    validateDocument(after);
    const bytes = entryBytes(before, after);
    this.reserve(after, bytes);
    after.revision = this.nextRevision(doc);
    this.push({ type: "state", label, before, after: cloneDocumentMetadata(after), bytes });
    return after;
  }
  beginStroke(doc: EditorDocument, layerId: string, options: BrushOptions): StrokeTransaction {
    return new StrokeTransaction(this, doc, layerId, options);
  }
  commitStroke(entry: PixelEntry): void {
    this.push(entry);
  }
  undo(doc: EditorDocument): EditorDocument {
    if (!this.canUndo) return doc;
    const entry = defined(this.entries[--this.index]);
    if (entry.type === "state") return cloneDocumentMetadata(entry.before);
    return restoreTiles(doc, entry, false);
  }
  redo(doc: EditorDocument): EditorDocument {
    if (!this.canRedo) return doc;
    const entry = defined(this.entries[this.index++]);
    if (entry.type === "state") return cloneDocumentMetadata(entry.after);
    return restoreTiles(doc, entry, true);
  }
}
function writeTile(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  channels: number,
  tile: Tile,
  values: Uint8Array | Uint8ClampedArray,
): void {
  for (let y = 0; y < tile.height; y++)
    data.set(
      values.subarray(y * tile.width * channels, (y + 1) * tile.width * channels),
      ((tile.y + y) * width + tile.x) * channels,
    );
}
function readTile(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  channels: number,
  tile: Omit<Tile, "before">,
): Uint8Array | Uint8ClampedArray {
  const result =
    data instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(tile.width * tile.height * channels)
      : new Uint8Array(tile.width * tile.height * channels);
  for (let y = 0; y < tile.height; y++)
    result.set(
      data.subarray(
        ((tile.y + y) * width + tile.x) * channels,
        ((tile.y + y) * width + tile.x + tile.width) * channels,
      ),
      y * tile.width * channels,
    );
  return result;
}
function restoreTiles(doc: EditorDocument, entry: PixelEntry, forward: boolean): EditorDocument {
  const next = cloneDocumentMetadata(doc),
    layer = requirePixelLayer(
      { ...next, layers: next.layers.map((l) => (l.id === entry.layerId ? { ...l, locked: false } : l)) },
      entry.layerId,
    );
  const actual = next.layers.find((l) => l.id === entry.layerId);
  if (!actual || actual.kind !== "pixel") throw new EditorError("history", "실행 취소할 레이어를 찾을 수 없어요.");
  if (entry.target === "mask" && !actual.mask)
    actual.mask = new Uint8Array(layer.pixels.width * layer.pixels.height).fill(255);
  const data = entry.target === "pixels" ? actual.pixels.data : defined(actual.mask);
  for (const tile of entry.tiles)
    writeTile(
      data,
      actual.pixels.width,
      entry.target === "pixels" ? 4 : 1,
      tile,
      forward ? defined(tile.after) : tile.before,
    );
  markRasterChanged(data);
  if (!forward && entry.maskCreated) actual.mask = null;
  next.revision = forward ? entry.afterRevision : entry.beforeRevision;
  return next;
}
interface StampPlan {
  point: Point;
  p: Point;
  a: number;
  b: number;
  c: number;
  d: number;
  rx: number;
  ry: number;
  radius: number;
  radiusSquared: number;
  hard: number;
  hardSquared: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export class StrokeTransaction {
  private readonly history: EditorHistory;
  private readonly doc: EditorDocument;
  private readonly layer: PixelLayer;
  private readonly options: BrushOptions;
  private readonly beforeRevision: number;
  private readonly maskCreated: boolean;
  private tiles = new Map<number, Tile>();
  private previous: Point | null = null;
  private finished = false;
  private asyncTail: Promise<void> = Promise.resolve();
  private batches = { count: 0, maximumMs: 0, processingMs: 0 };
  get metrics(): { count: number; maximumMs: number; processingMs: number } {
    return { ...this.batches };
  }
  private reserved = 0;
  constructor(history: EditorHistory, doc: EditorDocument, id: string, options: BrushOptions) {
    this.history = history;
    this.doc = doc;
    this.layer = requirePixelLayer(doc, id);
    if (
      ![options.size, options.hardness, options.opacity, ...options.color].every(Number.isFinite) ||
      options.color.some((value) => value < 0 || value > 255) ||
      options.size < 1 ||
      options.size > 2048 ||
      options.hardness < 0 ||
      options.hardness > 1 ||
      options.opacity < 0 ||
      options.opacity > 1
    )
      throw new EditorError("layer", "브러시 크기·경도·불투명도를 확인해주세요.");
    this.options = { ...options, color: [...options.color] };
    this.beforeRevision = doc.revision;
    this.maskCreated = (options.mode === "mask-hide" || options.mode === "mask-restore") && !this.layer.mask;
    if (this.maskCreated) {
      history.reserve(doc, 0, this.layer.pixels.width * this.layer.pixels.height);
      this.layer.mask = new Uint8Array(this.layer.pixels.width * this.layer.pixels.height).fill(255);
    }
  }
  private capture(x: number, y: number, radius: number, radiusY = radius): void {
    const { width, height } = this.layer.pixels,
      channels = this.options.mode.startsWith("mask") ? 1 : 4,
      data = channels === 4 ? this.layer.pixels.data : defined(this.layer.mask);
    const changed = getChangedTiles(
        {
          x1: Math.floor(x - radius),
          y1: Math.floor(y - radiusY),
          x2: Math.ceil(x + radius),
          y2: Math.ceil(y + radiusY),
        },
        width,
        height,
      ),
      tilesX = Math.ceil(width / HISTORY_TILE_SIZE);
    const pending: Omit<Tile, "before">[] = [];
    let added = 0;
    changed.forEach((value, index) => {
      if (value && !this.tiles.has(index)) {
        const tx = (index % tilesX) * HISTORY_TILE_SIZE,
          ty = Math.floor(index / tilesX) * HISTORY_TILE_SIZE;
        const tile = {
          x: tx,
          y: ty,
          width: Math.min(HISTORY_TILE_SIZE, width - tx),
          height: Math.min(HISTORY_TILE_SIZE, height - ty),
        };
        pending.push(tile);
        added += tile.width * tile.height * channels * 2;
      }
    });
    if (pending.length === 0) return;
    this.history.reserve(this.doc, this.reserved + added);
    this.reserved += added;
    for (const tile of pending) {
      const index = Math.floor(tile.y / HISTORY_TILE_SIZE) * tilesX + Math.floor(tile.x / HISTORY_TILE_SIZE);
      this.tiles.set(index, { ...tile, before: readTile(data, width, channels, tile) });
    }
  }
  private stampPlan(point: Point): StampPlan {
    const p = documentToLocal(point, this.layer.transform),
      radius = this.options.size / 2,
      t = this.layer.transform,
      angle = (t.rotation * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      shear = t.shear ?? 0;
    const a = cos * t.scaleX,
      b = sin * t.scaleX,
      c = (cos * shear - sin) * t.scaleY,
      d = (sin * shear + cos) * t.scaleY,
      determinant = a * d - b * c;
    const rx = radius * Math.hypot(d / determinant, c / determinant),
      ry = radius * Math.hypot(b / determinant, a / determinant);
    const { width, height } = this.layer.pixels;
    return {
      point,
      p,
      a,
      b,
      c,
      d,
      rx,
      ry,
      radiusSquared: radius * radius,
      hard: this.options.hardness * radius,
      hardSquared: (this.options.hardness * radius) ** 2,
      radius,
      left: Math.max(0, Math.floor(p.x - rx)),
      right: Math.min(width, Math.ceil(p.x + rx)),
      top: Math.max(0, Math.floor(p.y - ry)),
      bottom: Math.min(height, Math.ceil(p.y + ry)),
    };
  }
  private paintRow(plan: StampPlan, y: number): void {
    const { width } = this.layer.pixels,
      { a, b, c, d, p, point } = plan,
      vy = y + 0.5 - p.y,
      options = this.options;
    for (let x = plan.left; x < plan.right; x++) {
      const vx = x + 0.5 - p.x,
        dxLocal = a * vx + c * vy,
        dyLocal = b * vx + d * vy,
        distanceSquared = dxLocal * dxLocal + dyLocal * dyLocal;
      if (distanceSquared > plan.radiusSquared) continue;
      let amount =
        options.opacity *
        (distanceSquared <= plan.hardSquared
          ? 1
          : (plan.radius - Math.sqrt(distanceSquared)) / Math.max(0.001, plan.radius - plan.hard));
      if (this.doc.selection) {
        const dx = Math.floor(point.x + dxLocal),
          dy = Math.floor(point.y + dyLocal);
        amount *=
          dx >= 0 && dy >= 0 && dx < this.doc.width && dy < this.doc.height
            ? (this.doc.selection[dy * this.doc.width + dx] ?? 0) / 255
            : 0;
      }
      if (amount === 0) continue;
      const index = y * width + x;
      if (options.mode.startsWith("mask")) {
        const mask = defined(this.layer.mask);
        mask[index] =
          options.mode === "mask-hide"
            ? (mask[index] ?? 0) * (1 - amount)
            : (mask[index] ?? 0) + (255 - (mask[index] ?? 0)) * amount;
        continue;
      }
      const i = index * 4,
        data = this.layer.pixels.data;
      if (options.mode === "erase") {
        data[i + 3] = (data[i + 3] ?? 0) * (1 - amount);
        continue;
      }
      const sourceAlpha = (amount * options.color[3]) / 255,
        destinationAlpha = (data[i + 3] ?? 0) / 255;
      if (sourceAlpha === 0) continue;
      if (destinationAlpha === 0 || sourceAlpha === 1) {
        data[i] = options.color[0];
        data[i + 1] = options.color[1];
        data[i + 2] = options.color[2];
        data[i + 3] = sourceAlpha * 255;
        continue;
      }
      const alpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel++)
        data[i + channel] =
          ((options.color[channel] ?? 0) * sourceAlpha +
            (data[i + channel] ?? 0) * destinationAlpha * (1 - sourceAlpha)) /
          alpha;
      data[i + 3] = alpha * 255;
    }
  }
  private stamp(point: Point): void {
    const plan = this.stampPlan(point);
    this.capture(plan.p.x, plan.p.y, plan.rx, plan.ry);
    for (let y = plan.top; y < plan.bottom; y++) this.paintRow(plan, y);
  }
  private steps(point: Point): number {
    return this.previous
      ? Math.max(
          1,
          Math.ceil(
            Math.hypot(point.x - this.previous.x, point.y - this.previous.y) / Math.max(0.5, this.options.size * 0.15),
          ),
        )
      : 1;
  }
  private interpolatedPoint(point: Point, n: number, steps: number): Point {
    return this.previous
      ? {
          x: this.previous.x + ((point.x - this.previous.x) * n) / steps,
          y: this.previous.y + ((point.y - this.previous.y) * n) / steps,
        }
      : point;
  }
  private changed(): void {
    markRasterChanged(this.options.mode.startsWith("mask") ? defined(this.layer.mask) : this.layer.pixels.data);
  }
  addPoint(point: Point): void {
    if (this.finished) throw new EditorError("history", "브러시 작업이 이미 끝났어요.");
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    const steps = this.steps(point),
      plan = this.stampPlan(point);
    // Large brush stamps and long segments use the bounded asynchronous path below.
    try {
      if (Math.max(0, plan.right - plan.left) * Math.max(0, plan.bottom - plan.top) * steps > 80_000)
        throw new EditorError("layer", "큰 브러시와 긴 획은 나누어 처리해야 해요.");
      for (let n = 1; n <= steps; n++) this.stamp(this.interpolatedPoint(point, n, steps));
      this.previous = { ...point };
      this.changed();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  private recordBatch(start: number): void {
    const elapsed = performance.now() - start;
    this.batches.count++;
    this.batches.maximumMs = Math.max(this.batches.maximumMs, elapsed);
    this.batches.processingMs += elapsed;
  }
  private async applyPointAsync(point: Point): Promise<void> {
    if (this.finished) throw new DOMException("브러시 작업을 취소했어요.", "AbortError");
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    let batchStart = performance.now();
    try {
      const steps = this.steps(point);
      for (let n = 1; n <= steps; n++) {
        const plan = this.stampPlan(this.interpolatedPoint(point, n, steps));
        this.capture(plan.p.x, plan.p.y, plan.rx, plan.ry);
        for (let y = plan.top; y < plan.bottom; y++) {
          if (this.finished) throw new DOMException("브러시 작업을 취소했어요.", "AbortError");
          this.paintRow(plan, y);
          if (performance.now() - batchStart >= 5) {
            this.recordBatch(batchStart);
            this.changed();
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            if (this.finished) throw new DOMException("브러시 작업을 취소했어요.", "AbortError");
            batchStart = performance.now();
          }
        }
      }
      this.previous = { ...point };
      this.changed();
      this.recordBatch(batchStart);
      // End each input in a new macrotask, so a queued sequence of small strokes cannot starve input.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.finished) throw new DOMException("브러시 작업을 취소했어요.", "AbortError");
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  /** Serial, cancellable batches target 5ms each; root keeps one stroke history and instant visual feedback. */
  addPointAsync(point: Point): Promise<void> {
    const next = this.asyncTail.then(() => this.applyPointAsync(point));
    this.asyncTail = next.catch(() => undefined);
    return next;
  }
  commit(): EditorDocument {
    if (this.finished) return this.doc;
    this.finished = true;
    const channels = this.options.mode.startsWith("mask") ? 1 : 4,
      data = channels === 4 ? this.layer.pixels.data : defined(this.layer.mask);
    const tiles = [...this.tiles.values()];
    if (tiles.length === 0) {
      if (this.maskCreated) this.layer.mask = null;
      return this.doc;
    }
    for (const tile of tiles) tile.after = readTile(data, this.layer.pixels.width, channels, tile);
    const afterRevision = this.history.nextRevision(this.doc);
    this.history.commitStroke({
      type: "pixels",
      label: this.options.mode === "paint" ? "브러시" : "지우개·마스크",
      layerId: this.layer.id,
      target: channels === 4 ? "pixels" : "mask",
      tiles,
      maskCreated: this.maskCreated,
      beforeRevision: this.beforeRevision,
      afterRevision,
      bytes: this.reserved,
    });
    this.doc.revision = afterRevision;
    return { ...this.doc };
  }
  cancel(): EditorDocument {
    if (this.finished) return this.doc;
    this.finished = true;
    const channels = this.options.mode.startsWith("mask") ? 1 : 4,
      data = channels === 4 ? this.layer.pixels.data : defined(this.layer.mask);
    for (const tile of this.tiles.values()) writeTile(data, this.layer.pixels.width, channels, tile, tile.before);
    markRasterChanged(data);
    if (this.maskCreated) this.layer.mask = null;
    return { ...this.doc };
  }
}
