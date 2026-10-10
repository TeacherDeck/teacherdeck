// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { arrange, confirm, emptyState, parseRoster, replaceRoster } from "./logic.ts";
import {
  AmbiguousStorageWrite,
  exportFile,
  loadState,
  publicText,
  readBackup,
  readRoster,
  saveState,
  STATE_KEY,
} from "./state.ts";
async function fixture() {
  const values = new Map<string, unknown>();
  let fail: (key: string) => "before" | "after" | null = () => null;
  let cancel = true;
  let readFailure = false;
  let writes = 0,
    closed = 0;
  const host = createMockHost({
    module: { id: "seat-planner", version: "0.1.0" },
    granted: ["storage", "fs", "window"],
    handlers: {
      "storage.get": (args) => {
        if (readFailure) throw new Error("SYNTHETIC_READ_FAILURE");
        return values.get((args as { key: string }).key) ?? null;
      },
      "storage.keys": () => [...values.keys()],
      "storage.delete": (args) => {
        values.delete((args as { key: string }).key);
        return null;
      },
      "storage.set": (args) => {
        const a = args as { key: string; value: unknown };
        const failure = fail(a.key);
        if (failure === "before") throw new Error("SYNTHETIC_FAILURE");
        expect(new TextEncoder().encode(JSON.stringify(a.value)).length).toBeLessThan(256 * 1024);
        values.set(a.key, a.value);
        if (failure === "after") throw new Error("SYNTHETIC_RESPONSE_FAILURE");
        return null;
      },
      "fs.pickFolder": () => (cancel ? null : { handle: "folder", displayName: "합성 폴더" }),
      "fs.createOutputFolder": () => ({ batchId: "batch", displayName: "합성 출력" }),
      "fs.writeBlob": () => {
        writes++;
        throw new Error("SYNTHETIC_WRITE_FAILURE");
      },
      "fs.closeOutputFolder": () => {
        closed++;
        return null;
      },
      "fs.pickFiles": () => [],
    },
  });
  const deck = await connect({ window: host.window });
  return {
    deck,
    values,
    setFail: (next: typeof fail) => {
      fail = next;
    },
    setCancel: (next: boolean) => {
      cancel = next;
    },
    setReadFailure: (next: boolean) => {
      readFailure = next;
    },
    writes: () => writes,
    closed: () => closed,
  };
}
function large() {
  let id = 0;
  const state = replaceRoster(
    emptyState(),
    parseRoster(Array.from({ length: 1000 }, (_, i) => `${i + 1} 합성학생${i + 1}`).join("\n"), [], () => `s${++id}`),
    "합성 수업",
  );
  state.layout = { rows: 40, columns: 25, frontRows: 1, aisles: [5, 10, 15, 20], blocked: [] };
  return confirm(
    arrange(state, () => 0.3),
    "h",
    "2026-10-01T00:00:00Z",
  );
}
describe("SDK durable seat state", () => {
  it("keeps both banks when a committed pointer cannot be reread, and recovers on reload", async () => {
    const f = await fixture();
    await saveState(f.deck, emptyState());
    f.setFail((key) => {
      if (key === STATE_KEY) {
        f.setReadFailure(true);
        return "after";
      }
      return null;
    });
    await expect(saveState(f.deck, large())).rejects.toBeInstanceOf(AmbiguousStorageWrite);
    expect([...f.values.keys()].some((key) => key.startsWith(`${STATE_KEY}.a.`))).toBe(true);
    expect([...f.values.keys()].some((key) => key.startsWith(`${STATE_KEY}.b.`))).toBe(true);
    f.setReadFailure(false);
    f.setFail(() => null);
    expect(await loadState(f.deck)).toEqual(large());
    await saveState(f.deck, { ...emptyState(), label: "다음 작업" });
    expect((await loadState(f.deck)).label).toBe("다음 작업");
    f.deck.dispose();
  });
  it("round trips 1000 students and snapshots through bounded chunks", async () => {
    const f = await fixture();
    const state = large();
    await saveState(f.deck, state);
    expect(await loadState(f.deck)).toEqual(state);
    expect(f.values.size).toBeGreaterThan(2);
    f.deck.dispose();
  });
  it.each(["chunk", "pointer"])("preserves current state after %s write failure and permits retry", async (phase) => {
    const f = await fixture();
    await saveState(f.deck, emptyState());
    f.setFail((key) =>
      phase === "pointer" ? (key === STATE_KEY ? "before" : null) : key.startsWith(`${STATE_KEY}.b.`) ? "before" : null,
    );
    await expect(saveState(f.deck, large())).rejects.toThrow();
    expect(await loadState(f.deck)).toEqual(emptyState());
    f.setFail(() => null);
    await saveState(f.deck, large());
    expect(await loadState(f.deck)).toEqual(large());
    f.deck.dispose();
  });
  it("recognizes a committed pointer after its response fails", async () => {
    const f = await fixture();
    await saveState(f.deck, emptyState());
    f.setFail((key) => (key === STATE_KEY ? "after" : null));
    await saveState(f.deck, large());
    expect(await loadState(f.deck)).toEqual(large());
    f.deck.dispose();
  });
  it("rejects mixed revisions and changed/truncated chunk data", async () => {
    for (const kind of ["revision", "length", "checksum"]) {
      const f = await fixture();
      await saveState(f.deck, large());
      const pointer = f.values.get(STATE_KEY) as { bank: string };
      const key = `${STATE_KEY}.${pointer.bank}.0`;
      const chunk = f.values.get(key) as { revision: string; text: string };
      f.values.set(key, {
        revision: kind === "revision" ? "wrong" : chunk.revision,
        text:
          kind === "length"
            ? chunk.text.slice(1)
            : kind === "checksum"
              ? chunk.text.replace("합성", "가상")
              : chunk.text,
      });
      await expect(loadState(f.deck)).rejects.toThrow();
      f.deck.dispose();
    }
  });
  it("cleans inactive orphan chunks and serializes concurrent writes", async () => {
    const f = await fixture();
    await saveState(f.deck, emptyState());
    f.values.set(`${STATE_KEY}.b.99`, { revision: "interrupted", text: "stale" });
    await Promise.all([saveState(f.deck, large()), saveState(f.deck, { ...emptyState(), label: "최종 작업" })]);
    expect((await loadState(f.deck)).label).toBe("최종 작업");
    expect(f.values.has(`${STATE_KEY}.b.99`)).toBe(false);
    f.deck.dispose();
  });
  it("preserves all values on quota preflight failure", async () => {
    const f = await fixture();
    await saveState(f.deck, emptyState());
    f.values.set("synthetic-other-record", "가".repeat(1700000));
    const previous = f.values.get(STATE_KEY);
    await expect(saveState(f.deck, large())).rejects.toThrow("공간");
    expect(f.values.get(STATE_KEY)).toEqual(previous);
    f.deck.dispose();
  });
  it("recovers malformed manifest only through an explicit replacement write", async () => {
    const f = await fixture();
    f.values.set(STATE_KEY, { kind: "seat-chunks", bank: "a", count: -1 });
    await expect(loadState(f.deck)).rejects.toThrow();
    await saveState(f.deck, emptyState());
    expect(await loadState(f.deck)).toEqual(emptyState());
    f.deck.dispose();
  });
  it("cancels file pickers without writing and closes failed export batches", async () => {
    const f = await fixture();
    expect(await exportFile(f.deck, emptyState())).toBe(false);
    expect(await readBackup(f.deck)).toBeNull();
    expect(await readRoster(f.deck)).toBeNull();
    expect(f.writes()).toBe(0);
    f.setCancel(false);
    await expect(exportFile(f.deck, emptyState())).rejects.toThrow();
    expect(f.closed()).toBe(1);
    f.deck.dispose();
  });
  it("exports only snapshot identities in the student copy", () => {
    const state = large(),
      snapshot = state.history[0];
    if (!snapshot) throw new Error("SYNTHETIC_MISSING_SNAPSHOT");
    const text = publicText(snapshot);
    expect(text).toContain("1번 합성학생1");
    expect(text).not.toContain("fixed");
    expect(text).not.toContain("excluded");
    expect(text).not.toContain('"s1"');
  });
});
