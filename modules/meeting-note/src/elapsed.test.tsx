// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { DeckProvider } from "@deck/ui";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Elapsed, elapsedLabel } from "./elapsed.tsx";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("validates starts and formats complete minutes without negative elapsed time", () => {
  const start = "2026-10-11T10:00:00+09:00",
    now = Date.parse(start);
  expect(elapsedLabel(start, now + 90 * 60000)).toBe("1시간 30분");
  expect(elapsedLabel(start, now - 60000)).toBe("0분");
  expect(elapsedLabel("invalid", now)).toBe("");
});
it("updates the isolated header clock every 30 seconds and cleans up on unmount", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T10:00:30+09:00"));
  const view = render(
    <DeckProvider>
      <Elapsed startedAt="2026-10-11T10:00:00+09:00" />
    </DeckProvider>,
  );
  expect(screen.getByText("경과 0분")).toBeTruthy();
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.getByText("경과 1분")).toBeTruthy();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
