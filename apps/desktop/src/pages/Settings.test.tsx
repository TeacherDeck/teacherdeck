// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckProvider } from "@deck/ui";
import { Settings, type SettingsProps } from "./Settings.tsx";

afterEach(cleanup);

function setup(overrides: Partial<SettingsProps> = {}) {
  const props: SettingsProps = {
    theme: "system",
    onTheme: vi.fn(),
    motion: true,
    osReducedMotion: false,
    onMotion: vi.fn(),
    checkUpdate: vi.fn(),
    installUpdate: vi.fn(),
    restart: vi.fn(),
    ...overrides,
  };
  render(
    <DeckProvider>
      <Settings {...props} />
    </DeckProvider>,
  );
  return props;
}

describe("Settings", () => {
  it("lists every theme choice and applies the picked one", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("combobox", { name: "테마" }));
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["시스템 설정", "라이트", "다크"]);
    fireEvent.click(screen.getByRole("option", { name: "다크" }));
    expect(props.onTheme).toHaveBeenCalledExactlyOnceWith("dark");
  });

  it("turns animation effects off", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("switch", { name: "애니메이션 효과" }));
    expect(props.onMotion).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("explains that Windows reduced motion wins over the setting", () => {
    setup({ osReducedMotion: true });
    expect(screen.getByText(/Windows에서 애니메이션 효과를 꺼 두어서/)).toBeTruthy();
  });
});
