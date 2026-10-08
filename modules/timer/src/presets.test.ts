// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: host interaction tested against the SDK mock host.
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRESETS_SEC, PRESETS_KEY, addPreset, loadPresets, sanitize } from "./presets.ts";

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

describe("presets", () => {
  it("falls back to defaults for missing or broken data", async () => {
    const { host } = hostWithStore({ [PRESETS_KEY]: "broken" });
    const deck = await connect({ window: host.window });
    expect(await loadPresets(deck)).toEqual(DEFAULT_PRESETS_SEC);
    deck.dispose();
  });

  it("saves through the storage capability", async () => {
    const { host, store } = hostWithStore();
    const deck = await connect({ window: host.window });
    const next = await addPreset(deck, DEFAULT_PRESETS_SEC, 90);
    expect(next).toEqual([60, 90, 180, 300, 600]);
    expect(store.get(PRESETS_KEY)).toEqual(next);
    expect(host.requests.map((r) => `${r.cap}.${r.method}`)).toEqual(["storage.set"]);
    deck.dispose();
  });

  it("sanitizes values", () => {
    expect(sanitize([300, 60, 60, -1, 1.5, "x", 999_999])).toEqual([60, 300]);
    expect(sanitize(Array.from({ length: 20 }, (_, i) => (i + 1) * 60))).toHaveLength(8);
  });
});
