// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { ACTIVE_LEDGER, loadLedger, replaceLedger, saveLedgerMonths } from "./ledger.ts";
import { initialState, STATE_KEY } from "./state.ts";
async function fixture() {
  const values = new Map<string, unknown>([
    [STATE_KEY, { damaged: true }],
    ["planner.month.2026-10", { damaged: true }],
  ]);
  let fail = "";
  const host = createMockHost({
    module: { id: "duty-planner", version: "0.4.0" },
    granted: ["storage"],
    handlers: {
      "storage.get": (a) => values.get((a as { key: string }).key) ?? null,
      "storage.set": (a) => {
        const { key, value } = a as { key: string; value: unknown };
        if (key === fail) throw new Error("SYNTHETIC_WRITE_FAILURE");
        values.set(key, value);
        return null;
      },
      "storage.delete": (a) => {
        values.delete((a as { key: string }).key);
        return null;
      },
    },
  });
  return {
    deck: await connect({ window: host.window }),
    values,
    fail: (key: string) => {
      fail = key;
    },
  };
}
describe("atomic recovery generations", () => {
  it("preserves corrupt legacy records, cleans failed staging and recovers only after pointer commit", async () => {
    const f = await fixture(),
      state = initialState(new Date(2026, 9, 1)),
      months = { "2026-10": state };
    f.fail(ACTIVE_LEDGER);
    await expect(replaceLedger(f.deck, months, "2026-10")).rejects.toThrow();
    expect([...f.values.keys()]).toEqual([STATE_KEY, "planner.month.2026-10"]);
    expect(await loadLedger(f.deck)).toBeNull();
    f.fail("");
    await replaceLedger(f.deck, months, "2026-10");
    expect(required(await loadLedger(f.deck)).current).toEqual(state);
    expect(f.values.get(STATE_KEY)).toEqual({ damaged: true });
    expect(f.values.get("planner.month.2026-10")).toEqual({ damaged: true });
    f.deck.dispose();
  });
  it("keeps every prior month on a failed save and commits all edited months together on retry", async () => {
    const f = await fixture(),
      oct = initialState(new Date(2026, 9, 1)),
      nov = initialState(new Date(2026, 10, 1));
    await replaceLedger(f.deck, { "2026-10": oct }, "2026-10");
    const before = new Map(f.values);
    const edited = { ...oct, memo: { "6": "새 합성 메모" } };
    f.fail(ACTIVE_LEDGER);
    await expect(saveLedgerMonths(f.deck, { "2026-10": edited, "2026-11": nov }, "2026-11")).rejects.toThrow();
    expect(f.values).toEqual(before);
    expect(required(await loadLedger(f.deck)).current).toEqual(oct);
    f.fail("");
    await saveLedgerMonths(f.deck, { "2026-10": edited, "2026-11": nov }, "2026-11");
    expect(required(await loadLedger(f.deck)).months).toEqual({ "2026-10": edited, "2026-11": nov });
    expect(required(await loadLedger(f.deck)).current).toEqual(nov);
    expect([...f.values.keys()].filter((k) => k.startsWith("planner.ledger.") && k !== ACTIVE_LEDGER)).toHaveLength(2);
    f.deck.dispose();
  });
  it("rejects a corrupt pointer instead of falling back to older records", async () => {
    const f = await fixture();
    f.values.set(ACTIVE_LEDGER, { version: 1, generation: "../", current: "2026-10", months: ["2026-10"] });
    await expect(loadLedger(f.deck)).rejects.toThrow("STORED_DATA_INVALID");
    f.deck.dispose();
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("SYNTHETIC_FIXTURE_MISSING");
  return value;
}
