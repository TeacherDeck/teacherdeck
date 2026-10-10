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
import { emptyState, parseRoster, replaceRoster } from "./logic.ts";
import { STATE_KEY } from "./state.ts";
vi.stubGlobal("crypto", webcrypto);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(initial: unknown = null, failWrite = false) {
  const store = new Map<string, unknown>([[STATE_KEY, initial]]);
  const host = createMockHost({
    module: { id: "presenter-picker", version: "0.1.0" },
    granted: ["storage", "window", "fs"],
    handlers: {
      "storage.get": (args) => store.get((args as { key: string }).key) ?? null,
      "storage.keys": () => [...store.keys()],
      "storage.delete": (args) => {
        store.delete((args as { key: string }).key);
        return null;
      },
      "storage.set": (args) => {
        if (failWrite) throw new Error("WRITE_FAILED");
        store.set((args as { key: string }).key, (args as { value: unknown }).value);
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
  await waitFor(() => {
    expect(screen.queryByText("저장한 기록을 불러오는 중")).toBeNull();
  });
  return { deck, view, store, host };
}
function seeded() {
  let id = 0;
  return replaceRoster(
    emptyState(),
    parseRoster("1\t학생가\t0\n2\t학생나\t5", [], () => `s${++id}`),
    "합성 수업",
  );
}
describe("presenter screen flow", () => {
  it("recovers corrupt storage only after backup confirmation", async () => {
    vi.spyOn(stateIO, "readBackup").mockResolvedValue(seeded());
    const { deck, view, store } = await setup({ version: 0 });
    expect((screen.getByRole("button", { name: "명단 적용" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "기록 파일 가져오기" }));
    await screen.findByRole("dialog");
    expect(store.get(STATE_KEY)).toEqual({ version: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "가져오기" }));
    await screen.findByText("기록 파일을 가져왔어요.");
    expect(await stateIO.loadState(deck)).toEqual(seeded());
    expect((screen.getByRole("button", { name: "발표자 뽑기" }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
    deck.dispose();
  });
  it("requires confirmation for a new task and keeps recovery lock when storage write fails", async () => {
    const first = await setup({ version: 0 }, true);
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    const dialog = await screen.findByRole("dialog");
    expect(first.store.get(STATE_KEY)).toEqual({ version: 0 });
    fireEvent.click(within(dialog).getByRole("button", { name: "새 작업" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
    expect(first.store.get(STATE_KEY)).toEqual({ version: 0 });
    expect((screen.getByRole("button", { name: "명단 적용" }) as HTMLButtonElement).disabled).toBe(true);
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
  it("accepts roster, draws without counts, counts only completion and undoes", async () => {
    const { deck, view } = await setup();
    const input = screen.getByRole("textbox", { name: "학생 명단" });
    fireEvent.change(input, { target: { value: "1 학생가\n2 학생나" } });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText("명단을 적용했어요. 바로 발표자를 뽑아 주세요.");
    expect((await stateIO.loadState(deck)).round).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "발표자 뽑기" }));
    await screen.findByText("발표자를 선정했어요. 발표를 마치면 완료를 눌러 주세요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "발표 완료" }));
    await screen.findByText("발표 완료를 한 번 기록했어요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "마지막 완료 되돌리기" }));
    await screen.findByText("마지막 발표 완료를 되돌렸어요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    view.unmount();
    deck.dispose();
  });
  it("keeps state on write failure and never presents completion as saved", async () => {
    const original = seeded();
    const { deck, view, store } = await setup(original, true);
    fireEvent.click(screen.getByRole("button", { name: "발표자 뽑기" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
    expect(store.get(STATE_KEY)).toEqual(original);
    expect(screen.queryByRole("button", { name: "다시 뽑기" })).toBeNull();
    view.unmount();
    deck.dispose();
  });
  it("projects only chosen number/name and task label into student view", async () => {
    const { deck, view, host } = await setup(seeded());
    fireEvent.click(screen.getByRole("button", { name: "발표자 뽑기" }));
    await screen.findByText("발표자를 선정했어요. 발표를 마치면 완료를 눌러 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "학생에게 보여주기" }));
    await screen.findByRole("button", { name: "교사용 화면" });
    expect(screen.queryByText("참여 학생과 총횟수")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText("학생나")).toBeNull();
    expect(screen.getByText("학생가")).toBeTruthy();
    expect(host.requests.some((r) => r.cap === "window" && r.method === "setFullscreen")).toBe(true);
    view.unmount();
    deck.dispose();
  });
});

it("pages large student conditions without changing the roster", async () => {
  let id = 0;
  const students = parseRoster(
    Array.from({ length: 1000 }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"),
    [],
    () => `s${++id}`,
  );
  const { deck, view } = await setup(replaceRoster(emptyState(), students, "합성 대규모"));
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
