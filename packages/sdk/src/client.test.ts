// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// SDK contract tests against the mock host (packages/sdk/AGENTS.md: BRG-002~009, MOD-006/007, VER-006).
import { describe, expect, it, vi } from "vitest";
import { connect } from "./client.ts";
import { DeckCallError, PROTOCOL_VERSION, SDK_VERSION } from "./protocol.ts";
import { createMockHost } from "./testing.ts";

const quietLogger = () => ({ warn: vi.fn(), debug: vi.fn() });

async function rejection(p: Promise<unknown>): Promise<DeckCallError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DeckCallError) return e;
    throw e;
  }
  throw new Error("expected rejection");
}

describe("handshake (BRG-003, BRG-008, VER-006)", () => {
  it("sends hello first and resolves on init", async () => {
    const host = createMockHost({ module: { id: "timer", version: "0.1.0" }, granted: ["storage"] });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    expect(host.received[0]).toMatchObject({ deck: PROTOCOL_VERSION, kind: "hello", sdk: SDK_VERSION });
    expect(deck.module).toEqual({ id: "timer", version: "0.1.0" });
    expect(deck.sdk).toEqual({ version: SDK_VERSION, protocol: PROTOCOL_VERSION });
    deck.dispose();
  });

  it("rejects with TIMEOUT when the shell never sends init", async () => {
    const host = createMockHost({ answerHello: false });
    const err = await rejection(connect({ window: host.window, initTimeoutMs: 20, logger: quietLogger() }));
    expect(err.code).toBe("TIMEOUT");
  });

  it("every message carries the protocol version", async () => {
    const host = createMockHost({ granted: ["storage"], handlers: { "storage.keys": () => [] } });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    await deck.storage.keys();
    expect(host.received.every((m) => m.deck === PROTOCOL_VERSION)).toBe(true);
    deck.dispose();
  });
});

describe("origin checks (BRG-002)", () => {
  it("ignores init from a foreign origin or a non-parent source", async () => {
    const host = createMockHost({ answerHello: false });
    const pending = connect({ window: host.window, initTimeoutMs: 50, logger: quietLogger() });
    const init = {
      deck: 1,
      kind: "init",
      module: { id: "evil", version: "1.0.0" },
      host: { app: "0", caps: {} },
      granted: ["fs"],
      theme: { mode: "light", mica: false, tokens: {} },
    };
    host.deliverRaw(init, "http://evil.example", host.window.parent);
    host.deliverRaw(init, "http://tauri.localhost", {});
    expect((await rejection(pending)).code).toBe("TIMEOUT");
  });

  it("ignores responses that do not come from the shell", async () => {
    const host = createMockHost({ granted: ["storage"], handlers: { "storage.get": () => 1 } });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    const p = deck.storage.get("k");
    await host.flush();
    const req = host.received.find((m) => m.kind === "req");
    if (req?.kind !== "req") throw new Error("no req");
    host.deliverRaw({ deck: 1, kind: "res", id: req.id, ok: true, result: "forged" }, "http://deckmod.localhost", host.window.parent);
    expect(await p).toBe(1);
    deck.dispose();
  });
});

describe("requests (BRG-004, BRG-005, BRG-007)", () => {
  it("uses unique UUID ids and maps typed helpers to cap/method", async () => {
    const host = createMockHost({
      granted: ["storage", "window"],
      handlers: { "storage.set": () => null, "window.setFullscreen": () => null },
    });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    await deck.storage.set("a", { b: 1 });
    await deck.window.setFullscreen(true);
    expect(host.requests).toEqual([
      { cap: "storage", method: "set", args: { key: "a", value: { b: 1 } } },
      { cap: "window", method: "setFullscreen", args: { value: true } },
    ]);
    const ids = host.received.flatMap((m) => (m.kind === "req" ? [m.id] : []));
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    deck.dispose();
  });

  it("times out regular methods but not long ones", async () => {
    const never = () => new Promise(() => undefined);
    const host = createMockHost({ granted: ["storage", "fs"], handlers: { "storage.get": never, "fs.pickFiles": never } });
    const deck = await connect({ window: host.window, timeoutMs: 20, logger: quietLogger() });
    expect((await rejection(deck.storage.get("k"))).code).toBe("TIMEOUT");
    const long = deck.fs.pickFiles();
    const outcome = await Promise.race([long.then(() => "settled"), new Promise((r) => setTimeout(() => r("pending"), 60))]);
    expect(outcome).toBe("pending");
    deck.dispose();
  });

  it("cancels with the same id and rejects CANCELLED", async () => {
    const host = createMockHost({ granted: ["fs"], handlers: { "fs.pickFiles": () => new Promise(() => undefined) } });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    const ac = new AbortController();
    const p = deck.call("fs", "pickFiles", {}, { signal: ac.signal });
    ac.abort();
    expect((await rejection(p)).code).toBe("CANCELLED");
    await host.flush();
    const req = host.received.find((m) => m.kind === "req");
    const cancel = host.received.find((m) => m.kind === "cancel");
    expect(cancel?.kind === "cancel" && req?.kind === "req" && cancel.id === req.id).toBe(true);
    deck.dispose();
  });

  it("rejects messages over 1MB without sending them", async () => {
    const host = createMockHost({ granted: ["storage"], handlers: { "storage.set": () => null } });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    const err = await rejection(deck.storage.set("big", "x".repeat(1024 * 1024)));
    expect(err.code).toBe("INVALID_ARGS");
    expect(host.requests).toHaveLength(0);
    deck.dispose();
  });

  it("passes host errors through", async () => {
    const host = createMockHost({
      granted: ["fs"],
      handlers: {
        "fs.stat": () => {
          throw new DeckCallError("NOT_FOUND", "없어요");
        },
      },
    });
    const deck = await connect({ window: host.window, logger: quietLogger() });
    expect((await rejection(deck.fs.stat("h_x"))).code).toBe("NOT_FOUND");
    deck.dispose();
  });
});

describe("permissions (MOD-006, MOD-007)", () => {
  it("rejects undeclared caps immediately without a request", async () => {
    const logger = quietLogger();
    const host = createMockHost({ granted: ["storage"] });
    const deck = await connect({ window: host.window, logger });
    const err = await rejection(deck.fs.pickFiles());
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.message).toContain("[MOD-006]");
    expect(host.requests).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[MOD-007]"));
    deck.dispose();
  });

  it("reports caps the app does not have as unavailable, without warning after has()", async () => {
    const logger = quietLogger();
    const host = createMockHost({ granted: [] });
    const deck = await connect({ window: host.window, logger });
    expect(deck.has("ocr")).toBe(false);
    expect((await rejection(deck.call("ocr", "read"))).code).toBe("CAPABILITY_UNAVAILABLE");
    expect(logger.warn).not.toHaveBeenCalled();
    expect(deck.version("storage")).toBe("1.0.0");
    expect(deck.version("ocr")).toBeNull();
    deck.dispose();
  });
});

describe("events (BRG-006, BRG-009)", () => {
  it("delivers events and updates the theme", async () => {
    const host = createMockHost();
    const deck = await connect({ window: host.window, logger: quietLogger() });
    const seen: boolean[] = [];
    const off = deck.on("module.visibility", (p) => seen.push(p.visible));
    host.emit("module.visibility", { visible: false });
    host.emit("theme.changed", { mode: "dark", mica: true, tokens: { colorNeutralBackground1: "#000" } });
    off();
    host.emit("module.visibility", { visible: true });
    expect(seen).toEqual([false]);
    expect(deck.theme.mode).toBe("dark");
    deck.dispose();
  });

  it("ignores malformed and unknown messages", async () => {
    const logger = quietLogger();
    const host = createMockHost();
    const deck = await connect({ window: host.window, logger });
    host.deliverRaw({ deck: 1, kind: "bogus" }, "http://tauri.localhost", host.window.parent);
    host.deliverRaw("not an object", "http://tauri.localhost", host.window.parent);
    host.deliverRaw({ deck: 2, kind: "evt", topic: "x", payload: 1 }, "http://tauri.localhost", host.window.parent);
    expect(logger.debug).toHaveBeenCalled();
    deck.dispose();
  });
});
