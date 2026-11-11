// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { exportBackup, pickBackup, replaceDocument } from "./files.ts";
import { emptyDocument, STATE_KEY, type Item } from "./logic.ts";
afterEach(() => vi.unstubAllGlobals());
const value = {
  ...emptyDocument(),
  items: [
    {
      id: "one",
      title: "합성 메모",
      body: "기억할 내용",
      pinned: false,
      tone: "neutral",
      archived: false,
      updatedAt: "2026-10-11T00:00:00Z",
    } as Item,
  ],
};
it("preserves damaged storage before recovery and leaves active data untouched when either write fails", async () => {
  const damaged = { broken: "synthetic" },
    values = new Map<string, unknown>([[STATE_KEY, damaged]]);
  let failure = "recovery";
  const host = createMockHost({
    granted: ["storage"],
    handlers: {
      "storage.get": (a) => values.get((a as { key: string }).key) ?? null,
      "storage.set": (a) => {
        const { key, value } = a as { key: string; value: unknown };
        if ((failure === "recovery" && key.startsWith("recovery.")) || failure === key)
          throw new DeckCallError("INTERNAL", "합성 오류");
        values.set(key, value);
        return null;
      },
    },
  });
  const deck = await connect({ window: host.window });
  await expect(replaceDocument(deck, value)).rejects.toThrow();
  expect(values.size).toBe(1);
  expect(values.get(STATE_KEY)).toBe(damaged);
  failure = STATE_KEY;
  await expect(replaceDocument(deck, value)).rejects.toThrow();
  expect(values.get(STATE_KEY)).toBe(damaged);
  expect([...values.entries()].some(([key, entry]) => key.startsWith("recovery.") && entry === damaged)).toBe(true);
  failure = "";
  await replaceDocument(deck, value);
  expect(values.get(STATE_KEY)).toEqual(value);
  deck.dispose();
});
it("writes real JSON chunks, preserves archives and closes the batch on output failure", async () => {
  let failed = false;
  const bytes: number[] = [];
  const host = createMockHost({
    granted: ["fs"],
    handlers: {
      "fs.pickFolder": () => ({ handle: "parent", name: "합성" }),
      "fs.openOutputFolder": () => ({ batchId: "batch", folder: { handle: "folder", name: "합성" } }),
      "fs.beginWrite": () => ({ writeId: "write", chunkBytes: 65536 }),
      "fs.writeChunk": (a) => {
        if (failed) throw new DeckCallError("INTERNAL", "합성 오류");
        const args = a as { offset: number; data: number[] };
        bytes.push(...args.data);
        return { nextOffset: args.offset + args.data.length };
      },
      "fs.commitWrite": () => ({
        handle: "saved",
        name: "synthetic.json",
        size: bytes.length,
        ext: "json",
        modifiedAt: 0,
      }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  const archived = { ...value, items: value.items.map((item) => ({ ...item, archived: true })) };
  expect(await exportBackup(deck, archived)).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))).toEqual(archived);
  failed = true;
  await expect(exportBackup(deck, value)).rejects.toThrow();
  expect(host.requests.slice(-2).map((request) => request.method)).toEqual(["abortWrite", "closeOutputFolder"]);
  deck.dispose();
});
it("reads validated chunked JSON and closes its read token; picker cancellation returns no replacement", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(value)),
    origin = "http://deckmod.quick-note.modules.localhost";
  let cancel = false;
  const host = createMockHost({
    granted: ["fs"],
    handlers: {
      "fs.pickFiles": () => (cancel ? [] : [{ handle: "input", size: bytes.length }]),
      "fs.openRead": () => ({
        readId: "read",
        size: bytes.length,
        chunkBytes: 64,
        url: origin + "/_resources/" + "a".repeat(32),
      }),
      "fs.closeRead": () => null,
    },
  });
  host.window.location = { origin };
  const deck = await connect({ window: host.window });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      const offset = Number(q.get("offset"));
      return new Response(bytes.slice(offset, offset + Number(q.get("length"))));
    }),
  );
  expect(await pickBackup(deck)).toEqual(value);
  expect(host.requests.at(-1)?.method).toBe("closeRead");
  cancel = true;
  expect(await pickBackup(deck)).toBeNull();
  deck.dispose();
});
