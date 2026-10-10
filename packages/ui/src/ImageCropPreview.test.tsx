// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckProvider } from "./DeckProvider.tsx";
import { ImageCropPreview, boundCrop, dragCrop } from "./ImageCropPreview.tsx";
afterEach(cleanup);
describe("ImageCropPreview", () => {
  it("draws in any direction, moves inside image bounds and resizes about the opposite corner", () => {
    expect(
      dragCrop(
        { start: { x: 80, y: 60 }, rect: { x: 0, y: 0, width: 100, height: 80 }, mode: "draw", pointer: 1 },
        { x: 20, y: 10 },
        100,
        80,
      ),
    ).toEqual({ x: 20, y: 10, width: 60, height: 50 });
    expect(
      dragCrop(
        { start: { x: 30, y: 20 }, rect: { x: 20, y: 10, width: 60, height: 50 }, mode: "move", pointer: 1 },
        { x: 100, y: 80 },
        100,
        80,
      ),
    ).toEqual({ x: 40, y: 30, width: 60, height: 50 });
    expect(
      dragCrop(
        { start: { x: 20, y: 10 }, rect: { x: 20, y: 10, width: 60, height: 50 }, mode: "nw", pointer: 1 },
        { x: 0, y: 0 },
        100,
        80,
      ),
    ).toEqual({ x: 0, y: 0, width: 80, height: 60 });
    expect(boundCrop({ x: -10, y: 99, width: 300, height: 12 }, 100, 80)).toEqual({
      x: 0,
      y: 68,
      width: 100,
      height: 12,
    });
  });
  it("provides named keyboard movement, resize and a disabled state", () => {
    const change = vi.fn();
    const props = {
      header: "합성 사진 자르기",
      alt: "합성 사진",
      src: "blob:synthetic",
      imageWidth: 100,
      imageHeight: 80,
      rect: { x: 20, y: 10, width: 60, height: 50 },
      onRectChange: change,
    };
    const view = render(
      <DeckProvider>
        <ImageCropPreview {...props} />
      </DeckProvider>,
    );
    const surface = screen.getByRole("group", { name: "합성 사진 자르기" });
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(change).toHaveBeenLastCalledWith({ x: 21, y: 10, width: 60, height: 50 });
    fireEvent.keyDown(surface, { key: "ArrowDown", shiftKey: true, ctrlKey: true });
    expect(change).toHaveBeenLastCalledWith({ x: 20, y: 10, width: 60, height: 60 });
    expect(screen.getByRole("img", { name: "합성 사진" })).toBeTruthy();
    view.rerender(
      <DeckProvider>
        <ImageCropPreview {...props} disabled />
      </DeckProvider>,
    );
    change.mockClear();
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    expect(change).not.toHaveBeenCalled();
    expect(surface.getAttribute("tabindex")).toBe("-1");
  });
});
