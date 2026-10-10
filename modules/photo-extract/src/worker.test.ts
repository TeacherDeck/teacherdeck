// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeArchive } from "./batch.ts";
const terminate = vi.fn();
class StalledWorker {
  onmessage: unknown;
  onerror: unknown;
  postMessage = vi.fn();
  terminate = terminate;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("bounded Worker lifecycle", () => {
  it("terminates archive work immediately when cancelled", async () => {
    vi.stubGlobal("Worker", StalledWorker);
    const abort = new AbortController();
    const pending = decodeArchive(new Uint8Array([80, 75]), abort.signal);
    const assertion = expect(pending).rejects.toThrow("CANCELLED");
    abort.abort();
    await assertion;
    expect(terminate).toHaveBeenCalledOnce();
  });
  it("terminates a stalled worker after 90 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", StalledWorker);
    const pending = decodeArchive(new Uint8Array([80, 75]), new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow("TIMEOUT");
    await vi.advanceTimersByTimeAsync(90000);
    await assertion;
    expect(terminate).toHaveBeenCalledOnce();
  });
});
