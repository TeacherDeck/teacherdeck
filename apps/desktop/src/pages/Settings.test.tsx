// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("recovers from a rejected update check and clears its error after retry", async () => {
    const checkUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_PATH"))
      .mockResolvedValue({ status: "upToDate" });
    setup({ checkUpdate });
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await screen.findByText("업데이트를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.");
    expect((screen.getByRole("button", { name: "업데이트 확인" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/SYNTHETIC_PRIVATE_PATH/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await screen.findByText("최신 버전이에요.");
    expect(screen.queryByText(/확인하지 못했어요/)).toBeNull();
    expect(checkUpdate).toHaveBeenCalledTimes(2);
  });

  it("clears an installation failure on retry and handles restart failure", async () => {
    const installUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_PATH"))
      .mockResolvedValue(undefined);
    const restart = vi.fn().mockRejectedValue(new Error("SYNTHETIC_PRIVATE_PATH"));
    setup({
      checkUpdate: vi.fn().mockResolvedValue({ status: "available", version: "9.0.0" }),
      installUpdate,
      restart,
    });
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    fireEvent.click(await screen.findByRole("button", { name: "설치" }));
    await screen.findByText("업데이트를 설치하지 못했어요. 잠시 후 다시 설치해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "설치" }));
    await screen.findByText("설치했어요. 다시 시작하면 적용돼요.");
    expect(screen.queryByText(/설치하지 못했어요/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
    await screen.findByText("앱을 다시 시작하지 못했어요. 앱을 닫고 다시 열어 주세요.");
    expect((screen.getByRole("button", { name: "다시 시작" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/SYNTHETIC_PRIVATE_PATH/)).toBeNull();
    expect(installUpdate).toHaveBeenCalledTimes(2);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("disables update controls until each pending operation resolves", async () => {
    let finishCheck!: SettingsProps["checkUpdate"] extends () => Promise<infer Result>
      ? (value: Result) => void
      : never;
    const checking = new Promise<Awaited<ReturnType<SettingsProps["checkUpdate"]>>>((resolve) => {
      finishCheck = resolve;
    });
    let finishRestart!: () => void;
    const restarting = new Promise<void>((resolve) => {
      finishRestart = resolve;
    });
    setup({ checkUpdate: () => checking, installUpdate: async () => {}, restart: () => restarting });
    fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
    expect((screen.getByRole("button", { name: "업데이트 확인" }) as HTMLButtonElement).disabled).toBe(true);
    finishCheck({ status: "available", version: "9.0.0" });
    fireEvent.click(await screen.findByRole("button", { name: "설치" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 시작" }));
    expect((screen.getByRole("button", { name: "다시 시작" }) as HTMLButtonElement).disabled).toBe(true);
    finishRestart();
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "다시 시작" }) as HTMLButtonElement).disabled).toBe(false),
    );
  });
});
