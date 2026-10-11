// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { applySetup, confirm, decodeState, emptyState, generate, parseRoster } from "./logic.ts";
import { loadState, saveState, STATE_KEY } from "./state.ts";
import { packRecords, unpackRecords } from "./record-packing.ts";
function fixture() {
  let id = 0;
  return applySetup(
    emptyState(),
    parseRoster(Array.from({ length: 1000 }, (_, i) => `${i + 1}\t합성학생${i + 1}`).join("\n"), [], () => `s${++id}`),
    "합성모둠",
    [],
    "size",
    4,
  );
}
function hostStorage(initial: unknown = null) {
  const values = new Map<string, unknown>([[STATE_KEY, initial]]);
  let failKey = "";
  const host = createMockHost({
    module: { id: "group-planner", version: "0.1.0" },
    granted: ["storage"],
    handlers: {
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "storage.keys": () => [...values.keys()],
      "storage.delete": (args) => {
        values.delete((args as { key: string }).key);
        return null;
      },
      "storage.set": (args) => {
        const { key, value } = args as { key: string; value: unknown };
        if (failKey && key === failKey) throw new Error("WRITE_FAILED");
        values.set(key, value);
        return null;
      },
    },
  });
  return {
    host,
    values,
    fail: (key: string) => {
      failKey = key;
    },
  };
}
describe("group history local storage", () => {
  it("packs 20 full 1000-student snapshots losslessly and fits storage limits", async () => {
    let state = fixture();
    for (let i = 0; i < 20; i++) {
      state = generate(state, () => (i + 1) / 21);
      state = confirm(state, `h${i}`, new Date(Date.UTC(2026, 0, i + 1)).toISOString());
    }
    expect(decodeState(unpackRecords(packRecords(state)))).toEqual(state);
    const bytes = new TextEncoder().encode(JSON.stringify(packRecords(state))).length;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    const mock = hostStorage(),
      deck = await connect({ window: mock.host.window });
    await saveState(deck, state);
    expect(await loadState(deck)).toEqual(state);
    expect(
      [...mock.values.values()].every((v) => new TextEncoder().encode(JSON.stringify(v)).length < 240 * 1024),
    ).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(Object.fromEntries(mock.values))).length).toBeLessThan(
      5 * 1024 * 1024,
    );
    console.info(`group 20 snapshots x1000: ${bytes} packed bytes`);
    deck.dispose();
  });
  it("reads legacy JSON, preserves prior generation on pointer failure and recovers only explicitly", async () => {
    const original = fixture(),
      mock = hostStorage(original),
      deck = await connect({ window: mock.host.window });
    expect(await loadState(deck)).toEqual(original);
    await saveState(deck, original);
    mock.fail(STATE_KEY);
    await expect(
      saveState(
        deck,
        generate(original, () => 0.5),
      ),
    ).rejects.toThrow();
    expect(await loadState(deck)).toEqual(original);
    mock.fail("");
    mock.values.set(STATE_KEY, { version: 0 });
    await expect(saveState(deck, emptyState())).rejects.toThrow();
    expect(mock.values.get(STATE_KEY)).toEqual({ version: 0 });
    await saveState(deck, emptyState(), { recover: true });
    expect(await loadState(deck)).toEqual(emptyState());
    deck.dispose();
  });
  it("rejects invalid dictionary indexes and excessive packed histories", () => {
    expect(() =>
      unpackRecords({ format: "deck-group-history-v1", strings: [], state: { history: [[0, 0, 0, [], []]] } }),
    ).toThrow();
    expect(() =>
      unpackRecords({ format: "deck-group-history-v1", strings: [], state: { history: Array(21).fill([]) } }),
    ).toThrow();
  });
});
