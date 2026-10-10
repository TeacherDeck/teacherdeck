// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: host interaction tested against the SDK mock host.
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { MAX_RECENT, RECENT_KEY, SOUND_KEY, loadRecent, loadSound, pushRecent, sanitize, saveSound } from "./recent.ts";

function hostWithStore(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial));
  const host = createMockHost({
    module: { id: "timer", version: "0.1.0" },
    granted: ["storage", "window"],
    handlers: {
      "storage.get": (a) => store.get((a as { key: string }).key) ?? null,
      "storage.set": (a) => {
        const { key, value } = a as { key: string; value: unknown };
        store.set(key, value);
        return null;
      },
    },
  });
  return { host, store };
}

describe("recent", () => {
  it("starts empty for missing or broken data", async () => {
    const { host } = hostWithStore({ [RECENT_KEY]: "broken" });
    const deck = await connect({ window: host.window });
    expect(await loadRecent(deck)).toEqual([]);
    deck.dispose();
  });

  it("puts the newest first and saves through the storage capability", async () => {
    const { host, store } = hostWithStore();
    const deck = await connect({ window: host.window });
    const next = await pushRecent(deck, [300, 60, 600], 60);
    expect(next).toEqual([60, 300, 600]);
    expect(store.get(RECENT_KEY)).toEqual(next);
    expect(host.requests.map((r) => `${r.cap}.${r.method}`)).toEqual(["storage.set"]);
    deck.dispose();
  });

  it("sanitizes values and keeps only the latest few", () => {
    expect(sanitize([300, 60, 300, -1, 1.5, "x", 999_999])).toEqual([300, 60]);
    expect(sanitize(Array.from({ length: 20 }, (_, i) => (i + 1) * 60))).toHaveLength(MAX_RECENT);
  });
});

describe("sound setting", () => {
  it("is on by default and remembers being turned off", async () => {
    const { host, store } = hostWithStore();
    const deck = await connect({ window: host.window });
    expect(await loadSound(deck)).toBe(true);
    await saveSound(deck, false);
    expect(store.get(SOUND_KEY)).toBe(false);
    expect(await loadSound(deck)).toBe(false);
    deck.dispose();
  });
});
