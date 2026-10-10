// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as stateIO from "./state.ts";
import { App } from "./App.tsx";
import { applySetup, emptyState, parseRoster } from "./logic.ts";
import { STATE_KEY } from "./state.ts";
vi.stubGlobal("crypto", webcrypto);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(initial: unknown = null, failWrite = false) {
  const store = new Map<string, unknown>([[STATE_KEY, initial]]);
  const host = createMockHost({
    module: { id: "group-planner", version: "0.1.0" },
    granted: ["storage", "fs", "window"],
    handlers: {
      "storage.get": (args) => store.get((args as { key: string }).key) ?? null,
      "storage.keys": () => [...store.keys()],
      "storage.delete": (args) => {
        store.delete((args as { key: string }).key);
        return null;
      },
      "storage.set": (args) => {
        if (failWrite) throw new Error("WRITE_FAILED");
        const { key, value } = args as { key: string; value: unknown };
        store.set(key, value);
        return null;
      },
      "window.setFullscreen": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() => expect(screen.queryByText("저장한 기록을 불러오는 중")).toBeNull());
  return { deck, view, store };
}
function seeded() {
  let id = 0;
  return applySetup(
    emptyState(),
    parseRoster("1 학생가\n2 학생나\n3 학생다\n4 학생라", [], () => `s${++id}`),
    "합성 모둠",
    [],
    "count",
    2,
  );
}
describe("group classroom screen", () => {
  it("starts at input, generates without history and confirms actual snapshot", async () => {
    const { deck, view } = await setup();
    expect(screen.queryByRole("button", { name: "모둠 만들기" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), {
      target: { value: "1 학생가\n2 학생나\n3 학생다\n4 학생라" },
    });
    fireEvent.click(screen.getByRole("button", { name: "명단·편성 조건 적용" }));
    await screen.findByText("명단·편성 조건을 적용했어요. 바로 모둠을 만들어 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "모둠 만들기" }));
    await screen.findByText("모둠을 편성했어요. 직접 이동·교환한 뒤 편성 확정으로 기록해 주세요.");
    expect((await stateIO.loadState(deck)).history).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "편성 확정" }));
    await screen.findByText("편성을 확정해 당시 명단과 모둠을 기록했어요.");
    expect((await stateIO.loadState(deck)).history).toHaveLength(1);
    view.unmount();
    deck.dispose();
  });
  it("projects names and groups while hiding teacher conditions", async () => {
    const { deck, view } = await setup(seeded());
    fireEvent.click(screen.getByRole("button", { name: "모둠 만들기" }));
    await screen.findByText("모둠을 편성했어요. 직접 이동·교환한 뒤 편성 확정으로 기록해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "학생에게 보여주기" }));
    await screen.findByRole("button", { name: "교사용 화면" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "편성 확정" })).toBeNull();
    expect(screen.getByText("합성 모둠")).toBeTruthy();
    view.unmount();
    deck.dispose();
  });
  it("preserves prior work on failed write", async () => {
    const original = seeded(),
      { deck, view } = await setup(original, true);
    fireEvent.click(screen.getByRole("button", { name: "모둠 만들기" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
    expect(await stateIO.loadState(deck)).toEqual(original);
    view.unmount();
    deck.dispose();
  });
  it("recovers corrupt storage only after backup confirmation", async () => {
    vi.spyOn(stateIO, "readBackup").mockResolvedValue(seeded());
    const { deck, view, store } = await setup({ version: 0 });
    fireEvent.click(screen.getByRole("button", { name: "기록 파일 가져오기" }));
    await screen.findByRole("dialog");
    expect(store.get(STATE_KEY)).toEqual({ version: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "가져오기" }));
    await screen.findByText("기록 파일을 가져왔어요.");
    expect(await stateIO.loadState(deck)).toEqual(seeded());
    view.unmount();
    deck.dispose();
  });
  it("keeps recovery locked on failed write and unlocks successful confirmed new task", async () => {
    const first = await setup({ version: 0 }, true);
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "새 작업" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
    expect(first.store.get(STATE_KEY)).toEqual({ version: 0 });
    expect((screen.getByRole("textbox", { name: "학생 명단" }) as HTMLTextAreaElement).disabled).toBe(true);
    first.view.unmount();
    first.deck.dispose();
    const second = await setup({ version: 0 });
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "새 작업" }));
    await screen.findByText("새 작업을 시작했어요.");
    expect(await stateIO.loadState(second.deck)).toEqual(emptyState());
    expect((screen.getByRole("textbox", { name: "학생 명단" }) as HTMLTextAreaElement).disabled).toBe(false);
    second.view.unmount();
    second.deck.dispose();
  });
});

it("pages large student conditions without changing the roster", async () => {
  let id = 0;
  const students = parseRoster(
    Array.from({ length: 1000 }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"),
    [],
    () => `s${++id}`,
  );
  const { deck, view } = await setup(applySetup(emptyState(), students, "합성 대규모", [], "size", 4));
  expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "다음 학생" }));
  expect(screen.getByLabelText("51번 이번 제외")).toBeTruthy();
  expect(screen.queryByLabelText("1번 이번 제외")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "학생 찾기" }), { target: { value: "합성학생1000" } });
  expect(view.container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  expect(screen.getByLabelText("1000번 이번 제외")).toBeTruthy();
  expect((await stateIO.loadState(deck)).students).toHaveLength(1000);
  view.unmount();
  deck.dispose();
});
