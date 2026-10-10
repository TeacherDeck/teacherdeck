// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell bridge rules: BRG-001 (origin + iframe mapping), BRG-003 (hello timeout), BRG-006, BRG-007,
// cancel → exactly one res (BRG-004/005). Plus keepAlive LRU (modules.md §3).
import type { InitPayload } from "@deck/sdk";
import { describe, expect, it, vi } from "vitest";
import { KeepAliveSet } from "./keepAlive.ts";
import { type BridgeHost, type FrameWindow, ModuleBridge, moduleEntryOrigin } from "./ModuleBridge.ts";

const ORIGIN = "http://deckmod.timer.modules.localhost";
const ENTRY = `${ORIGIN}/timer/0.1.0/index.html`;

function setup(overrides: Partial<BridgeHost> = {}, helloTimeoutMs = 1000) {
  const init = (id: string): Promise<InitPayload> =>
    Promise.resolve({
      module: { id, version: "0.1.0" },
      host: { app: "0.0.0", caps: { storage: "1.0.0" } },
      granted: ["storage"],
      theme: { mode: "light", mica: false, tokens: {} },
    });
  const host: BridgeHost = {
    init,
    invoke: vi.fn(async () => "ok"),
    onLoadError: vi.fn(),
    debug: vi.fn(),
    ...overrides,
  };
  const bridge = new ModuleBridge(host, helloTimeoutMs);
  const frame = (): FrameWindow & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return { sent, postMessage: (m) => sent.push(m) };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { bridge, host, frame, tick };
}

const hello = { deck: 1, kind: "hello", sdk: "0.1.0" };
const req = (id: string, args: unknown = {}) => ({ deck: 1, kind: "req", id, cap: "storage", method: "get", args });

describe("BRG-001", () => {
  it("uses each frame's exact origin and targetOrigin", async () => {
    const { bridge, host, tick } = setup();
    const timer = { postMessage: vi.fn() };
    const meeting = { postMessage: vi.fn() };
    const meetingOrigin = "http://deckmod.meeting-note.modules.localhost";
    bridge.register(timer, "timer", ENTRY);
    bridge.register(meeting, "meeting-note", `${meetingOrigin}/meeting-note/0.1.0/index.html`);
    bridge.handle({ data: hello, origin: meetingOrigin, source: timer });
    bridge.handle({ data: hello, origin: ORIGIN, source: meeting });
    await tick();
    expect(timer.postMessage).not.toHaveBeenCalled();
    expect(meeting.postMessage).not.toHaveBeenCalled();
    bridge.handle({ data: hello, origin: ORIGIN, source: timer });
    bridge.handle({ data: hello, origin: meetingOrigin, source: meeting });
    await tick();
    expect(timer.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), ORIGIN);
    expect(meeting.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), meetingOrigin);
    bridge.handle({ data: req("foreign"), origin: meetingOrigin, source: timer });
    expect(host.invoke).not.toHaveBeenCalled();
  });

  it("rejects entry authorities and module/path mismatches before registration", () => {
    const { bridge, host, frame } = setup();
    for (const entry of [
      "http://deckmod.localhost/timer/0.1.0/index.html",
      `${ORIGIN}:80/timer/0.1.0/index.html`,
      `${ORIGIN}/meeting-note/0.1.0/index.html`,
      "http://deckmod.timer.modules.localhost.evil/timer/0.1.0/index.html",
      "http://user@deckmod.timer.modules.localhost/timer/0.1.0/index.html",
      "http://deckmod.extra.timer.modules.localhost/timer/0.1.0/index.html",
    ]) {
      expect(moduleEntryOrigin("timer", entry)).toBeNull();
      bridge.register(frame(), "timer", entry);
    }
    expect(host.onLoadError).toHaveBeenCalledTimes(6);
  });

  it("drops a late init after the frame unloads", async () => {
    let finish: (init: InitPayload) => void = () => undefined;
    const { bridge, frame, tick } = setup({
      init: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const f = frame();
    bridge.register(f, "timer", ENTRY);
    bridge.handle({ data: hello, origin: ORIGIN, source: f });
    bridge.unregister(f);
    finish({
      module: { id: "timer", version: "0.1.0" },
      host: { app: "0.1.0", caps: {} },
      granted: [],
      theme: { mode: "light", mica: false, tokens: {} },
    });
    await tick();
    expect(f.sent).toEqual([]);
  });
  it("answers only known iframes from the module origin", async () => {
    const { bridge, frame, tick } = setup();
    const known = frame();
    const unknown = frame();
    bridge.register(known, "timer", ENTRY);
    bridge.handle({ data: hello, origin: "http://evil.example", source: known });
    bridge.handle({ data: hello, origin: ORIGIN, source: unknown });
    await tick();
    expect(known.sent).toEqual([]);
    expect(unknown.sent).toEqual([]);
    bridge.handle({ data: hello, origin: ORIGIN, source: known });
    await tick();
    expect(known.sent[0]).toMatchObject({ kind: "init", module: { id: "timer" } });
  });

  it("identifies the module by its iframe, not by message content", async () => {
    const { bridge, host, frame, tick } = setup();
    const f = frame();
    bridge.register(f, "timer", ENTRY);
    bridge.handle({ data: hello, origin: ORIGIN, source: f });
    await tick();
    bridge.handle({ data: { ...req("1"), moduleId: "seat-plan" }, origin: ORIGIN, source: f });
    await tick();
    expect(host.invoke).toHaveBeenCalledWith("timer", "storage", "get", {});
  });
});

describe("BRG-003", () => {
  it("reports a load error when hello does not arrive in time", async () => {
    const { bridge, host, frame } = setup({}, 10);
    bridge.register(frame(), "timer", ENTRY);
    await new Promise((r) => setTimeout(r, 30));
    expect(host.onLoadError).toHaveBeenCalledWith("timer");
  });

  it("rejects requests sent before init", async () => {
    const { bridge, host, frame, tick } = setup();
    const f = frame();
    bridge.register(f, "timer", ENTRY);
    bridge.handle({ data: req("1"), origin: ORIGIN, source: f });
    await tick();
    expect(host.invoke).not.toHaveBeenCalled();
    expect(f.sent[0]).toMatchObject({ kind: "res", id: "1", ok: false, error: { code: "PERMISSION_DENIED" } });
  });
});

describe("requests", () => {
  async function ready() {
    const s = setup();
    const f = s.frame();
    s.bridge.register(f, "timer", ENTRY);
    s.bridge.handle({ data: hello, origin: ORIGIN, source: f });
    await s.tick();
    f.sent.length = 0;
    return { ...s, f };
  }

  it("forwards and answers exactly once", async () => {
    const { bridge, f, tick } = await ready();
    bridge.handle({ data: req("a"), origin: ORIGIN, source: f });
    await tick();
    expect(f.sent).toEqual([{ deck: 1, kind: "res", id: "a", ok: true, result: "ok" }]);
  });

  it("passes host errors through as DeckError", async () => {
    const { bridge, f, tick, host } = await ready();
    vi.mocked(host.invoke).mockRejectedValueOnce({ code: "PERMISSION_DENIED", message: "[MOD-006] 선언하지 않은 캡" });
    bridge.handle({ data: req("b"), origin: ORIGIN, source: f });
    await tick();
    expect(f.sent[0]).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
  });

  it("rejects oversized requests (BRG-007)", async () => {
    const { bridge, f, tick, host } = await ready();
    bridge.handle({ data: req("c", "x".repeat(1024 * 1024)), origin: ORIGIN, source: f });
    await tick();
    expect(host.invoke).not.toHaveBeenCalled();
    expect(f.sent[0]).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  });

  it("answers cancel with CANCELLED and drops the late result (BRG-005)", async () => {
    let finish: (v: unknown) => void = () => undefined;
    const { bridge, f, tick, host } = await ready();
    vi.mocked(host.invoke).mockImplementationOnce(() => new Promise((r) => (finish = r)));
    bridge.handle({ data: req("d"), origin: ORIGIN, source: f });
    bridge.handle({ data: { deck: 1, kind: "cancel", id: "d" }, origin: ORIGIN, source: f });
    finish("late");
    await tick();
    expect(f.sent).toEqual([
      { deck: 1, kind: "res", id: "d", ok: false, error: { code: "CANCELLED", message: "취소했어요." } },
    ]);
  });

  it("drops an in-flight response after unload even when the same window is re-registered", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { bridge, f, tick, host } = await ready();
    vi.mocked(host.invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    bridge.handle({ data: req("old"), origin: ORIGIN, source: f });
    bridge.unregister(f);
    bridge.register(f, "timer", ENTRY);
    finish("old-result");
    await tick();
    expect(f.sent).toEqual([]);
    bridge.unregister(f);
  });

  it("ignores malformed and unexpected kinds (BRG-006)", async () => {
    const { bridge, f, tick, host } = await ready();
    bridge.handle({ data: { deck: 1, kind: "init" }, origin: ORIGIN, source: f });
    bridge.handle({ data: { deck: 1, kind: "res", id: "x", ok: true, result: 1 }, origin: ORIGIN, source: f });
    await tick();
    expect(f.sent).toEqual([]);
    expect(host.debug).toHaveBeenCalled();
  });

  it("sends events only to ready frames of the target module", async () => {
    const { bridge, f } = await ready();
    bridge.sendEvent("timer", "module.visibility", { visible: false });
    bridge.sendEvent("other", "module.visibility", { visible: false });
    expect(f.sent).toEqual([{ deck: 1, kind: "evt", topic: "module.visibility", payload: { visible: false } }]);
  });
});

describe("keepAlive LRU", () => {
  const keep = (id: string) => id !== "plain";

  it("keeps up to three hidden keepAlive modules and evicts the oldest", () => {
    const k = new KeepAliveSet(3);
    for (const id of ["a", "b", "c", "d"]) k.activate(id, keep);
    const r = k.activate("e", keep);
    expect(r.mounted).toEqual(["e", "d", "c", "b"]);
    expect(r.evicted).toEqual(["a"]);
  });

  it("unloads modules without keepAlive when leaving them", () => {
    const k = new KeepAliveSet();
    k.activate("plain", keep);
    const r = k.activate(null, keep);
    expect(r).toEqual({ mounted: [], evicted: ["plain"] });
  });

  it("re-activating a hidden module moves it to the front", () => {
    const k = new KeepAliveSet();
    k.activate("a", keep);
    k.activate("b", keep);
    expect(k.activate("a", keep).mounted).toEqual(["a", "b"]);
  });
});

// Native capture metadata follows the exact owner mapping even when another tool is foreground.
it("delivers capture events only to the live owning frame and drops unloaded owners", async () => {
  const { bridge, frame, tick } = setup();
  const owner = frame(),
    other = frame();
  const captureOrigin = "http://deckmod.quick-capture.modules.localhost";
  bridge.register(owner, "quick-capture", `${captureOrigin}/quick-capture/0.1.0/index.html`);
  bridge.register(other, "timer", ENTRY);
  bridge.handle({ data: hello, origin: captureOrigin, source: owner });
  bridge.handle({ data: hello, origin: ORIGIN, source: other });
  await tick();
  const result = {
    file: { handle: "result", name: "synthetic.png", ext: "png", size: 4, modifiedAt: 0 },
    width: 10,
    height: 10,
    sequence: 1,
  };
  bridge.sendEvent("quick-capture", "capture.completed", { sessionHandle: "owned-session", result });
  expect(owner.sent).toHaveLength(2);
  expect(other.sent).toHaveLength(1);
  expect(owner.sent[1]).toMatchObject({
    kind: "evt",
    topic: "capture.completed",
    payload: { sessionHandle: "owned-session" },
  });
  bridge.unregister(owner);
  bridge.sendEvent("quick-capture", "capture.completed", { sessionHandle: "owned-session", result });
  expect(owner.sent).toHaveLength(2);
  expect(other.sent).toHaveLength(1);
  bridge.unregister(other);
});
