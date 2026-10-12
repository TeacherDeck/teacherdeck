// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { defined } from "./defined.ts";
import { describe, expect, it } from "vitest";
import {
  applyAdjustments,
  applySelectionMask,
  colorSelection,
  createDocument,
  createPixelLayer,
  createRaster,
  createTextLayer,
  curveLut,
  EditorHistory,
  identityAdjustments,
  invertSelection,
  localToDocument,
  documentToLocal,
  mergeDown,
  perspectiveRaster,
  polygonSelection,
  rectangleSelection,
  renderDocumentPixels,
  resizeDocument,
  setSelection,
} from "./index.ts";
function pixelDoc(width = 8, height = 8) {
  const doc = createDocument(width, height);
  doc.layers.push(createPixelLayer(createRaster(width, height), "합성 이미지", "synthetic"));
  return doc;
}
describe("고급 이미지 편집 순수 코어", () => {
  it("전체와 개별 항등 보정이 알파까지 보존해요", () => {
    const source = createRaster(2, 1, new Uint8ClampedArray([12, 80, 255, 33, 0, 128, 200, 255]));
    expect(applyAdjustments(source, identityAdjustments()).data).toEqual(source.data);
    const adjusted = identityAdjustments();
    adjusted.curves.r = [
      { x: 0, y: 255 },
      { x: 255, y: 0 },
    ];
    expect([...applyAdjustments(source, adjusted).data]).toEqual([243, 80, 255, 33, 255, 128, 200, 255]);
  });
  it("중복 X 곡선을 거절하고 단조 곡선에서 오버슈트를 만들지 않아요", () => {
    expect(() =>
      curveLut([
        { x: 0, y: 0 },
        { x: 0, y: 120 },
      ]),
    ).toThrow();
    const lut = curveLut([
      { x: 0, y: 0 },
      { x: 60, y: 10 },
      { x: 170, y: 230 },
      { x: 255, y: 255 },
    ]);
    for (let i = 1; i < 256; i++) expect(defined(lut[i])).toBeGreaterThanOrEqual(defined(lut[i - 1]));
  });
  it("Klecks 색 선택의 연결 영역과 전체 유사색을 구분하고 subarray를 읽어요", () => {
    const data = new Uint8ClampedArray(16);
    data.set([10, 10, 10, 255, 200, 200, 200, 255, 10, 10, 10, 255], 4);
    const raster = createRaster(3, 1, data.subarray(4));
    expect([...colorSelection(raster, 0, 0, 0, true)]).toEqual([255, 0, 0]);
    expect([...colorSelection(raster, 0, 0, 0, false)]).toEqual([255, 0, 255]);
  });
  it("선택 영역 추가·빼기·반전과 다각형을 적용해요", () => {
    const doc = createDocument(4, 4);
    setSelection(doc, rectangleSelection(4, 4, { x: 0, y: 0, width: 2, height: 2 }));
    setSelection(doc, rectangleSelection(4, 4, { x: 1, y: 1, width: 2, height: 2 }), "add");
    expect(defined(doc.selection).filter((v) => v === 255).length).toBe(7);
    setSelection(doc, rectangleSelection(4, 4, { x: 1, y: 1, width: 1, height: 1 }), "subtract");
    expect(defined(doc.selection)[5]).toBe(0);
    invertSelection(doc);
    expect(defined(doc.selection)[5]).toBe(255);
    expect(
      polygonSelection(4, 4, [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 0, y: 4 },
      ]).filter((v) => v === 255).length,
    ).toBe(6);
  });
  it("마스크가 회전·반전된 이미지와 함께 움직여요", () => {
    const doc = pixelDoc(2, 1);
    const layer = defined(doc.layers[0]);
    if (layer.kind !== "pixel") throw Error();
    layer.pixels.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
    layer.mask = new Uint8Array([0, 255]);
    layer.transform.x = 2;
    layer.transform.scaleX = -1;
    expect([...renderDocumentPixels(doc).data]).toEqual([0, 0, 255, 255, 0, 0, 0, 0]);
  });
  it("반 픽셀 이동은 투명 경계에서 색 테두리 없이 알파를 보간해요", () => {
    const doc = createDocument(2, 1),
      layer = createPixelLayer(createRaster(1, 1, new Uint8ClampedArray([255, 0, 0, 255])), "합성 픽셀", "edge");
    layer.transform.x = 0.5;
    doc.layers.push(layer);
    expect([...renderDocumentPixels(doc).data]).toEqual([255, 0, 0, 128, 255, 0, 0, 128]);
  });
  it("변환의 왕복 좌표와 네 모서리 원근 항등을 유지해요", () => {
    const transform = { x: 12, y: 30, scaleX: -2, scaleY: 1.5, rotation: 37 },
      point = { x: 7, y: 9 };
    const back = documentToLocal(localToDocument(point, transform), transform);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
    const raster = createRaster(
      2,
      2,
      new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    );
    expect(
      perspectiveRaster(
        raster,
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 2, y: 2 },
          { x: 0, y: 2 },
        ],
        2,
        2,
      ).data,
    ).toEqual(raster.data);
    expect(() =>
      perspectiveRaster(
        raster,
        [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
        ],
        2,
        2,
      ),
    ).toThrow();
  });
  it("가로세로 비율이 다른 문서 리사이즈도 회전한 텍스트의 좌표를 보존해요", () => {
    const doc = createDocument(100, 100),
      text = createTextLayer({ content: "합성 글자", width: 80, height: 40 }, "글자", "synthetic-text");
    text.transform = { x: 20, y: 10, rotation: 43, scaleX: -1.5, scaleY: 0.7 };
    doc.layers.push(text);
    const before = localToDocument({ x: 35, y: 17 }, text.transform);
    resizeDocument(doc, 150, 50);
    const after = localToDocument({ x: 35, y: 17 }, text.transform);
    expect(after.x).toBeCloseTo(before.x * 1.5);
    expect(after.y).toBeCloseTo(before.y * 0.5);
    expect(text.kind).toBe("text");
    expect(text.text.content).toBe("합성 글자");
  });
  it("한 획의 여러 입력을 한 타일 이력으로 되돌리고 다시 실행해요", () => {
    let doc = pixelDoc(512, 512);
    const history = new EditorHistory();
    const stroke = history.beginStroke(doc, "synthetic", {
      size: 8,
      hardness: 1,
      opacity: 1,
      color: [200, 0, 0, 255],
      mode: "paint",
    });
    stroke.addPoint({ x: 20, y: 20 });
    stroke.addPoint({ x: 40, y: 40 });
    doc = stroke.commit();
    const painted = defined(doc.layers[0]);
    if (painted.kind !== "pixel") throw Error();
    const expected = painted.pixels.data.slice();
    expect(history.memoryBytes).toBe(256 * 256 * 4 * 2);
    doc = history.undo(doc);
    expect((doc.layers[0] as typeof painted).pixels.data.every((v) => v === 0)).toBe(true);
    doc = history.redo(doc);
    expect((doc.layers[0] as typeof painted).pixels.data.length).toBe(expected.length);
    expect((doc.layers[0] as typeof painted).pixels.data.every((value, index) => value === expected[index])).toBe(true);
  });
  it("레이어를 늘려도 브러시의 문서 픽셀 크기는 원형으로 유지해요", () => {
    const doc = pixelDoc(8, 8),
      layer = doc.layers[0];
    if (!layer || layer.kind !== "pixel") throw Error();
    doc.width = 16;
    layer.transform.scaleX = 2;
    const stroke = new EditorHistory().beginStroke(doc, "synthetic", {
      size: 4,
      hardness: 1,
      opacity: 1,
      color: [255, 0, 0, 255],
      mode: "paint",
    });
    stroke.addPoint({ x: 8, y: 4 });
    stroke.commit();
    expect(layer.pixels.data[(4 * 8 + 2) * 4 + 3]).toBe(0);
    expect(layer.pixels.data[(4 * 8 + 3) * 4 + 3]).toBe(255);
  });
  it("2048px 브러시는 입력을 양보하며 한 단계로 되돌려요", async () => {
    let doc = pixelDoc(2400, 2200);
    const history = new EditorHistory(),
      stroke = history.beginStroke(doc, "synthetic", {
        size: 2048,
        hardness: 0.8,
        opacity: 1,
        color: [20, 40, 60, 255],
        mode: "paint",
      });
    await stroke.addPointAsync({ x: 1200, y: 1100 });
    doc = stroke.commit();
    const layer = doc.layers[0];
    if (layer?.kind !== "pixel") throw Error();
    expect(layer.pixels.data[(1100 * 2400 + 1200) * 4 + 3]).toBe(255);
    expect(stroke.metrics.count).toBeGreaterThan(1);
    doc = history.undo(doc);
    const undone = doc.layers[0];
    if (undone?.kind !== "pixel") throw Error();
    expect(undone.pixels.data[(1100 * 2400 + 1200) * 4 + 3]).toBe(0);
    doc = history.redo(doc);
    const redone = doc.layers[0];
    if (redone?.kind !== "pixel") throw Error();
    expect(redone.pixels.data[(1100 * 2400 + 1200) * 4 + 3]).toBe(255);
  });
  it("나누어 처리하던 큰 획을 취소하면 앞서 바뀐 타일도 복원해요", async () => {
    const doc = pixelDoc(1024, 1024),
      stroke = new EditorHistory().beginStroke(doc, "synthetic", {
        size: 1024,
        hardness: 0.5,
        opacity: 1,
        color: [30, 60, 90, 255],
        mode: "paint",
      });
    const pending = stroke.addPointAsync({ x: 512, y: 512 });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    stroke.cancel();
    await rejected;
    const layer = doc.layers[0];
    if (layer?.kind !== "pixel") throw Error();
    expect(layer.pixels.data.every((value) => value === 0)).toBe(true);
  });
  it("브러시 예산 실패는 픽셀 변경 전에 발생하고 이전 부분도 복원해요", () => {
    const doc = pixelDoc(512, 512);
    const history = new EditorHistory(256 * 256 * 4 * 2);
    const stroke = history.beginStroke(doc, "synthetic", {
      size: 8,
      hardness: 1,
      opacity: 1,
      color: [0, 0, 0, 255],
      mode: "paint",
    });
    stroke.addPoint({ x: 10, y: 10 });
    expect(() => stroke.addPoint({ x: 300, y: 10 })).toThrow();
    const layer = defined(doc.layers[0]);
    if (layer.kind !== "pixel") throw Error();
    expect(layer.pixels.data.every((v) => v === 0)).toBe(true);
    expect(history.canUndo).toBe(false);
  });
  it("마스크 지우기와 복원, 텍스트 속성과 단일 이력을 유지해요", () => {
    let doc = pixelDoc();
    const history = new EditorHistory();
    const stroke = history.beginStroke(doc, "synthetic", {
      size: 4,
      hardness: 1,
      opacity: 1,
      color: [0, 0, 0, 255],
      mode: "mask-hide",
    });
    stroke.addPoint({ x: 4, y: 4 });
    doc = stroke.commit();
    expect(defined((doc.layers[0] as ReturnType<typeof createPixelLayer>).mask)[4 * 8 + 4]).toBe(0);
    doc = history.undo(doc);
    expect((doc.layers[0] as ReturnType<typeof createPixelLayer>).mask).toBeNull();
    doc = history.redo(doc);
    expect(defined((doc.layers[0] as ReturnType<typeof createPixelLayer>).mask)[4 * 8 + 4]).toBe(0);
    doc = history.perform(doc, "글자 추가", (draft) =>
      draft.layers.push(createTextLayer({ content: "합성 문장" }, "글자", "text")),
    );
    doc = history.perform(doc, "글자 변경", (draft) => {
      const text = defined(draft.layers[1]);
      if (text.kind === "text") text.text.content = "변경 문장";
    });
    doc = history.undo(doc);
    expect((doc.layers[1] as ReturnType<typeof createTextLayer>).text.content).toBe("합성 문장");
  });
  it("선택 배경 숨김은 독립 마스크만 바꾸고 곱하기 병합은 거절해요", () => {
    const doc = pixelDoc(2, 1);
    const first = defined(doc.layers[0]);
    if (first.kind !== "pixel") throw Error();
    first.pixels.data.fill(255);
    doc.selection = new Uint8Array([255, 0]);
    applySelectionMask(doc, "synthetic");
    expect([...defined(first.mask)]).toEqual([0, 255]);
    expect(first.pixels.data.every((v) => v === 255)).toBe(true);
    const top = createPixelLayer(createRaster(2, 1), "합성 위", "top");
    top.blend = "multiply";
    doc.layers.push(top);
    expect(() => mergeDown(doc, "top")).toThrow();
  });
  it("구조 이력은 현재 문서가 소유한 평면을 중복 계산하지 않고 병합 원본을 복원해요", () => {
    const before = createDocument(128, 128),
      bottom = createPixelLayer(createRaster(128, 128), "합성 아래", "bottom"),
      top = createPixelLayer(createRaster(128, 128), "합성 위", "top");
    before.layers.push(bottom, top);
    const merged = createPixelLayer(createRaster(128, 128), "합성 결과", "bottom");
    const history = new EditorHistory(160_000);
    let doc = history.perform(before, "레이어 병합", (draft) => {
      draft.layers = [merged];
    });
    expect(history.memoryBytes).toBeLessThan(160_000);
    doc = history.undo(doc);
    const restored = doc.layers[0];
    if (restored?.kind !== "pixel") throw Error();
    expect(doc.layers).toHaveLength(2);
    expect(restored.pixels.data).toBe(bottom.pixels.data);
    doc = history.redo(doc);
    const redone = doc.layers[0];
    if (redone?.kind !== "pixel") throw Error();
    expect(doc.layers).toHaveLength(1);
    expect(redone.pixels.data).toBe(merged.pixels.data);
  });
  it("되돌린 상태에서 이력을 줄여도 가까운 다시 실행 단계를 건너뛰지 않아요", () => {
    let doc = pixelDoc(16, 16);
    const history = new EditorHistory(20_000);
    for (const value of [10, 20])
      doc = history.perform(doc, "기준 픽셀 변경", (draft) => {
        const layer = draft.layers[0];
        if (layer?.kind !== "pixel") throw Error();
        layer.pixels = createRaster(16, 16);
        layer.pixels.data[0] = value;
      });
    doc = history.undo(history.undo(doc));
    const singleEntry = history.memoryBytes / 2;
    history.reserve(doc, 20_000 - singleEntry);
    expect(history.canRedo).toBe(true);
    doc = history.redo(doc);
    const layer = doc.layers[0];
    if (layer?.kind !== "pixel") throw Error();
    expect(layer.pixels.data[0]).toBe(10);
  });
});
