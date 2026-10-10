// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowControls } from "./host.ts";
import { TitleBar } from "./TitleBar.tsx";

afterEach(cleanup);

function fakeControls(maximized = false) {
  let resized: (() => void) | undefined;
  const state = { maximized };
  const controls: WindowControls = {
    minimize: vi.fn(() => Promise.resolve()),
    toggleMaximize: vi.fn(() => {
      state.maximized = !state.maximized;
      resized?.();
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
    isMaximized: vi.fn(() => Promise.resolve(state.maximized)),
    onResized: vi.fn((fn: () => void) => {
      resized = fn;
      return Promise.resolve(() => undefined);
    }),
  };
  return controls;
}

describe("TitleBar", () => {
  it("has a drag region and the three caption buttons", () => {
    const { container } = render(<TitleBar title="TeacherDeck" controls={fakeControls()} />);
    expect(container.querySelector('[data-tauri-drag-region="deep"]')?.textContent).toBe("TeacherDeck");
    for (const name of ["최소화", "최대화", "닫기"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("calls the window controls", async () => {
    const c = fakeControls();
    render(<TitleBar title="TeacherDeck" controls={c} />);
    fireEvent.click(screen.getByRole("button", { name: "최소화" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(c.minimize).toHaveBeenCalledOnce();
    expect(c.close).toHaveBeenCalledOnce();
  });

  it("switches the maximize button to restore after maximizing", async () => {
    const c = fakeControls();
    render(<TitleBar title="TeacherDeck" controls={c} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "최대화" }));
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "이전 크기로 복원" })).toBeTruthy();
  });
});
