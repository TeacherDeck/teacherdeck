// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";
import { applySetup, emptyState, generate, parseRoster } from "./logic.ts";
import { generateInWorker } from "./planner-client.ts";
class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  request: unknown;
  constructor() {
    FakeWorker.current = this;
  }
  postMessage(value: unknown) {
    this.request = value;
  }
  terminate() {
    this.terminated = true;
  }
}
function fixture() {
  let id = 0;
  return applySetup(
    emptyState(),
    parseRoster("1 학생가\n2 학생나", [], () => `s${++id}`),
    [{ id: "j1", title: "자료", capacity: 1 }],
    "합성 역할",
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("role worker boundary", () => {
  it("returns only validated draft and preserves history", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const state = fixture(),
      expected = generate(state, "d1", () => 0),
      promise = generateInWorker(state, "d1", new AbortController().signal);
    FakeWorker.current.onmessage?.({ data: { ok: true, draft: expected.draft } } as MessageEvent);
    expect(await promise).toEqual(expected);
    expect(FakeWorker.current.terminated).toBe(true);
    expect(state.draft).toEqual([]);
  });
  it("terminates on cancel and ignores late result without mutation", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const state = fixture(),
      controller = new AbortController(),
      promise = generateInWorker(state, "d1", controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    FakeWorker.current.onmessage?.({ data: { ok: true, draft: generate(state, "d1", () => 0).draft } } as MessageEvent);
    expect(FakeWorker.current.terminated).toBe(true);
    expect(state.draft).toEqual([]);
  });
  it("rejects worker errors and invalid draft without mutation", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const state = fixture(),
      first = generateInWorker(state, "d1", new AbortController().signal);
    FakeWorker.current.onerror?.();
    await expect(first).rejects.toThrow(/이전 배정/);
    const second = generateInWorker(state, "d2", new AbortController().signal);
    FakeWorker.current.onmessage?.({
      data: { ok: true, draft: [{ studentId: "missing", jobId: "j1" }] },
    } as MessageEvent);
    await expect(second).rejects.toThrow(/조건/);
    expect(state.draft).toEqual([]);
  });
  it("terminates after deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const promise = generateInWorker(fixture(), "d1", new AbortController().signal);
    const check = expect(promise).rejects.toThrow(/시간/);
    await vi.advanceTimersByTimeAsync(30000);
    await check;
    expect(FakeWorker.current.terminated).toBe(true);
  });
});
