// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { writePsdUint8Array } from "ag-psd";
import { strToU8, zipSync } from "fflate";
import { inspectInputBudget, requireInputBudget } from "./budget.ts";
import { exportDocument, importDocument } from "./index.ts";
import { createDocument, createPixelLayer, createRaster } from "../core/model.ts";
import { MAX_WORKING_BYTES } from "./limits.ts";

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33),
    view = new DataView(bytes.buffer);
  bytes[0] = 137;
  bytes.set([80, 78, 71], 1);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(8, 13);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const pixel = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };

describe("input allocation preflight", () => {
  it("counts the full encoded backing buffer and refuses excessive transformed PSD work before dispatch", async () => {
    const backing = new Uint8Array(256);
    backing.set(png(1, 1), 16);
    const slice = backing.subarray(16, 49);
    expect(inspectInputBudget(slice)).toBe(backing.length * 2 + slice.length + 12);
    const document = createDocument(8, 6),
      runner = vi.fn();
    for (let i = 0; i < 2; i++) {
      const layer = createPixelLayer(createRaster(100, 100));
      layer.mask = new Uint8Array(10_000);
      layer.transform.scaleX = 40;
      layer.transform.scaleY = 40;
      document.layers.push(layer);
    }
    await expect(exportDocument(document, "psd", new AbortController().signal, runner)).rejects.toThrow(/메모리/);
    expect(runner).not.toHaveBeenCalled();
  });
  it("reserves both encoded copies and decoding planes before the Worker is created", async () => {
    const input = png(2_048, 1_024),
      runner = vi.fn();
    expect(inspectInputBudget(input)).toBe(input.length * 2 + 2_048 * 1_024 * 12);
    await expect(
      importDocument(input, new AbortController().signal, { reservedBytes: MAX_WORKING_BYTES - 1 }, runner),
    ).rejects.toMatchObject({ code: "MEMORY_LIMIT" });
    expect(runner).not.toHaveBeenCalled();
  });
  it("counts declared ZIP planes without decompressing those pixels", () => {
    const metadata = strToU8(JSON.stringify({ width: 16, height: 8 }));
    const bytes = zipSync({
      "document.json": metadata,
      "pixels/0.rgba": new Uint8Array(16 * 8 * 4),
      "masks/0.gray": new Uint8Array(16 * 8),
    });
    expect(inspectInputBudget(bytes)).toBe(bytes.length * 2 + 16 * 8 * 5 + metadata.length * 4 + 16 * 8 * 4);
  });
  it("uses PSD layer and independent mask bounds before any channel is decoded", () => {
    const bytes = Uint8Array.from(
      writePsdUint8Array({
        width: 8,
        height: 6,
        imageData: { width: 8, height: 6, data: new Uint8ClampedArray(192) },
        children: [{ imageData: pixel, mask: { imageData: pixel, left: 3, top: 4 } }],
      }),
    );
    const original = inspectInputBudget(bytes),
      view = new DataView(bytes.buffer);
    let at = 26;
    for (let section = 0; section < 2; section++) at += 4 + view.getUint32(at);
    const record = at + 10;
    view.setInt32(record + 8, 2_000);
    view.setInt32(record + 12, 3_000);
    expect(inspectInputBudget(bytes) - original).toBe((3_000 * 2_000 - 4) * 10);
    expect(() => requireInputBudget(bytes, { reservedBytes: MAX_WORKING_BYTES - original })).toThrow("MEMORY_LIMIT");
  });
  it("validates memory reservations and structural PSD lengths without allocating pixels", () => {
    expect(() => requireInputBudget(png(1, 1), { reservedBytes: -1 })).toThrow("MEMORY_LIMIT");
    expect(() => requireInputBudget(png(1, 1), { reservedBytes: Number.NaN })).toThrow("MEMORY_LIMIT");
    const bytes = Uint8Array.from(writePsdUint8Array({ width: 2, height: 2, imageData: pixel }));
    new DataView(bytes.buffer).setUint32(26, bytes.length);
    expect(() => inspectInputBudget(bytes)).toThrow("INVALID_PSD");
  });
});
