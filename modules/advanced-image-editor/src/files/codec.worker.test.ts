// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, expect, it, vi } from "vitest";
import { createDocument, createPixelLayer, createRaster } from "../core/model.ts";
import { encodeProject } from "./project.ts";
import type { CodecRequest, CodecResponse } from "./codec.worker.ts";
afterEach(() => vi.unstubAllGlobals());
it("transfers newly decoded pixel and mask ownership without transferring the caller's input", async () => {
  const document = createDocument(2, 2),
    layer = createPixelLayer(createRaster(2, 2));
  layer.mask = new Uint8Array([255, 128, 0, 64]);
  document.layers.push(layer);
  const bytes = Uint8Array.from(encodeProject(document));
  const port: { onmessage?: (event: { data: CodecRequest }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> } =
    { postMessage: vi.fn() };
  vi.stubGlobal("self", port);
  await import("./codec.worker.ts");
  await port.onmessage?.({ data: { kind: "decode", bytes } });
  const response = port.postMessage.mock.calls[0]?.[0] as CodecResponse;
  if (!("result" in response) || !("document" in response.result)) throw new Error("missing decoded document");
  const decoded = response.result.document.layers[0];
  if (decoded?.kind !== "pixel") throw new Error("missing decoded pixels");
  const transfer = port.postMessage.mock.calls[0]?.[1].transfer as ArrayBuffer[];
  expect(transfer).toHaveLength(2);
  expect(transfer).toContain(decoded.pixels.data.buffer);
  expect(transfer).toContain(decoded.mask?.buffer);
  expect(transfer).not.toContain(bytes.buffer);
  expect(transfer).not.toContain(layer.pixels.data.buffer);
  expect([...layer.mask]).toEqual([255, 128, 0, 64]);
});
