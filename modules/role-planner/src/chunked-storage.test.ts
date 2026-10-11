// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { describe, expect, it } from "vitest";
import { MAX_STATE_BYTES, readChunked, writeChunked } from "./chunked-storage.ts";
function fixture() {
  const data = new Map<string, unknown>();
  let calls = 0;
  let fail: (key: string, value: unknown) => "before" | "after" | null = () => null;
  let failGet = false;
  const storage: Deck["storage"] = {
    get: async <T>(key: string) => {
      if (failGet) throw new Error("SYNTHETIC_READ_FAILURE");
      return (structuredClone(data.get(key)) ?? null) as T | null;
    },
    set: async (key, value) => {
      calls++;
      const failure = fail(key, value);
      if (failure === "before") throw new Error("SYNTHETIC_WRITE_FAILURE");
      if (new TextEncoder().encode(JSON.stringify(value)).length >= 240 * 1024) throw new Error("VALUE_LIMIT");
      const trial = Object.fromEntries(data);
      trial[key] = value;
      if (new TextEncoder().encode(JSON.stringify(trial)).length > 5 * 1024 * 1024) throw new Error("QUOTA");
      data.set(key, structuredClone(value));
      if (failure === "after") throw new Error("SYNTHETIC_RESPONSE_FAILURE");
    },
    delete: async (key) => {
      data.delete(key);
    },
    keys: async () => [...data.keys()],
  };
  return {
    storage,
    data,
    setFail: (value: typeof fail) => {
      fail = value;
    },
    setReadFailure: (value: boolean) => {
      failGet = value;
    },
    calls: () => calls,
  };
}
const key = "synthetic-state.v1";
const large = { rows: Array.from({ length: 10000 }, (_, i) => ({ id: `synthetic-${i}`, text: `가상항목${i} 가😀` })) };
describe("generation storage", () => {
  it("reads legacy JSON and round trips UTF8 chunks under individual and total quotas", async () => {
    const f = fixture();
    f.data.set(key, { legacy: true });
    expect(await readChunked(f.storage, key)).toEqual({ legacy: true });
    await writeChunked(f.storage, key, large);
    expect(await readChunked(f.storage, key)).toEqual(large);
    expect([...f.data.keys()].filter((name) => name.includes(".chunk.")).length).toBeGreaterThan(1);
    await writeChunked(f.storage, key, { fresh: true });
    expect(await readChunked(f.storage, key)).toEqual({ fresh: true });
    expect(f.data.size).toBe(2);
  });
  it("chunk write and pointer write failures preserve the previous generation", async () => {
    for (const atPointer of [false, true]) {
      const f = fixture();
      await writeChunked(f.storage, key, { previous: true });
      f.setFail((name) => ((atPointer ? name === key : name.includes(".chunk.")) ? "before" : null));
      await expect(writeChunked(f.storage, key, large)).rejects.toThrow();
      expect(await readChunked(f.storage, key)).toEqual({ previous: true });
      f.setFail(() => null);
      await writeChunked(f.storage, key, large);
      expect(await readChunked(f.storage, key)).toEqual(large);
    }
  });
  it("a committed pointer with a failed response never loses the new chunks", async () => {
    const f = fixture();
    await writeChunked(f.storage, key, { previous: true });
    f.setFail((name) => (name === key ? "after" : null));
    await writeChunked(f.storage, key, large);
    expect(await readChunked(f.storage, key)).toEqual(large);
  });
  it("an ambiguous commit preserves both generations until a later verified cleanup", async () => {
    const f = fixture();
    await writeChunked(f.storage, key, { previous: true });
    f.setFail((name) => {
      if (name !== key) return null;
      f.setReadFailure(true);
      return "after";
    });
    await expect(writeChunked(f.storage, key, large)).rejects.toThrow();
    f.setReadFailure(false);
    expect(await readChunked(f.storage, key)).toEqual(large);
    f.setFail(() => null);
    await writeChunked(f.storage, key, { recovered: true });
    expect(f.data.size).toBe(2);
  });
  it("rejects missing, altered, or mixed generation chunks without overwriting", async () => {
    for (const corrupt of ["missing", "text", "generation"]) {
      const f = fixture();
      await writeChunked(f.storage, key, large);
      const name = [...f.data.keys()].find((item) => item.includes(".chunk."));
      if (!name) throw new Error("TEST_SETUP");
      if (corrupt === "missing") f.data.delete(name);
      else {
        const chunk = f.data.get(name) as { generation: string; text: string };
        f.data.set(name, { ...chunk, [corrupt]: "broken" });
      }
      const before = structuredClone([...f.data]);
      await expect(readChunked(f.storage, key)).rejects.toThrow();
      await expect(writeChunked(f.storage, key, { fresh: true })).rejects.toThrow();
      expect([...f.data]).toEqual(before);
    }
  });
  it("rejects state and combined quota overflow while preserving current state", async () => {
    const f = fixture();
    await writeChunked(f.storage, key, { previous: true });
    await expect(writeChunked(f.storage, key, { text: "x".repeat(MAX_STATE_BYTES) })).rejects.toThrow();
    for (let i = 0; i < 20; i++) f.data.set(`other.${i}`, "x".repeat(230000));
    await expect(writeChunked(f.storage, key, large)).rejects.toThrow();
    expect(await readChunked(f.storage, key)).toEqual({ previous: true });
  });
  it("serializes concurrent saves and leaves a single consistent final generation", async () => {
    const f = fixture();
    await Promise.all([writeChunked(f.storage, key, large), writeChunked(f.storage, key, { last: true })]);
    expect(await readChunked(f.storage, key)).toEqual({ last: true });
    expect(f.data.size).toBe(2);
  });
  it("serializes reads with commits and garbage collection", async () => {
    const f = fixture();
    const first = writeChunked(f.storage, key, large);
    const readFirst = readChunked(f.storage, key);
    const last = writeChunked(f.storage, key, { last: true });
    const readLast = readChunked(f.storage, key);
    await Promise.all([first, last]);
    expect(await readFirst).toEqual(large);
    expect(await readLast).toEqual({ last: true });
  });
  it("allows explicit recovery, preserving damaged chunks until pointer commit succeeds", async () => {
    const f = fixture();
    await writeChunked(f.storage, key, large);
    const name = [...f.data.keys()].find((item) => item.includes(".chunk."));
    if (!name) throw new Error("TEST_SETUP");
    f.data.set(name, { generation: "broken", text: "broken" });
    const before = structuredClone([...f.data]);
    f.setFail((name) => (name === key ? "before" : null));
    await expect(writeChunked(f.storage, key, { recovered: true }, { recover: true })).rejects.toThrow();
    expect([...f.data]).toEqual(before);
    f.setFail(() => null);
    await writeChunked(f.storage, key, { recovered: true }, { recover: true });
    expect(await readChunked(f.storage, key)).toEqual({ recovered: true });
    expect(f.data.size).toBe(2);
  });
});
