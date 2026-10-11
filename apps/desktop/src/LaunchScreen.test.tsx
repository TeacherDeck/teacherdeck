// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckProvider } from "@deck/ui";
import { LaunchScreen } from "./LaunchScreen.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("LaunchScreen", () => {
  it("announces the loading state", () => {
    render(
      <DeckProvider>
        <LaunchScreen motion leaving={false} message="도구를 준비하고 있어요" onLeft={vi.fn()} />
      </DeckProvider>,
    );
    expect(screen.getByRole("status", { name: "도구를 준비하고 있어요" })).toBeTruthy();
  });

  it("hands over even when no animation frame ever runs", () => {
    vi.useFakeTimers();
    const onLeft = vi.fn();
    render(
      <DeckProvider>
        <LaunchScreen motion leaving message="준비됐어요" onLeft={onLeft} />
      </DeckProvider>,
    );
    expect(onLeft).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(onLeft).toHaveBeenCalledOnce();
  });
});
