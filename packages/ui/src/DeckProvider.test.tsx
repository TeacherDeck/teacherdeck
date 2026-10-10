// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
// Griffel intentionally omits static document CSS in test mode; render the real rules.
vi.hoisted(() => {
  vi.stubEnv("NODE_ENV", "development");
});
const { DeckProvider } = await import("./DeckProvider.tsx");

afterEach(cleanup);
afterAll(() => vi.unstubAllEnvs());

describe("document scroll ownership", () => {
  it.each([false, true])("does not trap wheel chaining in the body or provider (mica=%s)", (mica) => {
    render(
      <DeckProvider mica={mica}>
        <main aria-label="긴 도구">내용</main>
      </DeckProvider>,
    );
    const provider = screen.getByRole("main").parentElement;
    if (provider === null) throw new Error("provider missing");
    // jsdom has no wheel/layout engine. Protect CSS preconditions here; actual wheel
    // movement is checked in the browser (docs/reviews/scroll-regression.md).
    for (const element of [document.body, provider]) {
      const style = getComputedStyle(element);
      expect(style.overflowX).toBe("clip");
      expect(["hidden", "scroll", "auto"]).not.toContain(style.overflowY);
      expect(["none", "contain"]).not.toContain(style.overscrollBehaviorY);
      expect(["none", "contain"]).not.toContain(style.overscrollBehavior);
    }
    expect(getComputedStyle(document.documentElement).overscrollBehaviorY).toBe("none");
  });
});
