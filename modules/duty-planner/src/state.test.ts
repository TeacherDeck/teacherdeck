// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { plan } from "./planner.ts";
import { STATE_KEY, initialState, loadState, sanitizeState, saveState } from "./state.ts";
function setup(value: unknown = null) {
  const store = new Map<string, unknown>([[STATE_KEY, value]]);
  const host = createMockHost({
    module: { id: "duty-planner", version: "0.1.0" },
    granted: ["storage"],
    handlers: {
      "storage.get": (args) => store.get((args as { key: string }).key) ?? null,
      "storage.set": (args) => {
        const a = args as { key: string; value: unknown };
        store.set(a.key, a.value);
        return null;
      },
    },
  });
  return { host, store };
}
describe("planner storage", () => {
  it("restores draft, constraints and assignments through storage only", async () => {
    const state = initialState(new Date(2026, 9, 1));
    state.input.teachers = [
      { id: "A", name: "교사A", past: 4, fixed: [1], excluded: [2], weekdays: [] },
      { id: "B", name: "교사B", past: 2, fixed: [], excluded: [], weekdays: [] },
    ];
    state.input.manual = { "5": ["B"] };
    state.assignments = plan(state.input).assignments;
    const { host, store } = setup();
    const deck = await connect({ window: host.window });
    await saveState(deck, state);
    expect(store.get(STATE_KEY)).toEqual(state);
    expect(await loadState(deck)).toEqual(state);
    expect(host.requests.map((r) => `${r.cap}.${r.method}`)).toEqual(["storage.set", "storage.get"]);
    deck.dispose();
  });
  it("distinguishes missing data from corrupt stored data", async () => {
    const missing = setup();
    const emptyDeck = await connect({ window: missing.host.window });
    expect(await loadState(emptyDeck)).toBeNull();
    emptyDeck.dispose();
    const corrupt = setup({ input: "broken" });
    const deck = await connect({ window: corrupt.host.window });
    await expect(loadState(deck)).rejects.toThrow("STORED_DATA_INVALID");
    expect(corrupt.store.get(STATE_KEY)).toEqual({ input: "broken" });
    deck.dispose();
  });
  it("rejects invalid and oversized state before sending storage writes", async () => {
    const { host } = setup();
    const deck = await connect({ window: host.window });
    const state = initialState();
    state.input.teachers = Array.from({ length: 500 }, (_, n) => ({
      id: `teacher-${n}`,
      name: `교사${"가".repeat(94)}${n}`,
      past: 0,
      fixed: Array.from({ length: 31 }, (_, j) => j + 1),
      excluded: Array.from({ length: 31 }, (_, j) => j + 1),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    }));
    await expect(saveState(deck, state)).rejects.toThrow("STORAGE_SIZE_LIMIT");
    expect(host.requests).toHaveLength(0);
    expect(sanitizeState({ input: { year: -1 } })).toBeNull();
    deck.dispose();
  });
});
