// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { isInaccessible } from "@testing-library/dom";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { arrange, confirm, emptyState, parseRoster, replaceRoster, type SeatState } from "./logic.ts";
import { loadState, STATE_KEY } from "./state.ts";
afterEach(cleanup);
function prepared() {
  let i = 0;
  const state = replaceRoster(
    emptyState(),
    parseRoster("1 학생가\n2 학생나\n3 학생다", [], () => `s${++i}`),
    "합성 수업",
  );
  state.layout = { rows: 2, columns: 3, frontRows: 1, blocked: [], aisles: [] };
  return state;
}
async function setup(initial: unknown = null) {
  const store = new Map<string, unknown>(initial === null ? [] : [[STATE_KEY, initial]]);
  let fail = false;
  let losePointerResponse = false,
    readFailure = false;
  const fullscreen: boolean[] = [];
  const host = createMockHost({
    module: { id: "seat-planner", version: "0.1.0" },
    granted: ["storage", "fs", "window"],
    handlers: {
      "storage.get": (args) => {
        if (readFailure) throw new Error("SYNTHETIC_READ_FAILURE");
        return store.get((args as { key: string }).key) ?? null;
      },
      "storage.keys": () => [...store.keys()],
      "storage.delete": (args) => {
        store.delete((args as { key: string }).key);
        return null;
      },
      "storage.set": (args) => {
        if (fail) throw new Error("SYNTHETIC_WRITE_FAILURE");
        const a = args as { key: string; value: unknown };
        store.set(a.key, a.value);
        if (losePointerResponse && a.key === STATE_KEY) {
          readFailure = true;
          throw new Error("SYNTHETIC_RESPONSE_FAILURE");
        }
        return null;
      },
      "window.setFullscreen": (args) => {
        fullscreen.push((args as { value: boolean }).value);
        return null;
      },
      "fs.pickFolder": () => null,
      "fs.pickFiles": () => [],
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() => expect(screen.queryByText("저장한 배치를 불러오는 중")).toBeNull());
  return {
    deck,
    view,
    store,
    fullscreen,
    setFail: (next: boolean) => {
      fail = next;
    },
    losePointer: () => {
      losePointerResponse = true;
    },
    recoverRead: () => {
      readFailure = false;
      losePointerResponse = false;
    },
  };
}
describe("complete seat planning screen", () => {
  it("locks ambiguous confirmation and reloads the committed snapshot before allowing edits", async () => {
    const f = await setup(arrange(prepared(), () => 0.2));
    f.losePointer();
    fireEvent.click(screen.getByRole("button", { name: "이 배치 확정" }));
    await screen.findByText("저장 결과를 확인하지 못했어요. 저장 기록을 다시 확인한 뒤 계속해 주세요.");
    expect((screen.getByRole("button", { name: "새 배치 만들기" }) as HTMLButtonElement).disabled).toBe(true);
    f.recoverRead();
    fireEvent.click(screen.getByRole("button", { name: "저장 기록 다시 확인" }));
    await screen.findByText("저장 기록을 다시 확인했어요.");
    expect((await loadState(f.deck)).history).toHaveLength(1);
    expect(screen.getByText("확정한 배치")).toBeTruthy();
    expect((screen.getByRole("button", { name: "확정 완료" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/지난 확정본과 비교/)).toBeNull();
    expect((screen.getByRole("button", { name: "새 배치 만들기" }) as HTMLButtonElement).disabled).toBe(false);
    f.view.unmount();
    f.deck.dispose();
  });
  it("starts with roster setup, then previews, swaps, confirms and exposes only the snapshot", async () => {
    const f = await setup();
    expect(screen.queryByRole("button", { name: "새 배치 만들기" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), {
      target: { value: "1 학생가\n2 학생나\n3 학생다" },
    });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText("명단을 적용했어요. 이전 확정 기록은 보존했어요.");
    fireEvent.click(screen.getByRole("button", { name: "새 배치 만들기" }));
    await screen.findByText("미리보기를 만들었어요. 자리를 직접 바꾼 뒤 확정할 수 있어요.");
    const before = await loadState(f.deck),
      first = before.preview?.findIndex(Boolean) ?? -1,
      empty = before.preview?.findIndex((s) => s === null) ?? -1;
    const firstButton = screen.getByRole("button", {
        name: new RegExp(`^${Math.floor(first / 6) + 1}행 ${(first % 6) + 1}열 `),
      }),
      emptyButton = screen.getByRole("button", {
        name: new RegExp(`^${Math.floor(empty / 6) + 1}행 ${(empty % 6) + 1}열 `),
      });
    fireEvent.click(firstButton);
    fireEvent.click(emptyButton);
    await screen.findByText("자리를 교환했어요. 검토한 뒤 확정해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "이 배치 확정" }));
    await screen.findByText("자리 배치를 확정했어요. 학생 보기로 공개할 수 있어요.");
    expect((await loadState(f.deck)).history).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "학생 보기" }));
    await screen.findByRole("button", { name: "교사 화면으로 돌아가기" });
    expect(screen.queryByText("고정")).toBeNull();
    expect(screen.queryByText("교실 구조")).toBeNull();
    expect(screen.getByText("1번 학생가")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "교사 화면으로 돌아가기" }));
    await screen.findByRole("button", { name: "명단 수정" });
    expect(f.fullscreen).toEqual([true, false]);
    f.view.unmount();
    f.deck.dispose();
  });
  it("keeps fixed/excluded conflict visible without relaxing it", async () => {
    const initial = prepared();
    initial.rules.fixed = { s1: 0 };
    initial.rules.excluded = ["s1"];
    const f = await setup(initial);
    expect(screen.getByText(/고정한 학생이 배치 제외/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "새 배치 만들기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((await loadState(f.deck)).rules).toEqual(initial.rules);
    f.view.unmount();
    f.deck.dispose();
  });
  it("leaves confirmed state intact after save failure and changes only after successful retry", async () => {
    const initial = arrange(prepared(), () => 0.2);
    const f = await setup(initial);
    f.setFail(true);
    fireEvent.click(screen.getByRole("button", { name: "이 배치 확정" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 배치와 기록을 유지했어요. 다시 시도해 주세요.");
    expect((await loadState(f.deck)).history).toHaveLength(0);
    f.setFail(false);
    fireEvent.click(screen.getByRole("button", { name: "이 배치 확정" }));
    await screen.findByText("자리 배치를 확정했어요. 학생 보기로 공개할 수 있어요.");
    expect((await loadState(f.deck)).history).toHaveLength(1);
    f.view.unmount();
    f.deck.dispose();
  });
  it("requires explicit recovery confirmation and retains damaged storage if cancelled", async () => {
    const damaged = { version: 99 };
    const f = await setup(damaged);
    expect((screen.getByRole("button", { name: "명단 적용" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { hidden: true })).toBeNull());
    expect(f.store.get(STATE_KEY)).toEqual(damaged);
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "새 작업" }));
    await screen.findByText("새 작업을 시작했어요.");
    expect(await loadState(f.deck)).toEqual(emptyState());
    f.view.unmount();
    f.deck.dispose();
  });
  it("preserves historic names after editing the roster and projects the old snapshot", async () => {
    const initial = confirm(
      arrange(prepared(), () => 0.2),
      "old",
      "2026-10-01T00:00:00Z",
    );
    const f = await setup(initial);
    fireEvent.click(screen.getByRole("button", { name: "명단 수정" }));
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), { target: { value: "1 새학생" } });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText("명단을 적용했어요. 이전 확정 기록은 보존했어요.");
    expect((await loadState(f.deck)).history).toEqual(initial.history);
    fireEvent.click(screen.getByRole("button", { name: "학생 보기" }));
    await screen.findByRole("button", { name: "교사 화면으로 돌아가기" });
    expect(screen.getByText("1번 학생가")).toBeTruthy();
    expect(screen.queryByText("1번 새학생")).toBeNull();
    f.view.unmount();
    f.deck.dispose();
  });
  it("has a scrollable 1000-seat layout and independent condition controls", async () => {
    let id = 0;
    const initial: SeatState = replaceRoster(
      emptyState(),
      parseRoster(Array.from({ length: 1000 }, (_, i) => `${i + 1} 합성학생${i + 1}`).join("\n"), [], () => `s${++id}`),
      "합성 대규모 수업",
    );
    initial.layout = { rows: 40, columns: 25, frontRows: 1, aisles: [5, 10], blocked: [999] };
    const f = await setup(initial);
    // Native buttons already define their role; check all exact labels and the same
    // accessibility predicate without computing 1,000 unrelated accessible names.
    const seats = Array.from(f.view.container.querySelectorAll("button[aria-label]")).filter((button) =>
      /^\d+행 \d+열 /.test(button.getAttribute("aria-label") ?? ""),
    );
    expect(seats).toHaveLength(1000);
    expect(seats.every((button) => !button.hasAttribute("role") && !isInaccessible(button))).toBe(true);
    const conditions = screen.getByLabelText("학생별 고정·제외·앞줄 조건");
    expect(conditions.tagName).toBe("BUTTON");
    fireEvent.click(conditions);
    const first = await screen.findByLabelText("1번 배치 제외");
    expect(first.tagName).toBe("INPUT");
    expect(first.getAttribute("type")).toBe("checkbox");
    expect(isInaccessible(first)).toBe(false);
    expect(screen.queryByLabelText("1000번 배치 제외")).toBeNull();
    fireEvent.change(screen.getByLabelText("학생 조건 찾기"), { target: { value: "합성학생1000" } });
    const last = await screen.findByLabelText("1000번 배치 제외");
    expect(last.tagName).toBe("INPUT");
    expect(last.getAttribute("type")).toBe("checkbox");
    expect(isInaccessible(last)).toBe(false);
    f.view.unmount();
    f.deck.dispose();
  }, 5000);
});
