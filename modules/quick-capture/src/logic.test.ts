// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { createDeckTheme } from "@deck/ui";
import { connect, type OverlayInfo } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { defaults, initialRect, restorePreferences, startCapture, validatePreferences } from "./logic.ts";
const border = createDeckTheme("light").colorBrandStroke1;
const rect = { x: -600, y: 10, width: 600, height: 400 };
const overlay: OverlayInfo = {
  overlayHandle: "overlay",
  rect,
  style: { borderColor: border, borderWidth: defaults(border).style.borderWidth },
  visible: true,
  alwaysOnTop: true,
};
describe("capture preferences", () => {
  it("preserves 80 Unicode code points in a custom prefix across reopening", () => {
    const p = defaults(border);
    p.settings.naming = { mode: "custom", prefix: "🧪".repeat(80) };
    const restored = restorePreferences(p, border);
    expect(restored.settings.naming.prefix).toBe(p.settings.naming.prefix);
    expect(() => validatePreferences(restored)).not.toThrow();
  });
  it("repairs non-finite persisted numeric settings", () => {
    const p = defaults(border);
    p.settings.quality = NaN;
    p.style.borderWidth = Infinity;
    const restored = restorePreferences(p, border);
    expect(restored.settings.quality).toBe(95);
    expect(restored.style.borderWidth).toBe(defaults(border).style.borderWidth);
  });
  it("rejects invalid custom names, empty modifiers and overflow before native work", () => {
    const p = defaults(border);
    p.shortcut.modifiers = [];
    expect(() => validatePreferences(p)).toThrow();
    p.shortcut = defaults(border).shortcut;
    p.settings.naming = { mode: "custom", prefix: "NUL.txt" };
    expect(() => validatePreferences(p)).toThrow();
    p.settings.naming = { mode: "numbered" };
    p.rect = { ...rect, x: 2147483647 };
    expect(() => validatePreferences(p)).toThrow();
  });
  it("keeps mixed-DPI crossing physical coordinates and recovers disconnected areas", () => {
    const displays = [
      { displayHandle: "left", bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scale: 1.25, primary: true },
      { displayHandle: "right", bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scale: 2, primary: false },
    ];
    const crossing = { ...rect, width: 900 };
    expect(initialRect(displays, crossing)).toEqual(crossing);
    expect(initialRect(displays, { ...rect, x: 9000 }).x).toBe(-1260);
  });
});
describe("native resource lifecycle", () => {
  it("rolls back shortcut then overlay when arm fails", async () => {
    const close = vi.fn(),
      unregister = vi.fn();
    const host = createMockHost({
      granted: ["capture", "overlay", "global-shortcut"],
      handlers: {
        "capture.displays": () => [{ displayHandle: "display", bounds: rect, scale: 1, primary: true }],
        "overlay.create": () => overlay,
        "global-shortcut.register": () => ({ shortcutHandle: "shortcut" }),
        "capture.arm": () => {
          throw new Error("synthetic");
        },
        "global-shortcut.unregister": unregister,
        "overlay.close": close,
      },
    });
    const deck = await connect({ window: host.window });
    await expect(startCapture(deck, defaults(border), "grant")).rejects.toThrow();
    expect(unregister).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(host.requests.slice(-2).map((r) => r.method)).toEqual(["unregister", "close"]);
    deck.dispose();
  });
  it("invalid modifier edits allocate no overlay", async () => {
    const host = createMockHost({ granted: ["capture", "overlay", "global-shortcut"] });
    const deck = await connect({ window: host.window });
    const p = defaults(border);
    p.shortcut.modifiers = [];
    await expect(startCapture(deck, p, "grant")).rejects.toThrow();
    expect(host.requests).toEqual([]);
    deck.dispose();
  });
});
