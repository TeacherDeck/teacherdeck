// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument, createPixelLayer, createRaster } from "../core/model.ts";
import { decodeDocument, encodeDocument } from "./codec.ts";

const canvases: TestCanvas[] = [];
const convertToBlob = vi.fn(async ({ type }: { type: string }) => new Blob(["synthetic"], { type }));
class TestCanvas {
  width: number;
  height: number;
  context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    putImageData: vi.fn(),
    getImageData: vi.fn(() => new TestImageData(new Uint8ClampedArray(8), 2, 1)),
  };
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    canvases.push(this);
  }
  getContext() {
    return this.context;
  }
  convertToBlob = convertToBlob;
}
class TestImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
function transparentDocument() {
  const document = createDocument(2, 1);
  const pixels = createRaster(2, 1);
  pixels.data.set([255, 0, 0, 128, 0, 0, 0, 0]);
  document.layers.push(createPixelLayer(pixels));
  return document;
}
beforeEach(() => {
  canvases.length = 0;
  convertToBlob.mockClear();
  vi.stubGlobal("OffscreenCanvas", TestCanvas);
  vi.stubGlobal("ImageData", TestImageData);
});
afterEach(() => vi.unstubAllGlobals());

describe("raster encoders", () => {
  it("reports the original raster format from decoded file bytes", async () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    view.setUint32(16, 2);
    view.setUint32(20, 1);
    bytes[24] = 8;
    bytes[25] = 6;
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 1, close })),
    );
    const result = await decodeDocument(bytes);
    expect(result.rasterFormat).toBe("png");
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(["png", "jpeg", "webp"] as const)("requests real %s output and preserves the document", async (format) => {
    const document = transparentDocument();
    const original = structuredClone(document);
    const result = await encodeDocument(document, format);
    expect(result.blob.type).toBe(`image/${format}`);
    expect(result.format).toBe(format);
    expect(convertToBlob).toHaveBeenCalledWith({ type: `image/${format}`, quality: 0.95 });
    expect(canvases).toHaveLength(1);
    const image = canvases[0]?.context.putImageData.mock.calls[0]?.[0] as TestImageData;
    expect([...image.data]).toEqual(
      format === "jpeg" ? [255, 127, 127, 255, 255, 255, 255, 255] : [255, 0, 0, 128, 0, 0, 0, 0],
    );
    expect(document).toEqual(original);
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
  });

  it.each(["webp", "jpeg"] as const)("rejects a silent PNG fallback for %s", async (format) => {
    convertToBlob.mockResolvedValueOnce(new Blob(["synthetic"], { type: "image/png" }));
    await expect(encodeDocument(transparentDocument(), format)).rejects.toThrow("UNSUPPORTED_EXPORT");
    expect(canvases.every((canvas) => canvas.width === 1 && canvas.height === 1)).toBe(true);
  });
});
