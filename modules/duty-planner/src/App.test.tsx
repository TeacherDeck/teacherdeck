// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    module: { id: "duty-planner", version: "0.1.0" },
    granted: ["storage"],
    handlers: {
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
  it("applies pasted roster, generates and saves without changing actual history", async () => {
    const { deck, values } = await open();
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
