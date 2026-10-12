// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSurface, CurveEditor, DeckProvider, Slider } from "./index.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("editor controls keyboard alternatives", () => {
  it("moves a curve point within its neighbors and keeps endpoints fixed", () => {
    const changed = vi.fn();
    render(
      <DeckProvider>
        <CurveEditor
          header="곡선"
          points={[
            { x: 0, y: 0 },
            { x: 30, y: 40 },
            { x: 31, y: 60 },
            { x: 255, y: 255 },
          ]}
          onChange={changed}
        />
      </DeckProvider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "제어점 2: 입력 30, 출력 40" }), { key: "ArrowRight" });
    expect(changed.mock.calls[0]?.[0]?.[1]).toEqual({ x: 30, y: 40 });
    fireEvent.keyDown(screen.getByRole("button", { name: "제어점 1: 입력 0, 출력 0" }), { key: "ArrowRight" });
    expect(changed.mock.calls[1]?.[0]?.[0]).toEqual({ x: 0, y: 0 });
    fireEvent.keyDown(screen.getByRole("button", { name: "제어점 2: 입력 30, 출력 40" }), {
      key: "ArrowUp",
      shiftKey: true,
    });
    expect(changed.mock.calls[2]?.[0]?.[1]).toEqual({ x: 30, y: 50 });
  });
  it("adds and removes curve points with buttons without a mouse gesture", () => {
    const changed = vi.fn();
    render(
      <DeckProvider>
        <CurveEditor
          header="곡선"
          points={[
            { x: 0, y: 0 },
            { x: 255, y: 255 },
          ]}
          onChange={changed}
        />
      </DeckProvider>,
    );
    expect(screen.getByRole("button", { name: "제어점 삭제" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "제어점 추가" }));
    expect(changed.mock.calls[0]?.[0]).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 128 },
      { x: 255, y: 255 },
    ]);
  });
  it("emits paired canvas gestures from a bounded keyboard pointer", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const gesture = vi.fn();
    render(
      <DeckProvider>
        <CanvasSurface
          header="화면"
          alt="편집 화면"
          source={null}
          width={30}
          height={20}
          zoom={1}
          onGesture={gesture}
        />
      </DeckProvider>,
    );
    const surface = screen.getByRole("group", { name: "편집 화면" });
    fireEvent.keyDown(surface, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(surface, { key: "ArrowDown" });
    fireEvent.keyDown(surface, { key: "Enter" });
    expect(gesture.mock.calls.map((c) => c[0].phase)).toEqual(["start", "end"]);
    expect(gesture.mock.calls[0]?.[0]?.point).toEqual({ x: 10, y: 1 });
  });
  it("labels the shared Slider and preserves its disabled state", () => {
    render(
      <DeckProvider>
        <Slider header="명도" value={0} min={-100} max={100} onChange={() => undefined} disabled />
      </DeckProvider>,
    );
    expect(screen.getByRole("slider", { name: "명도" }).hasAttribute("disabled")).toBe(true);
  });
});
