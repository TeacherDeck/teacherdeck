// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { connect } from "./client.ts";
import { createMockHost } from "./testing.ts";

const logger = { warn: () => undefined, debug: () => undefined };
const payload = {
  kind: "picker" as const,
  title: "발표자",
  columns: null,
  items: [{ label: "1 학생가", group: null, row: null, column: null }],
};

describe("public presentation window contract", () => {
  it("sends only the typed public snapshot through the granted window capability", async () => {
    const session = { presentationHandle: "p_test", revision: 0 };
    const host = createMockHost({
      granted: ["window"],
      caps: { window: "1.1.0" },
      handlers: {
        "window.listDisplays": () => [],
        "window.openPresentation": () => session,
        "window.updatePresentation": () => ({ ...session, revision: 1 }),
        "window.closePresentation": () => null,
      },
    });
    const deck = await connect({ window: host.window, logger });
    await expect(deck.window.listDisplays()).resolves.toEqual([]);
    await expect(deck.window.openPresentation({ displayHandle: "display", payload })).resolves.toEqual(session);
    await deck.window.updatePresentation({ ...session, revision: 1, payload });
    await deck.window.closePresentation({ presentationHandle: session.presentationHandle });
    expect(host.requests.map(({ method }) => method)).toEqual([
      "listDisplays",
      "openPresentation",
      "updatePresentation",
      "closePresentation",
    ]);
    expect(host.requests[1]?.args).toEqual({ displayHandle: "display", payload });
    deck.dispose();
  });

  it("keeps old window methods usable while rejecting new helpers before any request", async () => {
    const host = createMockHost({
      granted: ["window"],
      caps: { window: "1.0.0" },
      handlers: { "window.setFullscreen": () => null },
    });
    const deck = await connect({ window: host.window, logger });
    await expect(deck.window.listDisplays()).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    await expect(deck.window.openPresentation({ displayHandle: "display", payload })).rejects.toMatchObject({
      code: "VERSION_MISMATCH",
    });
    await deck.window.setFullscreen(true);
    expect(host.requests).toEqual([{ cap: "window", method: "setFullscreen", args: { value: true } }]);
    deck.dispose();
  });

  it("does not let the version helper bypass an undeclared capability", async () => {
    const host = createMockHost({ granted: [], caps: { window: "1.1.0" } });
    const deck = await connect({ window: host.window, logger });
    await expect(deck.window.listDisplays()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(host.requests).toEqual([]);
    deck.dispose();
  });

  it("delivers close and disconnected handles through the typed owner event contract", async () => {
    const host = createMockHost({ granted: ["window"] });
    const deck = await connect({ window: host.window, logger });
    const closed = vi.fn(),
      disconnected = vi.fn();
    deck.on("window.presentationClosed", closed);
    deck.on("window.presentationDisconnected", disconnected);
    host.emit("window.presentationClosed", { presentationHandle: "p_test" });
    host.emit("window.presentationDisconnected", { presentationHandle: "p_other" });
    expect(closed).toHaveBeenCalledExactlyOnceWith({ presentationHandle: "p_test" });
    expect(disconnected).toHaveBeenCalledExactlyOnceWith({ presentationHandle: "p_other" });
    deck.dispose();
  });
});
