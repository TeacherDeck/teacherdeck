// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as plannerClient from "./planner-client.ts";
import * as stateIO from "./state.ts";
import { App } from "./App.tsx";
import { applySetup, complete, emptyState, generate, parseRoster, totalCount } from "./logic.ts";
import { STATE_KEY } from "./state.ts";
vi.stubGlobal("crypto", webcrypto);
beforeEach(() => {
  vi.spyOn(plannerClient, "generateInWorker").mockImplementation(async (state, id) => generate(state, id, () => 0));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(initial: unknown = null, failWrite = false) {
  const store = new Map<string, unknown>([[STATE_KEY, initial]]),
    host = createMockHost({
      module: { id: "role-planner", version: "0.1.0" },
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
          store.set((args as { key: string }).key, (args as { value: unknown }).value);
          return null;
        },
        "window.setFullscreen": () => null,
      },
    });
  const deck = await connect({ window: host.window }),
    view = render(
      <DeckProvider>
        <App deck={deck} />
      </DeckProvider>,
    );
  await waitFor(() => expect(screen.queryByText("저장한 기록을 불러오는 중")).toBeNull());
  return { deck, view, store, host };
}
function seeded() {
  let id = 0;
  return applySetup(
    emptyState(),
    parseRoster("1\t학생가\t0\n2\t학생나\t9\n3\t학생다\t0", [], () => `s${++id}`),
    [{ id: "j1", title: "자료", capacity: 1 }],
    "합성 당번",
  );
}
describe("role classroom flow", () => {
  it("offers history linking only for returning students and preserves their saved baseline and performances", async () => {
    const blank = await setup();
    expect(screen.queryByLabelText("이 작업의 이전 학생과 기록 연결")).toBeNull();
    blank.view.unmount();
    blank.deck.dispose();
    const original = seeded(),
      student = original.students[0];
    if (!student) throw new Error("fixture");
    student.baseCount = 7;
    original.fixed = { [student.id]: "j1" };
    const done = complete(
      generate(original, "return-draft", () => 0),
      student.id,
      "return-event",
      "2026-10-01T00:00:00Z",
    );
    const removed = applySetup(done, done.students.slice(1), done.jobs, done.label);
    const { deck, view } = await setup(removed);
    fireEvent.click(screen.getByRole("button", { name: "이번 작업 명단과 역할" }));
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), {
      target: { value: "1 학생가\n2 학생나\n3 학생다" },
    });
    fireEvent.click(screen.getByLabelText("이 작업의 이전 학생과 기록 연결"));
    fireEvent.click(screen.getByRole("button", { name: "명단·역할 적용" }));
    await screen.findByText("명단·역할을 적용했어요. 이전 수행 기록은 보존하고 새 배정을 시작했어요.");
    const restored = await stateIO.loadState(deck);
    expect(restored.students[0]).toEqual(student);
    expect(totalCount(restored, student.id)).toBe(8);
    expect(restored.events).toEqual(done.events);
    view.unmount();
    deck.dispose();
  });
  it("confirms a batch of actual completions, permits exclusions, and never recounts completed students", async () => {
    const initial = seeded();
    initial.jobs[0] = { id: "j1", title: "자료", capacity: 3 };
    const { deck, view } = await setup(generate(initial, "bulk-draft", () => 0));
    const openBatch = async () => {
      const trigger = await screen.findByRole("button", { name: "수행 완료 한꺼번에 기록" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", { name: "실제 수행 완료를 기록할까요?" });
      // jsdom has no layout or pointer focus. Let Tabster register the surface, then
      // focus its real input as a browser click does before checking accessible actions.
      await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
      within(dialog).getByLabelText("수행 학생 찾기").focus();
      await within(dialog).findByRole("button", { name: "취소" });
      return dialog;
    };
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    let dialog = await openBatch();
    fireEvent.click(within(dialog).getByLabelText("2번 학생나 이번 기록에서 제외"));
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    dialog = await openBatch();
    fireEvent.click(within(dialog).getByLabelText("2번 학생나 이번 기록에서 제외"));
    fireEvent.click(within(dialog).getByRole("button", { name: "2명 수행 완료 기록" }));
    await screen.findByText("실제 수행 완료 2명을 한 번씩 기록했어요.");
    expect((await stateIO.loadState(deck)).events.map((e) => e.studentId)).toEqual(["s1", "s3"]);
    dialog = await openBatch();
    expect(within(dialog).queryByLabelText("1번 학생가 이번 기록에서 제외")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "1명 수행 완료 기록" }));
    await screen.findByText("실제 수행 완료 1명을 한 번씩 기록했어요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(3);
    view.unmount();
    deck.dispose();
  });
  it("restores a valid backup from corrupt storage only after confirmation", async () => {
    vi.spyOn(stateIO, "readBackup").mockResolvedValue(seeded());
    const { deck, view, store } = await setup({ version: 0 });
    fireEvent.click(screen.getByRole("button", { name: "기록 파일 가져오기" }));
    const dialog = await screen.findByRole("dialog", { name: "가져온 기록으로 바꿀까요?" });
    expect(store.get(STATE_KEY)).toEqual({ version: 0 });
    fireEvent.click(within(dialog).getByRole("button", { name: "가져오기" }));
    await screen.findByText("기록 파일을 가져왔어요.");
    expect(await stateIO.loadState(deck)).toEqual(seeded());
    expect((screen.getByRole("button", { name: "역할 배정" }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();
    deck.dispose();
  });
  it("keeps corrupt state on failed recovery and allows confirmed successful new task", async () => {
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
  it("starts at input and records only actual completion", async () => {
    const { deck, view } = await setup();
    expect(screen.queryByRole("button", { name: "역할 배정" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), {
      target: { value: "1 학생가\n2 학생나\n3 학생다" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "역할과 필요인원" }), { target: { value: "자료 1" } });
    fireEvent.click(screen.getByRole("button", { name: "명단·역할 적용" }));
    await screen.findByText("명단·역할을 적용했어요. 바로 역할을 배정해 주세요.");
    expect((await stateIO.loadState(deck)).cycle).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "역할 배정" }));
    await screen.findByText("역할을 배정했어요. 실제로 수행한 학생만 완료로 기록해 주세요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    expect((await stateIO.loadState(deck)).draft).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "수행 완료" }));
    await screen.findByText("실제 수행 완료를 한 번 기록했어요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "마지막 완료 되돌리기" }));
    await screen.findByText("마지막 수행 완료를 되돌렸어요.");
    expect((await stateIO.loadState(deck)).events).toHaveLength(0);
    view.unmount();
    deck.dispose();
  });
  it("preserves previous assignment on write failure", async () => {
    const original = seeded();
    const { deck, view, store } = await setup(original, true);
    fireEvent.click(screen.getByRole("button", { name: "역할 배정" }));
    await screen.findByText("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
    expect(store.get(STATE_KEY)).toEqual(original);
    expect(screen.queryByRole("button", { name: "수행 완료" })).toBeNull();
    view.unmount();
    deck.dispose();
  });
  it("shows only public assignment fields on projector view", async () => {
    const { deck, view } = await setup(seeded());
    fireEvent.click(screen.getByRole("button", { name: "역할 배정" }));
    await screen.findByText("역할을 배정했어요. 실제로 수행한 학생만 완료로 기록해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "학생에게 보여주기" }));
    await screen.findByRole("button", { name: "교사용 화면" });
    expect(screen.queryByText("학생 고정·제외 조건")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/9회/)).toBeNull();
    expect(screen.getByText("자료")).toBeTruthy();
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
  const { deck, view } = await setup(
    applySetup(emptyState(), students, [{ id: "j1", title: "자료", capacity: 1 }], "합성 대규모"),
  );
  expect(screen.queryByLabelText("1번 이번 제외")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 고정·제외 조건" }));
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

it("cancels role generation without writing a new assignment", async () => {
  vi.spyOn(plannerClient, "generateInWorker").mockImplementation(
    (_state, _id, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("cancel", "AbortError")), { once: true }),
      ),
  );
  const original = seeded(),
    { deck, view } = await setup(original);
  fireEvent.click(screen.getByRole("button", { name: "역할 배정" }));
  fireEvent.click(await screen.findByRole("button", { name: "배정 취소" }));
  await screen.findByText("배정을 취소했어요. 이전 배정은 유지했어요.");
  expect(await stateIO.loadState(deck)).toEqual(original);
  view.unmount();
  deck.dispose();
});
