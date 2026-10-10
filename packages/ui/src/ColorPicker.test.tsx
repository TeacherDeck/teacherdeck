// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker.tsx";
import { createDeckTheme } from "./tokens/index.ts";
afterEach(cleanup);
it("labels the native swatch and reports the chosen opaque color", () => {
  const onChange = vi.fn();
  const light = createDeckTheme("light"),
    dark = createDeckTheme("dark");
  render(<ColorPicker header="테두리 색" value={light.colorPaletteRedBorderActive} onChange={onChange} />);
  const input = screen.getByLabelText("테두리 색");
  expect(input.getAttribute("type")).toBe("color");
  fireEvent.input(input, { target: { value: dark.colorPaletteRedBorderActive } });
  expect(onChange).toHaveBeenCalledWith(dark.colorPaletteRedBorderActive.toLowerCase());
});
it("keeps an accessible name when the visible field label is hidden", () => {
  render(
    <ColorPicker
      header="테두리 색"
      showHeader={false}
      disabled
      value={createDeckTheme("light").colorBrandStroke1}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("테두리 색").hasAttribute("disabled")).toBe(true);
});
