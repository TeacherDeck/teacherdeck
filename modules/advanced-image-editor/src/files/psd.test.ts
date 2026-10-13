// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { readPsd, writePsdUint8Array } from "ag-psd";
import { zlibSync } from "fflate";
import { createDocument, createPixelLayer, createRaster, createTextLayer } from "../core/model.ts";
import { renderLayerTransformed, renderDocumentPixels, rasterizeLayer } from "../core/render.ts";
import type { Raster, Layer } from "../core/model.ts";
import { decodePsd, encodePsd } from "./psd.ts";
import type { PsdRasterizer } from "./psd.ts";
const syntheticImageFont = "Arial";
const syntheticImageFontSize = 2;
const rgba = (w = 2, h = 2): Raster => ({
  width: w,
  height: h,
  data: new Uint8ClampedArray(Array.from({ length: w * h }, () => [40, 80, 120, 255]).flat()),
});
const renderer: PsdRasterizer = {
  rasterizeLayer: (layer: Layer) =>
    layer.kind === "pixel"
      ? layer.pixels
      : rgba(
          layer.kind === "text" ? layer.text.width : layer.shape.width,
          layer.kind === "text" ? layer.text.height : layer.shape.height,
        ),
  renderLayerTransformed: (layer: Layer) =>
    layer.kind === "pixel"
      ? renderLayerTransformed(layer)
      : {
          raster: rgba(
            layer.kind === "text" ? layer.text.width : layer.shape.width,
            layer.kind === "text" ? layer.text.height : layer.shape.height,
          ),
          left: layer.transform.x,
          top: layer.transform.y,
        },
  renderDocumentPixels: (doc) => rgba(doc.width, doc.height),
};
describe("basic editable PSD contract", () => {
  it("refuses transformed PSD cache and mask peaks before the first renderer allocation", () => {
    const doc = createDocument(8, 6),
      allocate = vi.fn(() => {
        throw new Error("UNEXPECTED_RENDER");
      });
    for (let i = 0; i < 2; i++) {
      const layer = createPixelLayer(createRaster(100, 100));
      layer.mask = new Uint8Array(10_000).fill(255);
      layer.transform.scaleX = 40;
      layer.transform.scaleY = 40;
      doc.layers.push(layer);
    }
    expect(() => encodePsd(doc, { ...renderer, renderLayerTransformed: allocate })).toThrow(/메모리/);
    expect(allocate).not.toHaveBeenCalled();
  });
  it("does not reveal fully hidden alpha after resampling a mask and retains an editable independent mask", () => {
    const doc = createDocument(4, 2),
      layer = createPixelLayer(createRaster(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 0])));
    layer.mask = new Uint8Array([0, 255]);
    layer.transform.scaleX = 2;
    doc.layers.push(layer);
    const before = renderDocumentPixels(doc),
      originalPixels = layer.pixels.data.slice(),
      originalMask = layer.mask.slice();
    const imported = decodePsd(
      encodePsd(doc, { renderLayerTransformed, renderDocumentPixels, rasterizeLayer }),
    ).document;
    expect(renderDocumentPixels(imported).data).toEqual(before.data);
    const saved = imported.layers[0];
    expect(saved?.kind === "pixel" && saved.mask).toBeInstanceOf(Uint8Array);
    if (saved?.kind !== "pixel") throw new Error("missing pixel layer");
    saved.mask = null;
    expect(renderDocumentPixels(imported).data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(layer.pixels.data).toEqual(originalPixels);
    expect(layer.mask).toEqual(originalMask);
  });
  it("keeps partially masked colors and alpha within one byte after affine PSD layer recomposition", () => {
    const doc = createDocument(8, 6),
      layer = createPixelLayer(
        createRaster(2, 2, new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 220, 100, 40, 255])),
      );
    layer.mask = new Uint8Array([0, 255, 128, 64]);
    layer.transform = { x: 2, y: 1, scaleX: 1.6, scaleY: 1.2, rotation: 20, shear: 0.25 };
    doc.layers.push(layer);
    const before = renderDocumentPixels(doc).data;
    const imported = decodePsd(
      encodePsd(doc, { renderLayerTransformed, renderDocumentPixels, rasterizeLayer }),
    ).document;
    const after = renderDocumentPixels(imported).data;
    for (let i = 0; i < before.length; i++) expect(Math.abs((before[i] ?? 0) - (after[i] ?? 0))).toBeLessThanOrEqual(1);
    const saved = imported.layers[0];
    expect(saved?.kind === "pixel" && saved.mask?.some((value) => value > 0 && value < 255)).toBe(true);
  });
  it.each([1, 2])(
    "writes an intact %i-pixel-wide transparent composite despite ag-psd's narrow RLE scratch bound",
    (width) => {
      const doc = createDocument(width, 2);
      const pixels = rgba(width, 2);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 128;
      doc.layers.push(createPixelLayer(pixels));
      const bytes = encodePsd(doc, { ...renderer, renderDocumentPixels: () => pixels });
      expect(readPsd(bytes, { useImageData: true }).imageData?.data).toEqual(pixels.data);
      expect(decodePsd(bytes).document.layers[0]?.kind).toBe("pixel");
    },
  );
  it("rejects compressed channel expansion beyond its pixel dimensions before ag-psd inflation", () => {
    const compressed = zlibSync(new Uint8Array(100_000));
    const bytes = writePsdUint8Array({
      width: 2,
      height: 2,
      imageData: rgba(),
      children: [
        {
          name: "합성 압축",
          left: 0,
          top: 0,
          right: 2,
          bottom: 2,
          rawData: {
            colorMode: 3,
            bitsPerChannel: 8,
            large: false,
            channels: [0, 1, 2].map((id) => ({ id, compression: 2, data: compressed })),
          },
        },
      ],
    });
    expect(() => decodePsd(bytes)).toThrow("MEMORY_LIMIT");
  });
  it("exports modified Korean multiline text with its live descriptor and composite, then edits it after import", () => {
    const doc = createDocument(8, 6);
    doc.layers.push(createPixelLayer(rgba(), "합성 사진", "photo"));
    const text = createTextLayer(
      {
        content: "처음 글자",
        fontFamily: syntheticImageFont,
        fontSize: syntheticImageFontSize,
        color: [10, 20, 30, 255],
        width: 4,
        height: 3,
      },
      "합성 글자",
      "text",
    );
    text.text.content = "수정한 글자\n두 번째 줄";
    text.transform.x = 1;
    text.transform.y = 2;
    doc.layers.push(text);
    const bytes = encodePsd(doc, renderer);
    const parsed = readPsd(bytes, { useImageData: true });
    expect(parsed.children?.[1]?.text?.text.replace(/\r/g, "\n")).toBe(text.text.content);
    expect(parsed.children?.[1]?.imageData).toBeDefined();
    expect(parsed.imageData?.width).toBe(8);
    const imported = decodePsd(bytes);
    expect(imported.flattened).toBe(false);
    expect(imported.document.layers[1]?.kind).toBe("text");
    const importedText = imported.document.layers[1];
    if (importedText?.kind !== "text") throw new Error("text missing");
    importedText.text.content = "다시 편집";
    expect(readPsd(encodePsd(imported.document, renderer), { useImageData: true }).children?.[1]?.text?.text).toBe(
      "다시 편집",
    );
  });
  it("keeps basic masks independent and preserves order, offset, opacity and blends", () => {
    const doc = createDocument(4, 4),
      first = createPixelLayer(rgba(), "아래", "bottom"),
      top = createPixelLayer(rgba(), "위", "top");
    first.mask = new Uint8Array([255, 128, 0, 64]);
    top.opacity = 0.4;
    top.blend = "multiply";
    top.transform.x = 1;
    doc.layers.push(first, top);
    const imported = decodePsd(encodePsd(doc, renderer));
    const bottom = imported.document.layers[0];
    expect(bottom?.kind === "pixel" && bottom.mask).toEqual(first.mask);
    expect(imported.document.layers.map((l) => l.name)).toEqual(["아래", "위"]);
    expect(imported.document.layers[1]?.blend).toBe("multiply");
    expect(imported.document.layers[1]?.opacity).toBeCloseTo(0.4, 2);
    expect(imported.document.layers[1]?.transform.x).toBe(1);
  });
  it("never silently omits adjustments: explicit composite import has one noneditable pixel layer", () => {
    const composite = rgba(4, 2);
    for (let i = 3; i < composite.data.length; i += 4) composite.data[i] = 128;
    const bytes = writePsdUint8Array({
      width: 4,
      height: 2,
      imageData: composite,
      children: [{ name: "보정", adjustment: { type: "brightness/contrast", brightness: 20, contrast: 0 } }],
    });
    expect(() => decodePsd(bytes)).toThrow("PSD_UNSUPPORTED");
    const imported = decodePsd(bytes, { unsupported: "composite" });
    expect(imported.flattened).toBe(true);
    expect(imported.document.layers).toHaveLength(1);
    expect(imported.document.layers[0]?.kind).toBe("pixel");
    const layer = imported.document.layers[0];
    expect(layer?.kind === "pixel" && [...layer.pixels.data.subarray(0, 4)]).toEqual([40, 80, 120, 128]);
    expect(imported.warnings.some((s) => s.includes("개별 수정할 수 없어요"))).toBe(true);
  });
  it("requires a choice for complex text, and applies only the selected font replacement", () => {
    const bytes = writePsdUint8Array({
      width: 2,
      height: 2,
      imageData: rgba(),
      children: [
        {
          name: "글자",
          imageData: rgba(),
          text: {
            text: "합성 글자",
            orientation: "vertical",
            style: { font: { name: "SyntheticMissingFont" }, fontSize: syntheticImageFontSize },
          },
        },
      ],
    });
    expect(() => decodePsd(bytes)).toThrow("PSD_COMPLEX_TEXT");
    const imported = decodePsd(bytes, { complexText: "simplify", fontReplacements: { SyntheticMissingFont: "Arial" } });
    expect(imported.document.layers[0]?.kind === "text" && imported.document.layers[0].text.fontFamily).toBe("Arial");
    expect(imported.warnings.length).toBeGreaterThan(0);
  });
});
