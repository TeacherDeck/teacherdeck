// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { PresentationViewState } from "@deck/sdk";
import { createDeckTheme, FONT_STACK } from "@deck/ui";
import { Presentation, type PresentationHost } from "./Presentation.tsx";
afterEach(() => {
  cleanup();
  window.localStorage.removeItem("deck.shell.theme");
  vi.unstubAllGlobals();
});
const state: PresentationViewState = {
  revision: 0,
  disconnected: false,
  payload: {
    kind: "picker",
    title: "합성 수업",
    columns: null,
    items: [{ label: "1번 합성가", group: null, row: null, column: null }],
  },
};
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(value = state) {
  let changed: () => void = () => undefined;
  const off = vi.fn();
  const host: PresentationHost = {
    state: vi.fn(async () => value),
    close: vi.fn(async () => undefined),
    onChanged: vi.fn(async (callback) => {
      changed = callback;
      return off;
    }),
  };
  const view = render(<Presentation controls={host} />);
  return { host, off, view, changed: () => changed() };
}
it("shows escaped public results and closes with Escape", async () => {
  const f = fixture({
    ...state,
    payload: state.payload && {
      ...state.payload,
      items: [{ label: "<script>합성</script>", group: null, row: null, column: null }],
    },
  });
  expect(await screen.findByText("<script>합성</script>")).toBeTruthy();
  expect(f.view.container.querySelector("script")).toBeNull();
  expect(screen.queryByText(/제외|누적|수행 횟수/)).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(f.host.close).toHaveBeenCalledTimes(1);
  f.view.unmount();
  expect(f.off).toHaveBeenCalledTimes(1);
});
it("provides its own opaque saved theme and follows cross-window theme changes without an outer provider", async () => {
  window.localStorage.setItem("deck.shell.theme", "dark");
  const f = fixture();
  await screen.findByText("1번 합성가");
  const provider = f.view.container.querySelector<HTMLElement>(".fui-FluentProvider");
  expect(provider).toBeTruthy();
  expect(provider ? getComputedStyle(provider).getPropertyValue("--colorNeutralBackground2") : "").toBe(
    createDeckTheme("dark").colorNeutralBackground2,
  );
  expect(
    (provider ? getComputedStyle(provider).getPropertyValue("--fontFamilyBase") : "")
      .split(",")
      .map((font) => font.trim()),
  ).toEqual(FONT_STACK.split(",").map((font) => font.trim()));
  window.localStorage.setItem("deck.shell.theme", "light");
  fireEvent(window, new StorageEvent("storage", { key: "deck.shell.theme", newValue: "light" }));
  await waitFor(() =>
    expect(provider ? getComputedStyle(provider).getPropertyValue("--colorNeutralBackground2") : "").toBe(
      createDeckTheme("light").colorNeutralBackground2,
    ),
  );
  expect(screen.getByText("1번 합성가")).toBeTruthy();
});
it("follows OS color changes when the saved preference is system", async () => {
  let changed: (event: { matches: boolean }) => void = () => undefined;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: (_event: string, listener: typeof changed) => {
      changed = listener;
    },
    removeEventListener: vi.fn(),
  }));
  const f = fixture();
  await screen.findByText("1번 합성가");
  const provider = f.view.container.querySelector<HTMLElement>(".fui-FluentProvider");
  expect(provider ? getComputedStyle(provider).getPropertyValue("--colorNeutralBackground2") : "").toBe(
    createDeckTheme("light").colorNeutralBackground2,
  );
  act(() => changed({ matches: true }));
  await waitFor(() =>
    expect(provider ? getComputedStyle(provider).getPropertyValue("--colorNeutralBackground2") : "").toBe(
      createDeckTheme("dark").colorNeutralBackground2,
    ),
  );
});
it("discards stale state reads and removes names and title after disconnection", async () => {
  const f = fixture();
  await screen.findByText("1번 합성가");
  const old = deferred<PresentationViewState>();
  vi.mocked(f.host.state).mockImplementationOnce(() => old.promise);
  act(() => f.changed());
  vi.mocked(f.host.state).mockResolvedValueOnce({ ...state, revision: 2, disconnected: true });
  act(() => f.changed());
  await screen.findByText(/공개 자료를 비웠어요/);
  await act(async () => old.resolve(state));
  expect(screen.queryByText("1번 합성가")).toBeNull();
  expect(screen.queryByRole("heading", { name: "합성 수업" })).toBeNull();
});
it("retains every seat and empty position in a large public result", async () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({
    label: i === 12 ? "" : `${i + 1}번 합성${i + 1}`,
    group: null,
    row: Math.floor(i / 40),
    column: i % 40,
  }));
  const f = fixture({ ...state, payload: { kind: "seats", title: "합성 자리", columns: 40, items } });
  const board = await screen.findByLabelText("학생 자리");
  expect(board.children.length).toBe(1000);
  expect(board.children[999]?.textContent).toBe("1000번 합성1000");
  expect(screen.getByText("빈 자리")).toBeTruthy();
  expect(board.children[999]).toHaveProperty("style.gridRowStart", "25");
  expect(f.view.container.textContent).not.toContain("avoidPreviousNeighbor");
});
it("groups role results and shows recovery guidance when a state read fails", async () => {
  const f = fixture({
    ...state,
    payload: {
      kind: "roles",
      title: "합성 역할",
      columns: null,
      items: [
        { label: "1번 합성가", group: "진행", row: null, column: null },
        { label: "2번 합성나", group: "진행", row: null, column: null },
      ],
    },
  });
  await screen.findByText("2번 합성나");
  expect(screen.getByText("진행").closest("section")?.textContent).toContain("1번 합성가");
  vi.mocked(f.host.state).mockRejectedValueOnce(new Error("synthetic"));
  act(() => f.changed());
  await screen.findByText(/교사 화면에서 다시 열어/);
  expect(screen.queryByText("1번 합성가")).toBeNull();
  await waitFor(() => expect(f.host.state).toHaveBeenCalledTimes(2));
});
