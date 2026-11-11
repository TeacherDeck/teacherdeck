// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider, createDeckTheme } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function open(saved: unknown = null) {
  const values = new Map<string, unknown>([["timer.v1", saved]]);
  const fullscreen = vi.fn();
  const host = createMockHost({
    granted: ["storage", "window"],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "document" }),
      "window.setDocumentState": () => null,
      "window.completeDocumentSave": () => null,
      "storage.set": (args) => {
        const a = args as { key: string; value: unknown };
        values.set(a.key, a.value);
        return null;
      },
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "window.setFullscreen": fullscreen,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider theme={createDeckTheme("light")}>
      <App deck={deck} />
    </DeckProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { fullscreen, host, deck, view, values };
}
describe("timer keyboard and monotonic time", () => {
  it("keeps edited controls in place through blur and starts the edited time on the first click", async () => {
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /눌러서 시간 입력/ }));
    });
    const minutes = screen.getByRole("textbox", { name: /^분$/ });
    fireEvent.change(minutes, { target: { value: "1" } });
    const start = screen.getByRole("button", { name: /^시작$/ });
    fireEvent.pointerDown(start);
    fireEvent.blur(minutes, { relatedTarget: start });
    expect(screen.getByRole("textbox", { name: /^분$/ })).toBeTruthy();
    fireEvent.pointerUp(start);
    await act(async () => {
      fireEvent.click(start);
    });
    expect(screen.getByRole("button", { name: /^일시정지$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /남은 시간 1:00/ })).toBeTruthy();
  });
  it("keeps focused button Space native and ignores repeats and composition", async () => {
    await open();
    const reset = screen.getByRole("button", { name: "리셋" });
    const nativeSpace = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    fireEvent(reset, nativeSpace);
    expect(nativeSpace.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { code: "Space", repeat: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { code: "Space", isComposing: true });
    });
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { code: "Space" });
    });
    expect(screen.getByRole("button", { name: "일시정지" })).toBeTruthy();
  });
  it("does not reset or enter presentation when typing or using modified shortcuts", async () => {
    const { fullscreen } = await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /눌러서 시간 입력/ }));
    });
    const input = screen.getByRole("textbox", { name: "분" });
    await act(async () => {
      fireEvent.keyDown(input, { key: "f" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", repeat: true });
    });
    expect(fullscreen).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fullscreen).toHaveBeenCalledExactlyOnceWith({ value: true });
  });
  it("exits presentation with Escape while a control is focused", async () => {
    const { fullscreen } = await open();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    const reset = screen.getByRole("button", { name: "리셋" });
    reset.focus();
    await act(async () => {
      fireEvent.keyDown(reset, { key: "Escape", repeat: true });
    });
    await act(async () => {
      fireEvent.keyDown(reset, { key: "Escape", isComposing: true });
    });
    expect(fullscreen).toHaveBeenCalledExactlyOnceWith({ value: true });
    await act(async () => {
      fireEvent.keyDown(reset, { key: "Escape" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fullscreen).toHaveBeenNthCalledWith(2, { value: false });
    expect(screen.getByRole("button", { name: "발표 모드" })).toBeTruthy();
  });
  it("ignores backward and forward wall clock corrections and includes delayed elapsed time", async () => {
    let monotonic = 1000;
    let wall = 100000;
    vi.spyOn(performance, "now").mockImplementation(() => monotonic);
    vi.spyOn(Date, "now").mockImplementation(() => wall);
    await open();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "시작" }));
    });
    monotonic += 10000;
    wall -= 1000000;
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("4:50")).toBeTruthy();
    wall += 10000000;
    monotonic += 10000;
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("4:40")).toBeTruthy();
    monotonic += 300000;
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("시간이 끝났어요")).toBeTruthy();
  });
});

it("keeps a running timer dirty, saves a paused remaining time on exit and restores it", async () => {
  let now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const f = await open();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
  });
  expect(f.host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toEqual({
    documentHandle: "document",
    dirty: true,
    saving: false,
  });
  now = 11000;
  await act(async () => {
    f.host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "leave" });
  });
  await waitFor(() =>
    expect(f.host.requests.find((r) => r.method === "completeDocumentSave")?.args).toEqual({
      documentHandle: "document",
      requestId: "leave",
      saved: true,
    }),
  );
  const saved = f.values.get("timer.v1");
  expect(saved).toMatchObject({ status: "paused", elapsedMs: 10000, durationMs: 300000 });
  f.view.unmount();
  f.deck.dispose();
  const next = await open(saved);
  await screen.findByRole("button", { name: /남은 시간 4:50/ });
  expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
  next.view.unmount();
  next.deck.dispose();
});
