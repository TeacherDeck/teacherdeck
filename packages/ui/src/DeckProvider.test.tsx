// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { Portal } from "@fluentui/react-components";
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

describe("portals", () => {
  it.each([false, true])("never become a full-screen layer over the app (mica=%s)", (mica) => {
    render(
      <DeckProvider mica={mica}>
        <main aria-label="도구">내용</main>
        <Portal>
          <div role="listbox" aria-label="선택지" />
        </Portal>
      </DeckProvider>,
    );
    const mountNode = screen.getByRole("listbox").parentElement;
    if (mountNode === null) throw new Error("portal mount node missing");
    expect(mountNode.contains(screen.getByRole("main"))).toBe(false);
    // A Dropdown or Menu popup used to inherit min-height: 100vh and the page background here.
    const style = getComputedStyle(mountNode);
    expect(style.minHeight).not.toBe("100vh");
    const transparent = document.createElement("div");
    transparent.style.backgroundColor = "transparent";
    document.body.append(transparent);
    expect(style.backgroundColor).toBe(getComputedStyle(transparent).backgroundColor);
    transparent.remove();
    // Popup positioning treats clipping ancestors as the boundary; a clipped zero-height mount
    // node left no room for the options.
    expect(style.overflowX).toBe("visible");
  });
});
