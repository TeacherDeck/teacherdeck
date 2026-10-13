// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, expect, it, vi } from "vitest";
import { FONT_STACK } from "@deck/ui";
import type { ImageFormat } from "./output-format.ts";

afterEach(() => vi.unstubAllGlobals());

async function crop(format: ImageFormat, fallback = false) {
  vi.resetModules();
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(16, 20);
  view.setUint32(20, 10);
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    resetTransform: vi.fn(),
  };
  const convertToBlob = vi.fn(
    async ({ type }: { type: string }) => new Blob(["synthetic"], { type: fallback ? "image/png" : type }),
  );
  const worker = { onmessage: null as ((event: MessageEvent) => Promise<void>) | null, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 20, height: 10, close: vi.fn() }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width = 10;
      height = 5;
      getContext() {
        return context;
      }
      convertToBlob = convertToBlob;
    },
  );
  await import("./crop.worker.ts");
  await worker.onmessage?.({
    data: {
      bytes,
      format,
      preview: false,
      fontFamily: FONT_STACK,
      edit: { turns: 0, flipX: false, flipY: false, rect: { x: 0, y: 0, width: 10, height: 5 } },
    },
  } as MessageEvent);
  return { context, convertToBlob, worker };
}

it.each(["png", "jpeg", "webp"] as const)("uses the resolved %s encoder for the cropped output", async (format) => {
  const result = await crop(format);
  expect(result.convertToBlob).toHaveBeenCalledWith({ type: `image/${format}`, quality: 0.95 });
  expect(result.context.fillRect).toHaveBeenCalledTimes(format === "jpeg" ? 1 : 0);
  expect(result.worker.postMessage.mock.calls[0]?.[0]).toMatchObject({ blob: expect.any(Blob) });
});

it("reports an unavailable encoder without silently returning a different format", async () => {
  const result = await crop("webp", true);
  expect(result.worker.postMessage).toHaveBeenCalledWith({ error: "ENCODER_UNAVAILABLE" });
});
