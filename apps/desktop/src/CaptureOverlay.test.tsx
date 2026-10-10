// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OverlayUiState } from "@deck/sdk";
import { createDeckTheme } from "@deck/ui";
import type { OverlayControls } from "./host.ts";
import { CaptureOverlay } from "./CaptureOverlay.tsx";
const state: OverlayUiState = {
  toolbar: false,
  overlay: {
    overlayHandle: "overlay-test",
    rect: { x: -800, y: 0, width: 600, height: 400 },
    style: {
      borderColor: createDeckTheme("light").colorBrandStroke1,
      borderWidth: Number.parseInt(createDeckTheme("light").strokeWidthThick, 10),
    },
    visible: true,
    alwaysOnTop: true,
  },
  session: {
    sessionHandle: "session-test",
    overlayHandle: "overlay-test",
    destinationGrant: "destination-test",
    settings: { format: "png", quality: 95, cursor: false, naming: { mode: "numbered" } },
    sequence: 0,
    busy: false,
  },
};
function setup(toolbar = false) {
  let callback: (s: OverlayUiState) => void = () => undefined;
  const off = vi.fn();
  const controls: OverlayControls = {
    state: vi.fn(async () => ({ ...state, toolbar })),
    action: vi.fn(async () => undefined),
    drag: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    onState: vi.fn(async (fn) => {
      callback = fn;
      return off;
    }),
  };
  return { controls, off, emit: (s: OverlayUiState) => act(() => callback(s)) };
}
afterEach(cleanup);
describe("capture overlay shell", () => {
  it("double click and Enter each trigger a single capture without a module or session argument", async () => {
    const { controls } = setup();
    render(<CaptureOverlay controls={controls} />);
    const region = await screen.findByRole("button", { name: /캡처 영역/ });
    fireEvent.doubleClick(region);
    fireEvent.keyDown(region, { key: "Enter" });
    expect(controls.action).toHaveBeenNthCalledWith(1, "capture");
    expect(controls.action).toHaveBeenNthCalledWith(2, "capture");
    expect(controls.drag).not.toHaveBeenCalled();
  });
  it("single window keeps five toolbar actions and the capture region and disables capture while the host is busy", async () => {
    const { controls, emit } = setup(true);
    render(<CaptureOverlay controls={controls} />);
    const capture = await screen.findByRole("button", { name: "지금 캡처" });
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: /캡처 영역/ })).toBeTruthy();
    expect(document.documentElement.style.background).toBe("transparent");
    expect(document.body.style.background).toBe("transparent");
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    expect(controls.action).toHaveBeenCalledWith("show-settings");
    if (!state.session) throw new Error("Missing synthetic session");
    emit({ ...state, toolbar: true, session: { ...state.session, busy: true } });
    expect((capture as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/캡처 중/)).toBeTruthy();
  });
  it("rounds the toolbar inset to the same physical pixel as the host at custom DPI", async () => {
    const previous = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 1.1, configurable: true });
    try {
      const { controls } = setup();
      render(<CaptureOverlay controls={controls} />);
      const region = await screen.findByRole("button", { name: /캡처 영역/ });
      expect((region as HTMLElement).style.top).toBe(`${40 / 1.1}px`);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: previous, configurable: true });
    }
  });
  it("unsubscribes state changes when window content unmounts", async () => {
    const { controls, off } = setup();
    const view = render(<CaptureOverlay controls={controls} />);
    await screen.findByRole("button", { name: /캡처 영역/ });
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(off).toHaveBeenCalledOnce();
  });
});
