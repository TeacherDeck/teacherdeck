// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import {
  assertMemoryBudget,
  EditorError,
  layerSize,
  LIMITS,
  managedDocumentBytes,
  previewMemoryHeadroom,
  rasterVersion,
} from "./model.ts";
import type { EditorDocument, Point } from "./model.ts";
export interface PreviewOptions {
  maxDimension?: number;
  compareOriginal?: boolean;
  historyBytes?: number;
}
export type EditorOperation =
  | {
      kind: "perspective";
      doc: EditorDocument;
      id: string;
      corners: [Point, Point, Point, Point];
      width: number;
      height: number;
    }
  | { kind: "select-color"; doc: EditorDocument; id: string; point: Point; tolerance: number; contiguous: boolean }
  | { kind: "polygon"; width: number; height: number; points: Point[] }
  | { kind: "feather"; doc: EditorDocument; id: string; radius: number }
  | { kind: "merge"; doc: EditorDocument; id: string }
  | { kind: "mask"; doc: EditorDocument; id: string; operation: "hide" | "restore" }
  | { kind: "rasterize"; doc: EditorDocument; id: string };
export type OperationResult = { kind: "document"; doc: EditorDocument } | { kind: "selection"; selection: Uint8Array };
export type WorkerRequest =
  | { id: number; kind: "preview"; doc: EditorDocument; options: PreviewOptions }
  | { id: number; kind: "operation"; task: EditorOperation };
export type WorkerResponse =
  | { id: number; ok: true; bitmap: ImageBitmap }
  | { id: number; ok: true; result: OperationResult }
  | { id: number; ok: false; message: string; code?: EditorError["code"] };
interface PendingPreview {
  doc: EditorDocument;
  options: PreviewOptions;
  resolve: (bitmap: ImageBitmap) => void;
  reject: (error: unknown) => void;
}
/** One persistent worker, one in-flight render, one replaceable pending preview. */
export class PreviewRenderer {
  private worker: Worker | null = null;
  private active: PendingPreview | null = null;
  private pending: PendingPreview | null = null;
  private serial = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cachedLayers = new Map<
    string,
    { pixels: Uint8ClampedArray; pixelVersion: number; mask: Uint8Array | null; maskVersion: number }
  >();
  render(doc: EditorDocument, options: PreviewOptions = {}): Promise<ImageBitmap> {
    if (this.disposed) return Promise.reject(new DOMException("미리보기 작업이 끝났어요.", "AbortError"));
    return new Promise((resolve, reject) => {
      const next = { doc, options, resolve, reject };
      if (this.active) {
        this.pending?.reject(new DOMException("최신 미리보기로 바뀌었어요.", "AbortError"));
        this.pending = next;
      } else this.start(next);
    });
  }
  private start(next: PendingPreview): void {
    try {
      assertMemoryBudget(
        next.doc,
        previewMemoryHeadroom(next.doc, next.options.maxDimension ?? 1400),
        next.options.historyBytes ?? 0,
      );
      if (!this.worker) {
        this.worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
        this.worker.onerror = () => this.fail(new Error("미리보기를 그릴 수 없어요."));
      }
      this.active = next;
      this.timer = setTimeout(
        () => this.fail(new Error("미리보기 시간이 길어졌어요. 작업 크기를 줄여주세요.")),
        30_000,
      );
      const layers = next.doc.layers.map((layer) => {
        if (layer.kind !== "pixel") return layer;
        const cached = this.cachedLayers.get(layer.id),
          pixelVersion = rasterVersion(layer.pixels.data),
          maskVersion = layer.mask ? rasterVersion(layer.mask) : 0;
        const pixelsUnchanged = cached?.pixels === layer.pixels.data && cached.pixelVersion === pixelVersion;
        const maskUnchanged = cached?.mask === layer.mask && cached.maskVersion === maskVersion;
        this.cachedLayers.set(layer.id, { pixels: layer.pixels.data, pixelVersion, mask: layer.mask, maskVersion });
        return {
          ...layer,
          pixels: { ...layer.pixels, data: pixelsUnchanged ? new Uint8ClampedArray(0) : layer.pixels.data },
          mask: layer.mask && maskUnchanged ? new Uint8Array(0) : layer.mask,
        };
      });
      const layerIds = new Set(next.doc.layers.map((layer) => layer.id));
      for (const id of this.cachedLayers.keys()) if (!layerIds.has(id)) this.cachedLayers.delete(id);
      this.worker.postMessage({
        id: ++this.serial,
        kind: "preview",
        doc: { ...next.doc, layers, selection: null },
        options: next.options,
      } satisfies WorkerRequest);
    } catch (error) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.worker?.terminate();
      this.worker = null;
      this.cachedLayers.clear();
      next.reject(error);
      this.active = null;
      this.pump();
    }
  }
  private receive(response: WorkerResponse): void {
    const active = this.active;
    if (!active || response.id !== this.serial) {
      if (response.ok && "bitmap" in response) response.bitmap.close();
      return;
    }
    this.active = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (response.ok && "bitmap" in response) active.resolve(response.bitmap);
    else {
      active.reject(
        new EditorError(
          response.ok ? "layer" : (response.code ?? "layer"),
          response.ok ? "미리보기 결과를 확인할 수 없어요." : response.message,
        ),
      );
      this.worker?.terminate();
      this.worker = null;
      this.cachedLayers.clear();
    }
    this.pump();
  }
  private pump(): void {
    if (this.pending && !this.disposed) {
      const next = this.pending;
      this.pending = null;
      this.start(next);
    }
  }
  private fail(error: Error): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active?.reject(error);
    this.pending?.reject(error);
    this.active = null;
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.cachedLayers.clear();
  }
  dispose(): void {
    this.disposed = true;
    this.fail(new DOMException("미리보기 작업이 끝났어요.", "AbortError"));
  }
}
/** A cancellable heavy operation gets its own worker, so AbortSignal immediately releases the CPU task. */
export function runEditorOperation(
  task: EditorOperation,
  signal?: AbortSignal,
  historyBytes = 0,
): Promise<OperationResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("작업을 취소했어요.", "AbortError"));
      return;
    }
    if ("doc" in task) {
      try {
        const layer = "id" in task ? task.doc.layers.find((item) => item.id === task.id) : undefined;
        const size = layer ? layerSize(layer) : { width: 0, height: 0 };
        const outputPixels = task.kind === "perspective" ? task.width * task.height : 0;
        const retained = (item: import("./model.ts").Layer | undefined): number =>
          item?.kind === "pixel" ? item.pixels.data.byteLength + (item.mask?.byteLength ?? 0) : 0;
        const index = "id" in task ? task.doc.layers.findIndex((item) => item.id === task.id) : -1;
        const extraRetained =
          task.kind === "perspective"
            ? Math.max(retained(layer), outputPixels * (layer?.kind === "pixel" && layer.mask ? 5 : 4))
            : task.kind === "merge"
              ? Math.max(retained(layer) + retained(task.doc.layers[index - 1]), task.doc.width * task.doc.height * 4)
              : task.kind === "mask" || task.kind === "feather"
                ? size.width * size.height
                : task.kind === "rasterize" && layer?.kind !== "pixel"
                  ? size.width * size.height * 4
                  : 0;
        if (extraRetained > LIMITS.historyBytes)
          throw new EditorError("history", "이 작업을 안전하게 되돌릴 메모리가 부족해요. 영역이나 크기를 줄여주세요.");
        const allocation =
          task.kind === "perspective"
            ? outputPixels * (layer?.kind === "pixel" && layer.mask ? 9 : 4) +
              (layer?.kind === "pixel" && layer.mask ? size.width * size.height * 4 : 0)
            : task.kind === "select-color"
              ? task.doc.width * task.doc.height + size.width * size.height * 13
              : task.kind === "merge"
                ? task.doc.width * task.doc.height * 12
                : task.kind === "feather"
                  ? size.width * size.height * 2
                  : task.kind === "mask"
                    ? size.width * size.height
                    : size.width * size.height * 8;
        assertMemoryBudget(task.doc, managedDocumentBytes(task.doc) + allocation, historyBytes);
      } catch (error) {
        reject(error);
        return;
      }
    }
    const worker = new Worker(new URL("./preview.worker.ts", import.meta.url), { type: "module" });
    const sourcePlanes = new Map<
      string,
      { pixels: Uint8ClampedArray; pixelVersion: number; mask: Uint8Array | null; maskVersion: number }
    >();
    if ("doc" in task)
      for (const layer of task.doc.layers)
        if (layer.kind === "pixel")
          sourcePlanes.set(layer.id, {
            pixels: layer.pixels.data,
            pixelVersion: rasterVersion(layer.pixels.data),
            mask: layer.mask,
            maskVersion: layer.mask ? rasterVersion(layer.mask) : 0,
          });
    const sourceSelection = "doc" in task ? task.doc.selection : null;
    const timer = setTimeout(() => {
      finish();
      reject(new Error("이미지 작업 시간이 길어졌어요. 작업 크기를 줄여주세요."));
    }, 90_000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      finish();
      reject(new DOMException("작업을 취소했어요.", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      finish();
      const message = event.data;
      if (message.ok && "result" in message) {
        try {
          for (const source of sourcePlanes.values())
            if (
              rasterVersion(source.pixels) !== source.pixelVersion ||
              (source.mask && rasterVersion(source.mask) !== source.maskVersion)
            )
              throw new DOMException("다른 편집이 생겨 작업을 취소했어요.", "AbortError");
          if (message.result.kind === "document") {
            const document = message.result.doc;
            for (const layer of document.layers)
              if (layer.kind === "pixel") {
                const source = sourcePlanes.get(layer.id);
                if (layer.pixels.data.length === 0) {
                  if (
                    !source ||
                    source.pixels.length !== layer.pixels.width * layer.pixels.height * 4 ||
                    rasterVersion(source.pixels) !== source.pixelVersion
                  )
                    throw new DOMException("다른 편집이 생겨 작업을 취소했어요.", "AbortError");
                  layer.pixels.data = source.pixels;
                }
                if (layer.mask && layer.mask.length === 0) {
                  if (
                    !source?.mask ||
                    source.mask.length !== layer.pixels.width * layer.pixels.height ||
                    rasterVersion(source.mask) !== source.maskVersion
                  )
                    throw new DOMException("다른 편집이 생겨 작업을 취소했어요.", "AbortError");
                  layer.mask = source.mask;
                }
              }
            if (document.selection && document.selection.length === 0) {
              if (!sourceSelection || sourceSelection.length !== document.width * document.height)
                throw new Error("선택 영역 크기를 확인해주세요.");
              document.selection = sourceSelection;
            }
          }
          resolve(message.result);
        } catch (error) {
          reject(error);
        }
      } else
        reject(
          new EditorError(
            message.ok ? "layer" : (message.code ?? "layer"),
            message.ok ? "작업 결과를 확인할 수 없어요." : message.message,
          ),
        );
    };
    worker.onerror = () => {
      finish();
      reject(new Error("이미지 작업을 완료할 수 없어요."));
    };
    worker.postMessage({ id: 1, kind: "operation", task } satisfies WorkerRequest);
  });
}
