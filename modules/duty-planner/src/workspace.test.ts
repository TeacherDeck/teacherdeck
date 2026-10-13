// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { expect, it } from "vitest";
import { emptyDetailedDraft } from "./detailed-draft.ts";
import { initialState } from "./state.ts";
import { loadWorkspace, saveWorkspace, type Workspace } from "./workspace.ts";
const sample = (): Workspace => {
  const state = initialState(new Date(2026, 9, 1));
  return {
    state,
    months: { "2026-10": state },
    roster: "합성 명단",
    timetableText: "입력 중 시간표",
    newName: "합성교사",
    backupText: "",
    legacyYear: null,
    replacementPending: false,
    teacherId: "",
    selectedDay: "1",
    manualSelection: [""],
    actualSlots: {},
    detailedDraft: emptyDetailedDraft(),
  };
};
async function setup() {
  const values = new Map<string, unknown>();
  let fail = false;
  let quota = Number.POSITIVE_INFINITY;
  const host = createMockHost({
    granted: ["storage"],
    handlers: {
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "storage.set": (args) => {
        const { key, value } = args as { key: string; value: unknown };
        if (fail && key === "workspace.active.v1") throw new Error("POINTER_FAILURE");
        if (new TextEncoder().encode(JSON.stringify(value)).length > 256 * 1024) throw new Error("KEY_LIMIT");
        const staged = new Map(values).set(key, value);
        const total = [...staged.values()].reduce<number>(
          (sum, entry) => sum + new TextEncoder().encode(JSON.stringify(entry)).length,
          0,
        );
        if (total > quota) throw new Error("QUOTA");
        values.set(key, value);
      },
      "storage.delete": (args) => {
        values.delete((args as { key: string }).key);
      },
    },
  });
  const deck = await connect({ window: host.window });
  return {
    deck,
    values,
    fail: () => {
      fail = true;
    },
    quota: (limit: number) => {
      quota = limit;
    },
  };
}
it("round trips a workspace larger than one storage value without losing Unicode or partial form fields", async () => {
  const f = await setup();
  const value = { ...sample(), roster: "합성🧪".repeat(50001), timetableText: "월\t2\t" };
  await saveWorkspace(f.deck, value);
  expect(await loadWorkspace(f.deck)).toEqual(value);
  expect(f.values.size).toBeGreaterThan(2);
  f.deck.dispose();
});
it("preserves the prior generation when total module quota cannot fit both old and staged drafts", async () => {
  const f = await setup();
  const prior = sample();
  await saveWorkspace(f.deck, prior);
  const keys = [...f.values.keys()];
  const occupied = [...f.values.values()].reduce<number>(
    (sum, value) => sum + new TextEncoder().encode(JSON.stringify(value)).length,
    0,
  );
  f.quota(occupied + 100);
  await expect(saveWorkspace(f.deck, { ...prior, roster: "아직 저장하지 못한 합성 입력" })).rejects.toThrow();
  expect(await loadWorkspace(f.deck)).toEqual(prior);
  expect([...f.values.keys()]).toEqual(keys);
  f.deck.dispose();
});
it("retains the previous complete draft and removes only new staging keys when the pointer write fails", async () => {
  const f = await setup();
  const prior = sample();
  await saveWorkspace(f.deck, prior);
  const keys = [...f.values.keys()];
  f.fail();
  await expect(saveWorkspace(f.deck, { ...prior, newName: "다른 합성교사" })).rejects.toThrow();
  expect(await loadWorkspace(f.deck)).toEqual(prior);
  expect([...f.values.keys()]).toEqual(keys);
  f.deck.dispose();
});
it("rejects an incomplete stored workspace instead of replacing missing work with defaults", async () => {
  const f = await setup();
  await saveWorkspace(f.deck, sample());
  const part = [...f.values.keys()].find((key) => key !== "workspace.active.v1");
  if (!part) throw new Error("MISSING_TEST_CHUNK");
  f.values.delete(part);
  await expect(loadWorkspace(f.deck)).rejects.toThrow("WORKSPACE_INVALID");
  f.deck.dispose();
});
