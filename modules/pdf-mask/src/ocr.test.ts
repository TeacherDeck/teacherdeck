// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./pdf.ts", () => ({ renderPage: vi.fn() }));
import { LocalOcr, recognizePages } from "./ocr.ts";
import { renderPage } from "./pdf.ts";
import type { Input } from "./batch.ts";
class FakeWorker {
  static last: FakeWorker;
  packets: { action: string; payload: unknown; jobId: string }[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  respond = true;
  recognitionCount = 0;
  static rejectRecognition = 0;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(packet: { action: string; payload: unknown; jobId: string }) {
    this.packets.push(packet);
    const recognition = packet.action === "recognize";
    if (recognition) this.recognitionCount++;
    const rejected = recognition && this.recognitionCount === FakeWorker.rejectRecognition;
    const data = recognition
      ? {
          confidence: 88,
          blocks: [
            {
              paragraphs: [
                { lines: [{ words: [{ text: "010-0000-0000", bbox: { x0: 10, y0: 10, x1: 180, y1: 30 } }] }] },
              ],
            },
          ],
        }
      : {};
    if (this.respond)
      queueMicrotask(() =>
        this.onmessage?.({ data: { jobId: packet.jobId, status: rejected ? "reject" : "resolve", data } }),
      );
  }
  terminate() {
    this.terminated = true;
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.rejectRecognition = 0;
});
it("pins local model paths and disables cache throughout initialization", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const reader = new LocalOcr(new AbortController().signal, "https://synthetic.invalid/ocr-assets/");
  await reader.initialize();
  expect(FakeWorker.last.packets.map((p) => p.action)).toEqual(["load", "loadLanguage", "initialize", "setParameters"]);
  expect(FakeWorker.last.packets[1]?.payload).toMatchObject({
    options: { cacheMethod: "none", gzip: false, langPath: "https://synthetic.invalid/ocr-assets" },
  });
  reader.close();
  expect(FakeWorker.last.terminated).toBe(true);
});
it("cancels initialization immediately, before the engine has loaded", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  const reader = new LocalOcr(controller.signal, "https://synthetic.invalid/ocr-assets/");
  FakeWorker.last.respond = false;
  const pending = reader.initialize();
  controller.abort();
  await expect(pending).rejects.toThrow("CANCELLED");
  expect(FakeWorker.last.terminated).toBe(true);
});
it("terminates a stuck engine without disclosing its error text", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  const reader = new LocalOcr(new AbortController().signal, "https://synthetic.invalid/ocr-assets/");
  FakeWorker.last.respond = false;
  const pending = expect(reader.initialize()).rejects.toThrow("OCR_TIMEOUT");
  await vi.advanceTimersByTimeAsync(90_000);
  await pending;
  expect(FakeWorker.last.terminated).toBe(true);
});

function syntheticInput(): Input {
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("document", { baseURI: "https://synthetic.invalid/" });
  vi.mocked(renderPage).mockResolvedValue(new Blob(["synthetic"]));
  return {
    pages: [1, 2].map((number) => ({ number, width: 600, height: 800, boxes: [] })),
    doc: { getPage: async () => ({ cleanup: vi.fn() }) },
  } as unknown as Input;
}
it("replaces prior OCR without duplicating it and preserves PDF text separately", async () => {
  const input = syntheticInput();
  const first = await recognizePages(input, [1], new AbortController().signal, vi.fn());
  const second = await recognizePages(first.input, [1], new AbortController().signal, vi.fn());
  expect(input.pages[0]?.boxes).toHaveLength(0);
  expect(first.input.pages[0]?.boxes).toHaveLength(1);
  expect(second.input.pages[0]?.boxes).toHaveLength(1);
  expect(second.input.pages[0]?.sourceBoxes).toEqual([]);
  expect(second.summary).toEqual({ read: 1, empty: 0, uncertain: 0 });
});
it("does not commit the first page when a later page fails", async () => {
  const input = syntheticInput();
  FakeWorker.rejectRecognition = 2;
  await expect(recognizePages(input, [1, 2], new AbortController().signal, vi.fn())).rejects.toThrow("OCR_FAILED");
  expect(input.pages.every((page) => !page.ocr && page.boxes.length === 0)).toBe(true);
  expect(FakeWorker.last.terminated).toBe(true);
});
it("honors cancellation at the final progress boundary", async () => {
  const input = syntheticInput();
  const controller = new AbortController();
  await expect(recognizePages(input, [1], controller.signal, () => controller.abort())).rejects.toThrow("CANCELLED");
  expect(input.pages[0]?.ocr).toBeUndefined();
});
