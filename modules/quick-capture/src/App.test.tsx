// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { DeckCallError, connect, type CaptureSession } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider, createDeckTheme } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { defaults } from "./logic.ts";
afterEach(() => cleanup());
async function open(
  active = false,
  nativeBusy = false,
  options: {
    destinationError?: "BUSY" | "PERMISSION_DENIED";
    cancelPick?: boolean;
    shortcutSucceeds?: boolean;
    failOverlay?: boolean;
  } = {},
) {
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
        busy: nativeBusy,
      }
    : null;
  let destinationError = options.destinationError;
  let shortcutSucceeds = options.shortcutSucceeds ?? false;
  let currentShortcut = { shortcutHandle: "shortcut", modifiers: ["alt"] as ("alt" | "control" | "shift")[], key: "G" };
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
      "fs.pickDestination": () =>
        options.cancelPick
          ? null
          : { grantHandle: "new-grant", label: "새 합성 폴더", persistent: true, available: true },
      "capture.status": () => session,
      "overlay.status": () => ({
        overlayHandle: "overlay",
        rect,
        style: prefs.style,
        visible: true,
        alwaysOnTop: true,
      }),
      "global-shortcut.status": () => currentShortcut,
      "capture.stop": stop,
      "capture.trigger": () => ({
        file: { handle: "result", name: "합성.png", size: 4, mime: "image/png" },
        width: 600,
        height: 400,
        sequence: 1,
      }),
      "capture.update": (args) => {
        const a = args as { settings?: CaptureSession["settings"]; shortcutHandle?: string; destinationGrant?: string };
        if (a.destinationGrant && destinationError) {
          const code = destinationError;
          destinationError = undefined;
          if (session && code === "BUSY") session = { ...session, busy: true };
          throw new DeckCallError(code, "합성 연결 실패");
        }
        if (session)
          session = {
            ...session,
            ...(a.settings ? { settings: a.settings } : {}),
            ...(a.destinationGrant ? { destinationGrant: a.destinationGrant } : {}),
            ...(a.shortcutHandle ? { shortcutHandle: a.shortcutHandle } : {}),
          };
        return session;
      },
      "overlay.update": (args) => {
        if (options.failOverlay) throw { code: "INTERNAL", message: "합성 영역 실패" };
        return {
          overlayHandle: "overlay",
          rect,
          style: (args as { style?: typeof prefs.style }).style ?? prefs.style,
          visible: true,
          alwaysOnTop: true,
        };
      },
      "global-shortcut.replace": (args) => {
        if (!shortcutSucceeds) throw { code: "BUSY", message: "synthetic conflict" };
        currentShortcut = {
          shortcutHandle: "shortcut",
          ...(args as { modifiers: typeof currentShortcut.modifiers; key: string }),
        };
        return currentShortcut;
      },
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: active ? "Alt + G" : "영역 띄우고 시작" }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  return {
    deck,
    view,
    save,
    stop,
    host,
    nativeSession: () => session,
    allowShortcut: () => {
      shortcutSucceeds = true;
    },
    endBusy: () => {
      if (session) session = { ...session, busy: false };
    },
    endNative: () => {
      session = null;
    },
  };
}
describe("capture settings lifecycle", () => {
  it("handles missing remembered destination and flushes edits without stopping on unmount", async () => {
    const { deck, view, save, stop } = await open();
    fireEvent.click(screen.getByRole("button", { name: "고급 설정" }));
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
    expect(screen.getByRole("button", { name: "Alt + G" })).toBeTruthy();
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

it("records physical key codes and attempts a conflicting shortcut only once", async () => {
  const { deck, host, view } = await open(true);
  fireEvent.click(screen.getByRole("button", { name: "Alt + G" }));
  fireEvent.keyDown(window, { code: "KeyC", key: "ㅊ", ctrlKey: true, shiftKey: true });
  await waitFor(() =>
    expect(host.requests.filter((r) => r.cap === "global-shortcut" && r.method === "replace")).toHaveLength(1),
  );
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(host.requests.filter((r) => r.cap === "global-shortcut" && r.method === "replace")).toHaveLength(1);
  expect(screen.getByText(/기존 단축키를 유지해요/)).toBeTruthy();
  view.unmount();
  deck.dispose();
});
it("applies color automatically and does not loop when native state matches", async () => {
  const { deck, host, view } = await open(true);
  fireEvent.input(screen.getByLabelText("테두리 색"), {
    target: { value: createDeckTheme("dark").colorPaletteRedBorderActive },
  });
  await waitFor(() =>
    expect(host.requests.filter((r) => r.cap === "overlay" && r.method === "update")).toHaveLength(1),
  );
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(host.requests.filter((r) => r.cap === "overlay" && r.method === "update")).toHaveLength(1);
  view.unmount();
  deck.dispose();
});

it("queues settings edited during a native capture and applies after completion", async () => {
  const { deck, host, view, endBusy } = await open(true, true);
  fireEvent.input(screen.getByLabelText("테두리 색"), {
    target: { value: createDeckTheme("dark").colorPaletteRedBorderActive },
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(host.requests.filter((r) => r.method === "update" && r.cap === "overlay")).toHaveLength(0);
  endBusy();
  await waitFor(
    () => expect(host.requests.filter((r) => r.method === "update" && r.cap === "overlay")).toHaveLength(1),
    { timeout: 2000 },
  );
  view.unmount();
  deck.dispose();
});
it("does not overwrite a pending color choice with an old native geometry event", async () => {
  const { deck, host, view } = await open(true);
  const color = createDeckTheme("dark").colorPaletteRedBorderActive;
  fireEvent.input(screen.getByLabelText("테두리 색"), { target: { value: color } });
  const prefs = defaults(createDeckTheme("light").colorBrandStroke1);
  host.emit("overlay.changed", {
    overlayHandle: "overlay",
    rect: { x: -650, y: 0, width: 600, height: 400 },
    style: prefs.style,
    visible: true,
    alwaysOnTop: true,
  });
  expect((screen.getByLabelText("테두리 색") as HTMLInputElement).value.toLowerCase()).toBe(color.toLowerCase());
  view.unmount();
  deck.dispose();
});

it("retains a newly selected grant and rebinds once an in-flight capture finishes", async () => {
  const { deck, host, view, endBusy, nativeSession } = await open(true, false, { destinationError: "BUSY" });
  fireEvent.click(screen.getByRole("button", { name: "폴더 선택" }));
  await screen.findByText("새 합성 폴더");
  expect(screen.getByText("캡처가 끝나면 새 저장 폴더를 연결해요.")).toBeTruthy();
  expect(nativeSession()?.destinationGrant).toBe("grant");
  endBusy();
  await waitFor(() => expect(nativeSession()?.destinationGrant).toBe("new-grant"), { timeout: 2000 });
  expect(host.requests.filter((r) => r.cap === "capture" && r.method === "update")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "지금 캡처" }).hasAttribute("disabled")).toBe(false);
  view.unmount();
  deck.dispose();
});
it("keeps a new destination after terminal rebind failure and ends the unusable old session", async () => {
  const { deck, view, stop } = await open(true, false, { destinationError: "PERMISSION_DENIED" });
  fireEvent.click(screen.getByRole("button", { name: "폴더 선택" }));
  await screen.findByText("새 합성 폴더");
  await screen.findByRole("button", { name: "영역 띄우고 시작" });
  expect(stop).toHaveBeenCalledOnce();
  expect(screen.getByText(/새 저장 폴더는 선택했지만/)).toBeTruthy();
  view.unmount();
  deck.dispose();
});
it("cancelling folder selection preserves the active session without mutations", async () => {
  const { deck, host, view, stop } = await open(true, false, { cancelPick: true });
  fireEvent.click(screen.getByRole("button", { name: "폴더 선택" }));
  await waitFor(() => expect(host.requests.some((r) => r.method === "pickDestination")).toBe(true));
  expect(host.requests.some((r) => r.cap === "capture" && r.method === "update")).toBe(false);
  expect(stop).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "지금 캡처" })).toBeTruthy();
  view.unmount();
  deck.dispose();
});
it("retries a formerly conflicting combination when the user explicitly records it again", async () => {
  const { deck, host, view, allowShortcut } = await open(true);
  fireEvent.click(screen.getByRole("button", { name: "Alt + G" }));
  fireEvent.keyDown(window, { code: "KeyC", ctrlKey: true, shiftKey: true });
  await screen.findByText(/기존 단축키를 유지해요/);
  allowShortcut();
  fireEvent.click(screen.getByRole("button", { name: "Ctrl + Shift + C" }));
  fireEvent.keyDown(window, { code: "KeyC", ctrlKey: true, shiftKey: true });
  await waitFor(() =>
    expect(host.requests.filter((r) => r.cap === "global-shortcut" && r.method === "replace")).toHaveLength(2),
  );
  view.unmount();
  deck.dispose();
});

it("resynchronizes the applied native shortcut after a later overlay failure without retry loops", async () => {
  const { deck, host, view } = await open(true, false, { shortcutSucceeds: true, failOverlay: true });
  fireEvent.input(screen.getByLabelText("테두리 색"), {
    target: { value: createDeckTheme("dark").colorPaletteRedBorderActive },
  });
  fireEvent.click(screen.getByRole("button", { name: "Alt + G" }));
  fireEvent.keyDown(window, { code: "KeyC", ctrlKey: true, shiftKey: true });
  await screen.findByText(/설정을 적용하지 못했어요/);
  expect(screen.queryByText("현재 단축키: Alt + G")).toBeNull();
  expect(screen.getByRole("button", { name: "Ctrl + Shift + C" })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(host.requests.filter((r) => r.cap === "overlay" && r.method === "update")).toHaveLength(1);
  view.unmount();
  deck.dispose();
});

it("applies the latest color before immediate manual capture without waiting for debounce", async () => {
  const { deck, host, view } = await open(true);
  const color = createDeckTheme("dark").colorPaletteRedBorderActive;
  fireEvent.input(screen.getByLabelText("테두리 색"), { target: { value: color } });
  fireEvent.click(screen.getByRole("button", { name: "지금 캡처" }));
  await waitFor(() => expect(host.requests.some((r) => r.cap === "capture" && r.method === "trigger")).toBe(true));
  const update = host.requests.findIndex((r) => r.cap === "overlay" && r.method === "update");
  const trigger = host.requests.findIndex((r) => r.cap === "capture" && r.method === "trigger");
  expect(update).toBeGreaterThanOrEqual(0);
  expect(update).toBeLessThan(trigger);
  expect(host.requests[update]?.args).toMatchObject({ style: { borderColor: color } });
  view.unmount();
  deck.dispose();
});
it("does not trigger manual capture when applying the latest settings fails", async () => {
  const { deck, host, view } = await open(true, false, { failOverlay: true });
  fireEvent.input(screen.getByLabelText("테두리 색"), {
    target: { value: createDeckTheme("dark").colorPaletteRedBorderActive },
  });
  fireEvent.click(screen.getByRole("button", { name: "지금 캡처" }));
  await screen.findByText(/작업하지 못했어요/);
  expect(host.requests.some((r) => r.cap === "capture" && r.method === "trigger")).toBe(false);
  view.unmount();
  deck.dispose();
});
