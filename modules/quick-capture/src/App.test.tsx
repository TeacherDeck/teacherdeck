// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, type CaptureSession } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider, createDeckTheme } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { defaults } from "./logic.ts";
afterEach(() => cleanup());
async function open(active = false) {
  const prefs = defaults(createDeckTheme("light").colorBrandStroke1);
  const rect = { x: -600, y: 0, width: 600, height: 400 };
  let session: CaptureSession | null = active
    ? {
        sessionHandle: "session",
        overlayHandle: "overlay",
        destinationGrant: "grant",
        shortcutHandle: "shortcut",
        settings: prefs.settings,
        sequence: 0,
        busy: false,
      }
    : null;
  const save = vi.fn(),
    stop = vi.fn(() => {
      session = null;
    });
  const host = createMockHost({
    granted: ["storage", "fs", "capture", "overlay", "global-shortcut"],
    handlers: {
      "storage.get": () => null,
      "storage.set": save,
      "fs.destinationStatus": () => null,
      "capture.status": () => session,
      "overlay.status": () => ({
        overlayHandle: "overlay",
        rect,
        style: prefs.style,
        visible: true,
        alwaysOnTop: true,
      }),
      "global-shortcut.status": () => ({ shortcutHandle: "shortcut", modifiers: ["alt"], key: "G" }),
      "capture.stop": stop,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: active ? "지금 캡처" : "영역 띄우고 시작" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  return {
    deck,
    view,
    save,
    stop,
    host,
    endNative: () => {
      session = null;
    },
  };
}
describe("capture settings lifecycle", () => {
  it("handles missing remembered destination and flushes edits without stopping on unmount", async () => {
    const { deck, view, save, stop } = await open();
    fireEvent.click(screen.getByRole("button", { name: "단축키와 영역 설정" }));
    fireEvent.change(screen.getByLabelText("테두리 색 (#RRGGBB)"), {
      target: { value: createDeckTheme("dark").colorBrandStroke1 },
    });
    view.unmount();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(stop).not.toHaveBeenCalled();
    deck.dispose();
  });
  it("reattaches native session even when destination status is null", async () => {
    const { deck, stop, view } = await open(true);
    expect(screen.getByRole("button", { name: "지금 캡처" })).toBeTruthy();
    expect(screen.getByText(/Alt \+ G ·/)).toBeTruthy();
    view.unmount();
    expect(stop).not.toHaveBeenCalled();
    deck.dispose();
  });
  it("reflects native toolbar stop while settings remain open", async () => {
    const { deck, endNative } = await open(true);
    endNative();
    await screen.findByRole("button", { name: "영역 띄우고 시작" }, { timeout: 2000 });
    deck.dispose();
  });
});

it("persists native physical movement without ending the session", async () => {
  const { deck, host, save, view } = await open(true);
  const prefs = defaults(createDeckTheme("light").colorBrandStroke1);
  const rect = { x: -900, y: 100, width: 800, height: 500 };
  host.emit("overlay.changed", {
    overlayHandle: "overlay",
    rect,
    style: prefs.style,
    visible: true,
    alwaysOnTop: true,
  });
  await waitFor(() =>
    expect(
      save.mock.calls.some(
        ([args]) => JSON.stringify((args as { value: { rect?: unknown } }).value.rect) === JSON.stringify(rect),
      ),
    ).toBe(true),
  );
  view.unmount();
  deck.dispose();
});
