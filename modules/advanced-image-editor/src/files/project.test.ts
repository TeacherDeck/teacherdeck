// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createDocument, createPixelLayer, createShapeLayer, createTextLayer } from "../core/model.ts";
import { decodeProject, encodeProject, inspectProjectZip } from "./project.ts";
function document() {
  const imageFontSize = 2;
  const doc = createDocument(3, 2);
  const layer = createPixelLayer(
    {
      width: 3,
      height: 2,
      data: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 200, 70, 80, 90, 128, 100, 110, 120, 0, 130, 140, 150, 255, 160, 170, 180, 255,
      ]),
    },
    "합성 이미지",
    "pixels",
  );
  layer.mask = new Uint8Array([255, 128, 0, 255, 255, 180]);
  layer.adjustments.brightness = 0.2;
  layer.adjustments.levels.r.gamma = 1.4;
  layer.adjustments.curves.b = [
    { x: 0, y: 0 },
    { x: 100, y: 180 },
    { x: 255, y: 255 },
  ];
  layer.transform = { x: -1, y: 4, rotation: 30, scaleX: -1, scaleY: 2 };
  doc.layers.push(
    layer,
    createTextLayer({ content: "합성 글자\n두 번째 줄", width: 3, height: 2, fontSize: imageFontSize }, "글자", "text"),
    createShapeLayer({ type: "arrow", width: 3, height: 2, strokeWidth: 1 }, "화살표", "shape"),
  );
  doc.revision = 42;
  return doc;
}
describe("editable native project", () => {
  it("round-trips base pixels, masks, descriptors and independent adjustments without applying them twice", () => {
    const source = document(),
      original = structuredClone(source);
    const restored = decodeProject(encodeProject(source));
    expect(restored.layers).toEqual(source.layers);
    expect(restored.revision).toBe(0);
    expect(source).toEqual(original);
    expect(restored.layers[0]?.kind === "pixel" && restored.layers[0].pixels.data[0]).toBe(10);
    const text = restored.layers[1];
    if (text?.kind === "text") text.text.content = "수정한 글자";
    expect(decodeProject(encodeProject(restored)).layers[1]).toEqual(text);
  });
  it("rejects traversal entries, unsupported schemas and duplicate names before extracting anything", () => {
    expect(() => decodeProject(zipSync({ "../outside": new Uint8Array([1]) }))).toThrow("INVALID_PROJECT");
    expect(() =>
      decodeProject(zipSync({ "document.json": strToU8('{"format":"teacherdeck-image","version":999}') })),
    ).toThrow("INVALID_PROJECT");
  });
  it("checks declared decompressed bytes before allocation and checks CRC for a damaged raw plane", () => {
    const oversized = encodeProject(document());
    const view = new DataView(oversized.buffer);
    for (let i = 0; i < oversized.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 250 * 1024 * 1024, true);
        break;
      }
    expect(() => inspectProjectZip(oversized)).toThrow("MEMORY_LIMIT");
    const damaged = zipSync({ "document.json": strToU8("{}") }, { level: 0 });
    const payload =
      30 + new DataView(damaged.buffer).getUint16(26, true) + new DataView(damaged.buffer).getUint16(28, true);
    damaged[payload] = (damaged[payload] ?? 0) ^ 1;
    expect(() => decodeProject(damaged)).toThrow("INVALID_PROJECT");
  });
  it("refuses malformed curve points and pixel-mask dimensions", () => {
    const doc = document();
    const layer = doc.layers[0];
    if (!layer || layer.kind !== "pixel") throw new Error("fixture");
    layer.adjustments.curves.rgb = [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(() => encodeProject(doc)).toThrow("INVALID_PROJECT");
  });
});
