// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneDocumentMetadata, createDocument, createPixelLayer, createRaster, markRasterChanged } from "./model.ts";
import { EditorHistory } from "./history.ts";
import { PreviewRenderer, runEditorOperation } from "./preview.ts";
import type { WorkerRequest, WorkerResponse } from "./preview.ts";
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  respond() {
    const request = this.requests.at(-1);
    if (!request) throw Error("합성 요청이 없어요.");
    this.onmessage?.({
      data: { id: request.id, ok: true, bitmap: { close: vi.fn() } as unknown as ImageBitmap },
    } as MessageEvent<WorkerResponse>);
  }
  respondResult(result: import("./preview.ts").OperationResult) {
    const request = this.requests.at(-1);
    if (!request) throw Error();
    this.onmessage?.({ data: { id: request.id, ok: true, result } } as MessageEvent<WorkerResponse>);
  }
}
function documentFixture() {
  const doc = createDocument(8, 8);
  doc.layers.push(createPixelLayer(createRaster(8, 8), "합성 레이어", "synthetic"));
  return doc;
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("이미지 Worker 수명과 미리보기 캐시", () => {
  it("동시에 한 프레임만 보내고 대기 중에는 최신 요청만 남겨요", async () => {
    const renderer = new PreviewRenderer(),
      doc = documentFixture();
    const first = renderer.render(doc);
    const second = renderer.render(doc);
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    const third = renderer.render(doc);
    const worker = FakeWorker.instances[0];
    if (!worker) throw Error();
    expect(worker.requests).toHaveLength(1);
    await rejected;
    worker.respond();
    await first;
    expect(worker.requests).toHaveLength(2);
    worker.respond();
    await third;
    renderer.dispose();
    expect(worker.terminated).toBe(true);
  });
  it("속성 변경은 원본 픽셀을 다시 복제하지 않고 획과 undo는 캐시를 갱신해요", async () => {
    const renderer = new PreviewRenderer();
    let doc = documentFixture();
    const first = renderer.render(doc);
    const worker = FakeWorker.instances[0];
    if (!worker) throw Error();
    worker.respond();
    await first;
    const layer = doc.layers[0];
    if (!layer || layer.kind !== "pixel") throw Error();
    layer.opacity = 0.5;
    const second = renderer.render(doc);
    const propertyRequest = worker.requests.at(-1);
    if (propertyRequest?.kind !== "preview") throw Error();
    const cached = propertyRequest.doc.layers[0];
    if (cached?.kind !== "pixel") throw Error();
    expect(cached.pixels.data).toHaveLength(0);
    worker.respond();
    await second;
    const history = new EditorHistory(),
      stroke = history.beginStroke(doc, "synthetic", {
        size: 2,
        hardness: 1,
        opacity: 1,
        color: [0, 0, 0, 255],
        mode: "paint",
      });
    stroke.addPoint({ x: 3, y: 3 });
    doc = stroke.commit();
    const third = renderer.render(doc);
    const brushRequest = worker.requests.at(-1);
    if (brushRequest?.kind !== "preview") throw Error();
    const changed = brushRequest.doc.layers[0];
    if (changed?.kind !== "pixel") throw Error();
    expect(changed.pixels.data).toHaveLength(256);
    worker.respond();
    await third;
    doc = history.undo(doc);
    const fourth = renderer.render(doc);
    const undoRequest = worker.requests.at(-1);
    if (undoRequest?.kind !== "preview") throw Error();
    const undone = undoRequest.doc.layers[0];
    if (undone?.kind !== "pixel") throw Error();
    expect(undone.pixels.data).toHaveLength(256);
    worker.respond();
    await fourth;
    renderer.dispose();
  });
  it("긴 연산은 취소하면 Worker를 즉시 종료해요", async () => {
    const abort = new AbortController();
    const operation = runEditorOperation(
      {
        kind: "polygon",
        width: 8,
        height: 8,
        points: [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
          { x: 0, y: 8 },
        ],
      },
      abort.signal,
    );
    const rejection = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    abort.abort();
    await rejection;
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });
  it("큰 문서의 마스크 연산은 바뀌지 않은 픽셀을 공유해 64MiB 이력 안에서 되돌려요", async () => {
    const original = createDocument(2048, 2048);
    for (let i = 0; i < 3; i++)
      original.layers.push(createPixelLayer(createRaster(2048, 2048), "합성 사진", `synthetic-${i}`));
    original.selection = new Uint8Array(2048 * 2048).fill(255);
    const operation = runEditorOperation({ kind: "mask", doc: original, id: "synthetic-0", operation: "hide" });
    const worker = FakeWorker.instances[0];
    if (!worker) throw Error();
    const response = cloneDocumentMetadata(original);
    response.selection = new Uint8Array(0);
    for (const layer of response.layers)
      if (layer.kind === "pixel") {
        layer.pixels = { ...layer.pixels, data: new Uint8ClampedArray(0) };
        if (layer.id === "synthetic-0") layer.mask = new Uint8Array(2048 * 2048);
      }
    worker.respondResult({ kind: "document", doc: response });
    const result = await operation;
    if (result.kind !== "document") throw Error();
    const before = original.layers[0],
      after = result.doc.layers[0];
    if (before?.kind !== "pixel" || after?.kind !== "pixel") throw Error();
    expect(after.pixels.data).toBe(before.pixels.data);
    expect(result.doc.selection).toBe(original.selection);
    const history = new EditorHistory();
    let doc = history.perform(original, "배경 숨김", (draft) => {
      draft.layers = result.doc.layers;
    });
    expect(history.memoryBytes).toBeLessThan(8 * 1024 * 1024);
    doc = history.undo(doc);
    const undone = doc.layers[0];
    if (undone?.kind !== "pixel") throw Error();
    expect(undone.mask).toBeNull();
    expect(undone.pixels.data).toBe(before.pixels.data);
    doc = history.redo(doc);
    const redone = doc.layers[0];
    if (redone?.kind !== "pixel") throw Error();
    expect(redone.mask?.length).toBe(2048 * 2048);
  });
  it("연산 중 기준 픽셀이 바뀌면 오래된 결과를 적용하지 않아요", async () => {
    const doc = documentFixture(),
      operation = runEditorOperation({ kind: "feather", doc, id: "synthetic", radius: 1 });
    const rejection = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    const layer = doc.layers[0];
    if (layer?.kind !== "pixel") throw Error();
    layer.pixels.data[0] = 100;
    markRasterChanged(layer.pixels.data);
    const worker = FakeWorker.instances[0];
    if (!worker) throw Error();
    const result = cloneDocumentMetadata(doc);
    const output = result.layers[0];
    if (output?.kind !== "pixel") throw Error();
    output.pixels.data = new Uint8ClampedArray(0);
    worker.respondResult({ kind: "document", doc: result });
    await rejection;
    expect(layer.pixels.data[0]).toBe(100);
  });
});
