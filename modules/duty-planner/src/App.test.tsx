// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { plan, type PlanInput, type PlanResult } from "./planner.ts";
import { STATE_KEY, initialState, type PlannerState } from "./state.ts";
class TestWorker {
  onmessage: ((event: { data: PlanResult }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate() {}
  postMessage(input: PlanInput) {
    queueMicrotask(() => this.onmessage?.({ data: plan(input) }));
  }
}
beforeEach(() => vi.stubGlobal("Worker", TestWorker));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function open(saved: unknown = null) {
  const values = new Map<string, unknown>([[STATE_KEY, saved]]);
  const host = createMockHost({
    module: { id: "duty-planner", version: "0.2.0" },
    granted: ["storage"],
    handlers: {
      "storage.keys": () => [...values.keys()],
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "storage.set": (args) => {
        const a = args as { key: string; value: unknown };
        values.set(a.key, a.value);
        return null;
      },
    },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await screen.findByRole("heading", { name: "지도일배정기" });
  return { deck, values };
}
describe("planner user flow", () => {
  it("protects actual performer identities when replacing a roster", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = [
      { id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] },
      { id: "B", name: "교사B", past: 0, fixed: [], excluded: [], weekdays: [] },
    ];
    state.actual = { "1": ["A"] };
    const { deck, values } = await open(state);
    fireEvent.click(screen.getByText("여러 명 붙여넣기"));
    fireEvent.change(screen.getByRole("textbox", { name: "교사 명단" }), { target: { value: "교사B" } });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText("실제 수행 기록이 있는 교사를 빼려면 해당 날짜의 수행자를 먼저 수정하거나 비워 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect((values.get(STATE_KEY) as PlannerState).actual).toEqual({ "1": ["A"] }));
    expect((values.get(STATE_KEY) as PlannerState).input.teachers.map((t) => t.id)).toEqual(["A", "B"]);
    deck.dispose();
  });

  it("opens date editing from teacher names and holiday text anywhere in the date button", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] }];
    state.assignments = { "6": ["A"] };
    const { deck } = await open(state);
    const day = screen.getByRole("button", { name: "6일 배정 편집" });
    fireEvent.click(within(day).getByText("교사A"));
    expect(within(screen.getByRole("region", { name: "날짜별 직접 배정" })).getByText("6일 화요일")).toBeTruthy();
    expect(day.querySelector("button")).toBeNull();
    const holiday = screen.getByRole("button", { name: "9일 배정 편집" });
    fireEvent.click(within(holiday).getByText("한글날"));
    expect(within(screen.getByRole("region", { name: "날짜별 직접 배정" })).getByText("9일 금요일")).toBeTruthy();
    deck.dispose();
  });
  it("adds successive names with Enter, retains focus, and protects Korean composition", async () => {
    const { deck, values } = await open();
    const name = screen.getByRole("textbox", { name: "교사 이름" });
    name.focus();
    fireEvent.change(name, { target: { value: "교사A" } });
    fireEvent.compositionStart(name);
    fireEvent.keyDown(name, { key: "Enter", keyCode: 229, isComposing: true });
    expect((name as HTMLInputElement).value).toBe("교사A");
    expect((screen.getByRole("button", { name: "배정" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.compositionEnd(name);
    fireEvent.keyDown(name, { key: "Enter" });
    expect((name as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "교사B" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(document.activeElement).toBe(name);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    expect((values.get(STATE_KEY) as PlannerState).input.teachers.map((t) => t.name)).toEqual(["교사A", "교사B"]);
    deck.dispose();
  });
  it("adds a teacher with a plain name and shows the calendar before bulk roster editing", async () => {
    const { deck, values } = await open();
    expect(screen.queryByRole("textbox", { name: "교사 명단" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "교사 이름" }), { target: { value: "교사A" } });
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect((screen.getByRole("button", { name: "배정" }) as HTMLButtonElement).disabled).toBe(false);
    const calendar = screen.getByRole("region", { name: "월별 배정 달력" });
    const roster = screen.getByRole("region", { name: "교사 명단과 배정 횟수" });
    expect(calendar.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    expect((values.get(STATE_KEY) as PlannerState).input.teachers[0]?.past).toBe(0);
    deck.dispose();
  });
  it("edits date exclusion and teacher fixed/excluded checks immediately without apply buttons", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] }];
    const { deck, values } = await open(state);
    fireEvent.click(screen.getByRole("button", { name: /교사A · 과거/ }));
    fireEvent.click(screen.getByRole("button", { name: "6일 배정 편집" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "6일에 교사A 고정" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "6일에 교사A 제외" }));
    expect(screen.queryByRole("button", { name: "교사 조건 적용" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "배정" }));
    await screen.findByText("6일 교사 제외 조건과 고정·직접 배정이 겹쳐요. 조건을 조정해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "7일 배정 편집" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "이 날짜는 지도하지 않아요" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    const saved = values.get(STATE_KEY) as PlannerState;
    expect(saved.input.excluded).toEqual([7]);
    expect(saved.input.teachers[0]?.fixed).toEqual([6]);
    expect(saved.input.teachers[0]?.excluded).toEqual([6]);
    deck.dispose();
  });
  it("replaces an assigned teacher immediately and keeps the replacement on regeneration", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = ["A", "B"].map((id) => ({
      id,
      name: `교사${id}`,
      past: 0,
      fixed: [],
      excluded: [],
      weekdays: [],
    }));
    state.assignments = { "1": ["A"] };
    const { deck, values } = await open(state);
    fireEvent.click(screen.getByRole("combobox", { name: "1번째 교사" }));
    fireEvent.click(await screen.findByRole("option", { name: "교사B" }));
    await screen.findByText("직접 배정을 적용했어요. 다시 배정해도 이 날짜는 유지돼요.");
    expect(screen.queryByRole("button", { name: "직접 배정 적용" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(screen.queryByText("조건에 맞게 배정해요")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    const saved = values.get(STATE_KEY) as PlannerState;
    expect(saved.input.manual["1"]).toEqual(["B"]);
    expect(saved.assignments["1"]).toEqual(["B"]);
    expect(saved.input.teachers.map((t) => t.past)).toEqual([0, 0]);
    deck.dispose();
  });
  it("applies pasted roster, generates and saves without changing actual history", async () => {
    const { deck, values } = await open();
    fireEvent.click(screen.getByRole("button", { name: "여러 명 붙여넣기" }));
    fireEvent.change(screen.getByRole("textbox", { name: "교사 명단" }), {
      target: { value: "교사A,3\n교사B,0\n교사C,0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    fireEvent.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(screen.queryByText("조건에 맞게 배정해요")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    const saved = values.get(STATE_KEY) as PlannerState;
    expect(saved.input.teachers.map((t) => t.past)).toEqual([3, 0, 0]);
    expect(Object.values(saved.assignments).flat().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(screen.queryByText("조건에 맞게 배정해요")).toBeNull());
    expect(saved.input.teachers.map((t) => t.past)).toEqual([3, 0, 0]);
    deck.dispose();
  });
  it("restores fixed/excluded conflicts and reports them without clearing constraints", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [1], excluded: [1], weekdays: [] }];
    const { deck, values } = await open(state);
    fireEvent.click(screen.getByRole("button", { name: "배정" }));
    await screen.findByText("1일 교사 제외 조건과 고정·직접 배정이 겹쳐요. 조건을 조정해 주세요.");
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
    expect((values.get(STATE_KEY) as PlannerState).input.teachers[0]?.fixed).toEqual([1]);
    deck.dispose();
  });
  it("protects corrupt saved data with a disabled save button", async () => {
    const { deck, values } = await open({ damaged: true });
    expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(values.get(STATE_KEY)).toEqual({ damaged: true });
    deck.dispose();
  });
});

it("shows holiday names and semantic weekdays without hiding selected fixed markers", async () => {
  const state = initialState(new Date(2026, 9, 1));
  state.input.year = 2026;
  state.input.month = 10;
  state.input.teachers = [{ id: "a", name: "교사A", past: 0, fixed: [8], excluded: [], weekdays: [] }];
  state.input.manual = { "8": ["a"] };
  state.assignments = { "8": ["a"] };
  state.actual = { "8": ["a"] };
  const { deck } = await open(state);
  const calendar = screen.getByRole("region", { name: "월별 배정 달력" });
  expect(within(calendar).getByText("한글날")).toBeTruthy();
  expect(within(calendar).getByText("일").getAttribute("data-day-tone")).toBe("red");
  expect(within(calendar).getByText("토").getAttribute("data-day-tone")).toBe("blue");
  expect(screen.getByRole("button", { name: "9일 배정 편집" }).getAttribute("data-day-tone")).toBe("red");
  fireEvent.click(screen.getByRole("button", { name: "8일 배정 편집" }));
  const cell = screen.getByRole("button", { name: "8일 배정 편집" });
  expect(cell.getAttribute("aria-pressed")).toBe("true");
  expect(within(cell).getByText(/직접 배정 · 고정 조건/)).toBeTruthy();
  expect(within(cell).getByText(/수행 기록 1명/)).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "1번째 교사" })).toBeTruthy();
  deck.dispose();
});

it("releases one manual constraint without changing any date assignments", async () => {
  const state = initialState(new Date(2026, 9, 1));
  state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] }];
  state.assignments = { "6": ["A"], "7": ["A"] };
  state.input.manual = { "6": ["A"] };
  const { deck, values } = await open(state);
  fireEvent.click(screen.getByRole("button", { name: "6일 배정 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "직접 배정 해제" }));
  expect(within(screen.getByRole("button", { name: "7일 배정 편집" })).getByText("교사A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
  expect((values.get(STATE_KEY) as PlannerState).assignments).toEqual(state.assignments);
  expect((values.get(STATE_KEY) as PlannerState).input.manual).toEqual({});
  deck.dispose();
});

it("clamps the selected day when changing to a shorter month and stores only a real date memo", async () => {
  const { deck, values } = await open(initialState(new Date(2026, 9, 1)));
  fireEvent.click(screen.getByRole("button", { name: "31일 배정 편집" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "월" }), { target: { value: "11" } });
  fireEvent.blur(screen.getByRole("spinbutton", { name: "월" }));
  expect(screen.queryByRole("button", { name: "31일 배정 편집" })).toBeNull();
  expect(within(screen.getByRole("region", { name: "날짜별 직접 배정" })).getByText("30일 월요일")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "날짜 메모" }), { target: { value: "합성 날짜 메모" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
  expect((values.get(STATE_KEY) as PlannerState).memo).toEqual({ "30": "합성 날짜 메모" });
  deck.dispose();
});

it("opens narrow-window date editing in a dialog at the selected calendar date and returns focus", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { deck } = await open(initialState(new Date(2026, 9, 1)));
  expect(screen.queryByRole("region", { name: "날짜별 직접 배정" })).toBeNull();
  const date = screen.getByRole("button", { name: "6일 배정 편집" });
  date.focus();
  fireEvent.click(date);
  const dialog = await screen.findByRole("dialog", { name: "10월 6일 배정 편집" });
  expect(within(dialog).getByRole("textbox", { name: "날짜 메모" })).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(date));
  deck.dispose();
});

it("keeps unaffected results through condition changes and a conflicting regeneration", async () => {
  const state = initialState(new Date(2026, 9, 1));
  state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] }];
  state.assignments = { "6": ["A"], "7": ["A"] };
  state.input.manual = { "6": ["A"] };
  const { deck, values } = await open(state);
  fireEvent.click(screen.getByRole("button", { name: "6일 배정 편집" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "이 날짜는 지도하지 않아요" }));
  expect(screen.getByText("6일 직접 배정과 조건이 겹쳐요. 직접 배정이나 조건을 조정해 주세요.")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: "7일 배정 편집" })).getByText("교사A")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "배정" }));
  await screen.findByText("6일 제외와 고정·직접 배정이 겹쳐요. 조건을 직접 조정해 주세요.");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("이 PC에 명단·조건·배정표를 저장했어요.");
  expect((values.get(STATE_KEY) as PlannerState).assignments).toEqual({ "7": ["A"] });
  expect((values.get(STATE_KEY) as PlannerState).input.manual).toEqual({ "6": ["A"] });
  deck.dispose();
});

it("closes date editing on a month transition and reopens at a valid month-end date", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { deck } = await open(initialState(new Date(2026, 9, 1)));
  const month = screen.getByRole("spinbutton", { name: "월" });
  fireEvent.click(screen.getByRole("button", { name: "31일 배정 편집" }));
  expect(screen.getByRole("dialog", { name: "10월 31일 배정 편집" })).toBeTruthy();
  fireEvent.change(month, { target: { value: "11" } });
  fireEvent.blur(month);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "30일 배정 편집" }));
  expect(screen.getByRole("dialog", { name: "11월 30일 배정 편집" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "날짜 메모" })).toBeTruthy();
  deck.dispose();
});

it("shows condition conflicts inside the narrow date dialog and removes invalid teacher labels from its calendar cell", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const state = initialState(new Date(2026, 9, 1));
  state.input.teachers = [{ id: "A", name: "교사A", past: 0, fixed: [], excluded: [], weekdays: [] }];
  state.input.manual = { "6": ["A"] };
  state.assignments = { "6": ["A"], "7": ["A"] };
  const { deck } = await open(state);
  fireEvent.click(screen.getByRole("button", { name: "6일 배정 편집" }));
  const dialog = screen.getByRole("dialog", { name: "10월 6일 배정 편집" });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "이 날짜는 지도하지 않아요" }));
  expect(within(dialog).getByText("6일 직접 배정과 조건이 겹쳐요. 직접 배정이나 조건을 조정해 주세요.")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
  const day = screen.getByRole("button", { name: "6일 배정 편집" });
  expect(within(day).queryByText("교사A")).toBeNull();
  expect(within(day).getByText("직접 배정 조건 충돌")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: "7일 배정 편집" })).getByText("교사A")).toBeTruthy();
  deck.dispose();
});
