// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, expect, it, vi } from "vitest";
import type { Options } from "./image.ts";

afterEach(() => vi.unstubAllGlobals());

async function convert(format: Options["format"], fallback = false) {
  vi.resetModules();
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(16, 20);
  view.setUint32(20, 10);
  const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  const convertToBlob = vi.fn(
    async ({ type }: { type: string }) => new Blob(["synthetic"], { type: fallback ? "image/png" : type }),
  );
  const postMessage = vi.fn();
  const close = vi.fn();
  vi.stubGlobal("onmessage", null);
  vi.stubGlobal("postMessage", postMessage);
  vi.stubGlobal("createImageBitmap", async () => ({ width: 20, height: 10, close }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      width = 20;
      height = 10;
      getContext() {
        return context;
      }
      convertToBlob = convertToBlob;
    },
  );
  await import("./convert.worker.ts");
  const handler = globalThis.onmessage as ((event: MessageEvent) => Promise<void>) | null;
  await handler?.({
    data: { blob: new Blob([bytes]), options: { format, quality: 82, maxEdge: 1600 } },
  } as MessageEvent);
  return { context, convertToBlob, postMessage, close };
}

it.each(["original", "png", "jpeg", "webp"] as const)(
  "encodes %s and uses a white background only for explicit JPEG",
  async (format) => {
    const result = await convert(format);
    expect(result.convertToBlob).toHaveBeenCalledWith({
      type: `image/${format === "original" ? "png" : format}`,
      quality: 0.82,
    });
    expect(result.context.fillRect).toHaveBeenCalledTimes(format === "jpeg" ? 1 : 0);
    if (format === "jpeg") expect(result.context.fillStyle).toBe("white");
    expect(result.postMessage).toHaveBeenCalledWith({ ok: true, blob: expect.any(Blob) });
    expect(result.close).toHaveBeenCalledOnce();
  },
);

it("reports unsupported encoders instead of silently saving their PNG fallback", async () => {
  const result = await convert("webp", true);
  expect(result.postMessage).toHaveBeenCalledWith({ ok: false, error: "ENCODER_UNAVAILABLE" });
});
