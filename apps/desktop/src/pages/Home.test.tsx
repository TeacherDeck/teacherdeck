// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeckProvider } from "@deck/ui";
import type { Category } from "../generated/Category.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { Home, greeting } from "./Home.tsx";

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

describe("Home dashboard", () => {
  const base = { modules, dev: false, onOpen: vi.fn(), onNeedsUpdate: vi.fn() };
  const sectionNames = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  it("greets by time of day and shows the date", () => {
    render(
      <DeckProvider>
        <Home {...base} now={new Date(2026, 9, 12, 8, 30)} />
      </DeckProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("좋은 아침이에요");
    expect(screen.getByText("10월 12일 월요일")).toBeTruthy();
    expect([greeting(13), greeting(19), greeting(2)]).toEqual([
      "오늘 수업도 힘내세요",
      "오늘도 수고 많으셨어요",
      "늦은 시간까지 수고 많으세요",
    ]);
  });

  it("groups tools by category and lists favorites first, in starring order", () => {
    render(
      <DeckProvider>
        <Home {...base} favorites={["sample-timer", "gone", "sample-capture"]} onToggleFavorite={vi.fn()} />
      </DeckProvider>,
    );
    expect(sectionNames()).toEqual(["즐겨찾기", "수업", "이미지", "문서"]);
    const favorites = screen.getByRole("region", { name: "즐겨찾기" });
    expect(
      within(favorites)
        .getAllByRole("button", { name: /열기$/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["합성 타이머 열기", "합성 캡처 열기"]);
  });

  it("hides the favorites section until something is starred", () => {
    render(
      <DeckProvider>
        <Home {...base} onToggleFavorite={vi.fn()} />
      </DeckProvider>,
    );
    expect(sectionNames()).toEqual(["수업", "이미지", "문서"]);
  });

  it("toggles a favorite with the star without opening the tool", () => {
    const onToggleFavorite = vi.fn();
    render(
      <DeckProvider>
        <Home {...base} favorites={["sample-capture"]} onToggleFavorite={onToggleFavorite} />
      </DeckProvider>,
    );
    const timerStar = screen.getByRole("button", { name: "합성 타이머 즐겨찾기" });
    expect(timerStar.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(timerStar);
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith("sample-timer");
    expect(base.onOpen).not.toHaveBeenCalled();
    // A starred tool shows a pressed star in both the favorites and its category section.
    const captureStars = screen.getAllByRole("button", { name: "합성 캡처 즐겨찾기" });
    expect(captureStars.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
  });

  it("shows one result grid while searching", () => {
    render(
      <DeckProvider>
        <Home {...base} favorites={["sample-capture"]} />
      </DeckProvider>,
    );
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "타이머" } });
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /열기$/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "합성 타이머 열기",
    ]);
  });

  it("badges tools added since the last launch", () => {
    render(
      <DeckProvider>
        <Home {...base} fresh={new Set(["sample-timer"])} />
      </DeckProvider>,
    );
    expect(within(screen.getByRole("button", { name: "합성 타이머 열기" })).getByText("새 도구")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "합성 캡처 열기" })).queryByText("새 도구")).toBeNull();
  });

  it("focuses the search box with Ctrl+F", () => {
    render(
      <DeckProvider>
        <Home {...base} />
      </DeckProvider>,
    );
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("keeps description access and status badges on compact favorite launchers", () => {
    render(
      <DeckProvider>
        <Home {...base} favorites={["sample-update"]} fresh={new Set(["sample-update"])} />
      </DeckProvider>,
    );
    const region = screen.getByRole("region", { name: "즐겨찾기" });
    const launcher = within(region).getByRole("button", { name: "합성 새 도구 업데이트 확인" });
    expect(within(launcher).queryByText("합성 도구 설명")).toBeNull();
    expect(within(launcher).getByText("새 도구")).toBeTruthy();
    expect(within(launcher).getByText("앱 업데이트 후 사용 가능")).toBeTruthy();
    launcher.focus();
    const describedBy = launcher.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("합성 도구 설명");
    fireEvent.click(launcher);
    expect(base.onNeedsUpdate).toHaveBeenCalled();
  });

  it("falls back when a module icon fails while preserving the launch action", () => {
    const withIcon = {
      ...entry("sample-capture", "합성 캡처", "image"),
      iconUrl: "http://deckmod.sample-capture.modules.localhost/icon.svg",
    };
    const onOpen = vi.fn();
    const { container } = render(
      <DeckProvider>
        <Home {...base} modules={[withIcon]} onOpen={onOpen} />
      </DeckProvider>,
    );
    const icon = container.querySelector("img");
    expect(icon).toBeTruthy();
    if (icon === null) throw new Error("Expected a module icon before its load error");
    fireEvent.error(icon);
    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "합성 캡처 열기" }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("sample-capture");
  });
});
