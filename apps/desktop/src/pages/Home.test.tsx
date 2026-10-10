// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckProvider } from "@deck/ui";
import type { Category } from "../generated/Category.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { Home } from "./Home.tsx";

afterEach(cleanup);
function entry(id: string, name: string, category: Category, runnable = true): ModuleEntry {
  return {
    resolution: {
      id,
      state: runnable ? "ready" : "needsAppUpdate",
      picked: runnable ? { version: "0.1.0", source: "bundled" } : null,
      newest: "0.1.0",
      unmetRequires: [],
      unmetOptional: [],
    },
    manifest: {
      manifestVersion: 1,
      id,
      name,
      description: "합성 도구 설명",
      version: "0.1.0",
      category,
      icon: "icon.svg",
      entry: "index.html",
      authors: [{ name: "합성 기여자" }],
      requires: {},
      optional: {},
    },
    entryUrl: runnable ? `http://deckmod.${id}.modules.localhost/${id}/0.1.0/index.html` : null,
    iconUrl: null,
  };
}
const modules = [
  entry("sample-capture", "합성 캡처", "image"),
  entry("sample-timer", "합성 타이머", "classroom"),
  entry("sample-update", "합성 새 도구", "document", false),
];
describe("Home task navigation", () => {
  it("uses native buttons so cards participate in normal keyboard activation", () => {
    const onOpen = vi.fn();
    render(
      <DeckProvider>
        <Home modules={modules} dev={false} onOpen={onOpen} onNeedsUpdate={vi.fn()} />
      </DeckProvider>,
    );
    const card = screen.getByRole("button", { name: "합성 캡처 열기" });
    expect(card.tagName).toBe("BUTTON");
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("sample-capture");
  });
  it("routes unavailable cards to updates and describes that action", () => {
    const onOpen = vi.fn(),
      onNeedsUpdate = vi.fn();
    render(
      <DeckProvider>
        <Home modules={modules} dev={false} onOpen={onOpen} onNeedsUpdate={onNeedsUpdate} />
      </DeckProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "합성 새 도구 업데이트 확인" }));
    expect(onNeedsUpdate).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("resets the search when changing categories but retains it within the same category", () => {
    const props = { modules, dev: false, onOpen: vi.fn(), onNeedsUpdate: vi.fn() };
    const { rerender } = render(
      <DeckProvider>
        <Home {...props} category="image" />
      </DeckProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "도구 검색" }), { target: { value: "캡처" } });
    rerender(
      <DeckProvider>
        <Home {...props} category="image" />
      </DeckProvider>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("캡처");
    rerender(
      <DeckProvider>
        <Home {...props} category="classroom" />
      </DeckProvider>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "합성 타이머 열기" })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "없는 검색어" } });
    rerender(
      <DeckProvider>
        <Home {...props} />
      </DeckProvider>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "합성 캡처 열기" })).toBeTruthy();
  });
});
