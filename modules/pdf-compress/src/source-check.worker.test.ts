// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { SourceCheckRequest } from "./source-check-client.ts";

async function check(sourceBytes: Uint8Array, maxPixels: number) {
  const bytes = new Uint8Array(sourceBytes);
  const scope: {
    onmessage: ((event: MessageEvent<SourceCheckRequest>) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
  } = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("./source-check.worker.ts");
  scope.onmessage?.({ data: { bytes, maxPixels } } as MessageEvent<SourceCheckRequest>);
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce());
  expect(bytes).toEqual(new Uint8Array(bytes.length));
  return scope.postMessage;
}

describe("source-check Worker handler", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs the PDF parser in the Worker handler and zeroes its transferred input", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const post = await check(await doc.save(), 200);
    expect(post).toHaveBeenCalledWith({ ok: true });
  });

  it("preserves the pixel-budget failure code and zeroes input after failure", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.context.register(
      doc.context.stream(new Uint8Array([0]), {
        Type: "XObject",
        Subtype: "Image",
        Width: 21,
        Height: 10,
        BitsPerComponent: 8,
        ColorSpace: "DeviceGray",
      }),
    );
    const post = await check(await doc.save(), 200);
    expect(post).toHaveBeenCalledWith({ ok: false, code: "SOURCE_IMAGE_TOO_LARGE" });
  });

  it("returns only a safe code for parser errors and clears malformed source contents", async () => {
    const post = await check(new TextEncoder().encode("synthetic malformed PDF contents"), 200);
    expect(post).toHaveBeenCalledWith({ ok: false, code: "INVALID_PDF" });
  });
});
