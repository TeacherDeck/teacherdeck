// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
  Util: {},
  VerbosityLevel: { ERRORS: 0 },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "synthetic-worker-url" }));
vi.mock("./source-check-client.ts", () => ({ checkSourceImagesInWorker: vi.fn() }));

import { getDocument } from "pdfjs-dist";
import { openPdf } from "./pdf.ts";
import { checkSourceImagesInWorker } from "./source-check-client.ts";
import { MAX_PIXELS } from "./pdf-geometry.ts";

describe("PDF opening preflight integration", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects an already aborted request before preflight or PDF.js starts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(openPdf(new Uint8Array(), controller.signal)).rejects.toThrow("CANCELLED");
    expect(checkSourceImagesInWorker).not.toHaveBeenCalled();
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("awaits Worker preflight and still passes an intact copy to PDF.js", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 synthetic");
    const controller = new AbortController();
    let finishCheck: (() => void) | undefined;
    vi.mocked(checkSourceImagesInWorker).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    const destroy = vi.fn().mockResolvedValue(undefined);
    const doc = { numPages: 1, loadingTask: { destroy } };
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc), destroy } as unknown as ReturnType<
      typeof getDocument
    >);
    vi.stubGlobal("document", { baseURI: "http://localhost/synthetic/" });
    const pending = openPdf(bytes, controller.signal);
    expect(checkSourceImagesInWorker).toHaveBeenCalledWith(bytes, MAX_PIXELS, controller.signal);
    expect(getDocument).not.toHaveBeenCalled();
    finishCheck?.();
    await expect(pending).resolves.toBe(doc);
    const data = vi.mocked(getDocument).mock.calls[0]?.[0];
    expect(data).toMatchObject({ data: bytes });
    if (typeof data !== "object" || data === null || !("data" in data)) throw new Error("EXPECTED_PDF_DATA");
    expect(data.data).not.toBe(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("does not start PDF.js when preflight fails", async () => {
    vi.mocked(checkSourceImagesInWorker).mockRejectedValue(new Error("PDF_TIMEOUT"));
    await expect(openPdf(new TextEncoder().encode("%PDF-1.7"), new AbortController().signal)).rejects.toThrow(
      "PDF_TIMEOUT",
    );
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("honors abort between successful preflight and PDF.js startup", async () => {
    const controller = new AbortController();
    vi.mocked(checkSourceImagesInWorker).mockImplementation(() => {
      controller.abort();
      return Promise.resolve();
    });
    await expect(openPdf(new TextEncoder().encode("%PDF-1.7"), controller.signal)).rejects.toThrow("CANCELLED");
    expect(getDocument).not.toHaveBeenCalled();
  });
});
