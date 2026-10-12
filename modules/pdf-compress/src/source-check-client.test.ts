// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSourceImagesInWorker, type SourceCheckRequest } from "./source-check-client.ts";

class TestWorker {
  static instances: TestWorker[] = [];
  static failConstruction = false;
  static failPost = false;
  static onConstruct: (() => void) | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  sent: SourceCheckRequest | undefined;
  copy: Uint8Array | undefined;
  constructor() {
    if (TestWorker.failConstruction) throw new Error("synthetic private parser details");
    TestWorker.instances.push(this);
    TestWorker.onConstruct?.();
  }
  postMessage(data: SourceCheckRequest, transfer: Transferable[]) {
    this.copy = data.bytes;
    if (TestWorker.failPost) throw new Error("synthetic private transfer details");
    this.sent = structuredClone(data, { transfer });
  }
  message(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

function worker(): TestWorker {
  const instance = TestWorker.instances.at(-1);
  if (!instance) throw new Error("EXPECTED_WORKER");
  return instance;
}
function expectCleanup(instance: TestWorker, remove: ReturnType<typeof vi.spyOn>) {
  expect(instance.terminate).toHaveBeenCalledExactlyOnceWith();
  expect(instance.onmessage).toBeNull();
  expect(instance.onerror).toBeNull();
  expect(instance.onmessageerror).toBeNull();
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
}

describe("source-check Worker lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestWorker.instances = [];
    TestWorker.failConstruction = false;
    TestWorker.failPost = false;
    TestWorker.onConstruct = undefined;
    vi.stubGlobal("Worker", TestWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("transfers only a copy and keeps the original usable by later PDF readers", async () => {
    const original = new Uint8Array([37, 80, 68, 70]);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(original, 500, controller.signal);
    const instance = worker();
    expect(instance.copy?.byteLength).toBe(0);
    expect(instance.sent?.bytes).toEqual(original);
    expect(instance.sent?.maxPixels).toBe(500);
    instance.message({ ok: true });
    await pending;
    expect(original.byteLength).toBe(4);
    expect(original.slice()).toEqual(new Uint8Array([37, 80, 68, 70]));
    expectCleanup(instance, remove);
    controller.abort();
    expect(instance.terminate).toHaveBeenCalledTimes(1);
  });

  it.each(["SOURCE_IMAGE_TOO_LARGE", "INVALID_PDF"])("keeps the safe %s rejection and cleans up", async (code) => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal);
    worker().message({ ok: false, code });
    await expect(pending).rejects.toThrow(code);
    expectCleanup(worker(), remove);
  });

  it.each([null, { ok: false, code: "synthetic private parser details" }, { kind: "result" }])(
    "rejects an invalid Worker response without exposing its contents",
    async (response) => {
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      const pending = checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal);
      worker().message(response);
      await expect(pending).rejects.toThrow(/^PDF_CHECK_FAILED$/);
      expectCleanup(worker(), remove);
    },
  );

  it("suppresses raw Worker error reporting and cleans up", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal);
    const preventDefault = vi.fn();
    worker().onerror?.({ message: "synthetic private parser details", preventDefault } as unknown as ErrorEvent);
    await expect(pending).rejects.toThrow(/^PDF_CHECK_FAILED$/);
    expect(preventDefault).toHaveBeenCalledOnce();
    expectCleanup(worker(), remove);
  });

  it("cleans up when the response cannot be deserialized", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal);
    worker().onmessageerror?.();
    await expect(pending).rejects.toThrow(/^PDF_CHECK_FAILED$/);
    expectCleanup(worker(), remove);
  });

  it("terminates an active parse immediately on abort and ignores a queued late response", async () => {
    const original = new Uint8Array([1, 2, 3]);
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(original, 500, controller.signal);
    const lateMessage = worker().onmessage;
    controller.abort();
    await expect(pending).rejects.toThrow(/^CANCELLED$/);
    lateMessage?.({ data: { ok: true } } as MessageEvent<unknown>);
    expect(original).toEqual(new Uint8Array([1, 2, 3]));
    expectCleanup(worker(), remove);
  });

  it("enforces the 90 second parse limit and ignores queued callbacks after timeout", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const pending = checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal);
    const lateMessage = worker().onmessage;
    const lateError = worker().onerror;
    vi.advanceTimersByTime(89_999);
    expect(worker().terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await expect(pending).rejects.toThrow(/^PDF_TIMEOUT$/);
    lateMessage?.({ data: { ok: true } } as MessageEvent<unknown>);
    lateError?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
    expectCleanup(worker(), remove);
  });

  it("does not construct a Worker or copy input when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const original = new Uint8Array([1]);
    const copy = vi.spyOn(original, "slice");
    await expect(checkSourceImagesInWorker(original, 500, controller.signal)).rejects.toThrow(/^CANCELLED$/);
    expect(TestWorker.instances).toHaveLength(0);
    expect(copy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles abort during Worker construction without starting a parse", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    TestWorker.onConstruct = () => controller.abort();
    await expect(checkSourceImagesInWorker(new Uint8Array([1]), 500, controller.signal)).rejects.toThrow(/^CANCELLED$/);
    expect(worker().sent).toBeUndefined();
    expectCleanup(worker(), remove);
  });

  it("handles missing or failed Worker initialization with a safe error", async () => {
    const signal = new AbortController().signal;
    TestWorker.failConstruction = true;
    await expect(checkSourceImagesInWorker(new Uint8Array([1]), 500, signal)).rejects.toThrow(/^PDF_CHECK_FAILED$/);
    vi.stubGlobal("Worker", undefined);
    await expect(checkSourceImagesInWorker(new Uint8Array([1]), 500, signal)).rejects.toThrow(/^PDF_CHECK_FAILED$/);
    expect(TestWorker.instances).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("zeroes an untransferred copy and preserves the original when postMessage fails", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const original = new Uint8Array([1, 2, 3]);
    TestWorker.failPost = true;
    await expect(checkSourceImagesInWorker(original, 500, controller.signal)).rejects.toThrow(/^PDF_CHECK_FAILED$/);
    expect(worker().copy).toEqual(new Uint8Array(3));
    expect(original).toEqual(new Uint8Array([1, 2, 3]));
    expectCleanup(worker(), remove);
  });
});
