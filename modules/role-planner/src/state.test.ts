// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, type Deck } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { emptyState } from "./logic.ts";
import { loadState, saveState, STATE_KEY } from "./state.ts";
describe("role scoped state", () => {
  it("round trips 1000 synthetic students and 10000 full UUID performance records", async () => {
    const data = new Map<string, unknown>();
    const deck: Pick<Deck, "storage"> = {
      storage: {
        get: async <T>(key: string) => (structuredClone(data.get(key)) ?? null) as T | null,
        set: async (key, value) => {
          expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThan(240 * 1024);
          data.set(key, structuredClone(value));
        },
        delete: async (key) => {
          data.delete(key);
        },
        keys: async () => [...data.keys()],
      },
    };
    const state = emptyState();
    state.cycle = 11;
    state.students = Array.from({ length: 1000 }, (_, i) => ({
      id: crypto.randomUUID(),
      number: i + 1,
      name: `가상학생${i + 1}`,
      baseCount: 0,
    }));
    const jobId = crypto.randomUUID(),
      draftIds = Array.from({ length: 10 }, () => crypto.randomUUID());
    state.jobs = [{ id: jobId, title: "가상역할", capacity: 1000 }];
    state.events = Array.from({ length: 10000 }, (_, i) => {
      const student = state.students[i % 1000],
        draftId = draftIds[Math.floor(i / 1000)];
      if (!student || !draftId) throw new Error("TEST_SETUP");
      return {
        id: crypto.randomUUID(),
        draftId,
        cycle: Math.floor(i / 1000) + 1,
        studentId: student.id,
        number: student.number,
        name: student.name,
        jobId,
        jobTitle: "가상역할",
        completedAt: "2000-01-01T00:00:00.000Z",
      };
    });
    await saveState(deck, state);
    expect(await loadState(deck)).toEqual(state);
    await saveState(deck, state);
    expect(await loadState(deck)).toEqual(state);
    expect(new TextEncoder().encode(JSON.stringify(Object.fromEntries(data))).length).toBeLessThan(5 * 1024 * 1024);
  });
  it("round trips only through module storage", async () => {
    const saved = new Map<string, unknown>();
    const host = createMockHost({
      module: { id: "role-planner", version: "0.1.0" },
      granted: ["storage"],
      handlers: {
        "storage.get": (args) => saved.get((args as { key: string }).key) ?? null,
        "storage.keys": () => [...saved.keys()],
        "storage.delete": (args) => {
          saved.delete((args as { key: string }).key);
          return null;
        },
        "storage.set": (args) => {
          const { key, value } = args as { key: string; value: unknown };
          saved.set(key, value);
          return null;
        },
      },
    });
    const deck = await connect({ window: host.window });
    expect(await loadState(deck)).toEqual(emptyState());
    await saveState(deck, emptyState());
    expect(await loadState(deck)).toEqual(emptyState());
    expect(saved.has(STATE_KEY)).toBe(true);
    expect(host.requests.every((r) => r.cap === "storage")).toBe(true);
    deck.dispose();
  });
  it("rejects corrupt saved data without overwriting", async () => {
    const host = createMockHost({
      module: { id: "role-planner", version: "0.1.0" },
      granted: ["storage"],
      handlers: { "storage.get": () => ({ version: 0 }) },
    });
    const deck = await connect({ window: host.window });
    await expect(loadState(deck)).rejects.toThrow();
    expect(host.requests.map((r) => r.method)).toEqual(["get"]);
    deck.dispose();
  });
});
