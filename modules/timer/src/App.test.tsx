// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider, createDeckTheme } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function open() {
  const fullscreen = vi.fn();
  const host = createMockHost({
    granted: ["storage", "window"],
    handlers: {
      "storage.get": () => null,
      "window.setFullscreen": fullscreen,
    },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider theme={createDeckTheme("light")}>
      <App deck={deck} />
    </DeckProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { fullscreen };
}
describe("timer keyboard and monotonic time", () => {
  it("keeps focused button Space native and ignores repeats and composition", async () => {
    await open();
    const reset = screen.getByRole("button", { name: "리셋" });
    const nativeSpace = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    fireEvent(reset, nativeSpace);
    expect(nativeSpace.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space", repeat: true });
    fireEvent.keyDown(window, { code: "Space", isComposing: true });
    expect(screen.getByRole("button", { name: "시작" })).toBeTruthy();
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByRole("button", { name: "일시정지" })).toBeTruthy();
  });
  it("does not reset or enter presentation when typing or using modified shortcuts", async () => {
    const { fullscreen } = await open();
    const input = screen.getByRole("spinbutton");
    fireEvent.keyDown(input, { key: "f" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    fireEvent.keyDown(window, { key: "f", repeat: true });
    expect(fullscreen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "f" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fullscreen).toHaveBeenCalledExactlyOnceWith({ value: true });
  });
  it("exits presentation with Escape while a control is focused", async () => {
    const { fullscreen } = await open();
    fireEvent.keyDown(window, { key: "f" });
    await act(async () => {
      await Promise.resolve();
    });
    const reset = screen.getByRole("button", { name: "리셋" });
    reset.focus();
    fireEvent.keyDown(reset, { key: "Escape", repeat: true });
    fireEvent.keyDown(reset, { key: "Escape", isComposing: true });
    expect(fullscreen).toHaveBeenCalledExactlyOnceWith({ value: true });
    fireEvent.keyDown(reset, { key: "Escape" });
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
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
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
