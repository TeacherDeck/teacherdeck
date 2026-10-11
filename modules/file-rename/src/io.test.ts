// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
import { copyBatch, folderFiles, renameBatch, RenamePlanExpired } from "./io.ts";
import { DEFAULT_MATCH, DEFAULT_NAMING, preview } from "./logic.ts";
const origin = "http://deckmod.file-rename.modules.localhost";
const input = new Uint8Array(300000).map((_, i) => i % 251);
const file = (i: number) => ({
  handle: `source-${i}`,
  name: `합성자료${i}.bin`,
  ext: "bin",
  size: input.length,
  modifiedAt: 0,
});
const rows = preview(
  [1, 2, 3].map((i) => ({ file: file(i) })),
  { ...DEFAULT_NAMING, date: "2026-10-11" },
  "pattern",
  [],
  DEFAULT_MATCH,
);
async function setup(overrides: Record<string, MockHandler> = {}) {
  const chunks: number[][] = [];
  let write = 0;
  const host = createMockHost({
    module: { id: "file-rename", version: "0.1.0" },
    caps: { fs: "1.3.0", "file-ops": "1.0.0" },
    granted: ["fs", "file-ops"],
    handlers: {
      "fs.pickFolder": () => ({ handle: "parent", name: "합성 폴더" }),
      "fs.createOutputFolder": () => ({ batchId: "batch", folder: { handle: "out", name: "합성 결과" } }),
      "fs.beginWrite": () => ({ writeId: `write-${++write}`, chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const a = args as { data: number[]; offset: number };
        chunks.push(a.data);
        return { nextOffset: a.offset + a.data.length };
      },
      "fs.commitWrite": () => ({ ...file(write), handle: `result-${write}` }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
      "fs.openRead": () => ({
        readId: "read",
        size: input.length,
        chunkBytes: 262144,
        url: `${origin}/_resources/${"a".repeat(32)}`,
      }),
      "fs.closeRead": () => null,
      ...overrides,
    },
  });
  host.window.location = { ...host.window.location, origin };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      const offset = Number(query.get("offset"));
      const length = Number(query.get("length"));
      return new Response(input.slice(offset, offset + length));
    }),
  );
  return { deck: await connect({ window: host.window }), host, chunks };
}
afterEach(() => vi.unstubAllGlobals());
describe("typed SDK file workflows", () => {
  it("stops an expired plan before another native group and preserves the last complete result", async () => {
    const expiresAt = Date.now() + 300000;
    const partial = {
      historyHandle: "history",
      success: 1,
      failed: 0,
      notStarted: 1,
      done: false,
      items: [
        { sourceHandle: "source-1", status: "success" },
        { sourceHandle: "source-2", status: "notStarted" },
      ],
    };
    const { deck, host } = await setup({ "file-ops.executeRename": () => partial });
    const now = vi.spyOn(Date, "now").mockReturnValue(expiresAt - 1);
    try {
      const error = await renameBatch(
        deck,
        { planHandle: "plan", items: [], expiresAt },
        new AbortController().signal,
        () => now.mockReturnValue(expiresAt),
      ).catch((error) => error);
      expect(error).toBeInstanceOf(RenamePlanExpired);
      expect(error.partial).toEqual(partial);
      expect(host.requests.filter((request) => request.method === "executeRename")).toHaveLength(1);
    } finally {
      now.mockRestore();
      deck.dispose();
    }
  });
  it("streams exact bytes in bounded chunks into a fresh output without deleting sources", async () => {
    const { deck, host, chunks } = await setup();
    const result = await copyBatch(deck, rows.slice(0, 1), new AbortController().signal, () => undefined);
    expect(new Uint8Array(chunks.flat())).toEqual(input);
    expect(chunks.every((c) => c.length <= 65536)).toBe(true);
    expect(result.results[0]?.status).toBe("success");
    expect(result.results[0]?.folder?.handle).toBe("out");
    expect(host.requests.some((r) => /delete|overwrite|rename/i.test(r.method))).toBe(false);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
  });
  it("keeps committed output on cancellation and copies only unfinished rows on retry", async () => {
    const abort = new AbortController();
    const first = await setup({
      "fs.commitWrite": () => {
        abort.abort();
        return { ...file(1), handle: "saved-first" };
      },
    });
    const stopped = await copyBatch(first.deck, rows, abort.signal, () => undefined);
    expect(stopped.results.map((r) => r.status)).toEqual(["success", "notStarted", "notStarted"]);
    first.deck.dispose();
    const retry = await setup();
    const completed = await copyBatch(retry.deck, rows, new AbortController().signal, () => undefined, stopped.results);
    expect(completed.results[0]).toEqual(stopped.results[0]);
    expect(retry.host.requests.filter((r) => r.method === "beginWrite")).toHaveLength(2);
    expect(completed.results.every((r) => r.status === "success")).toBe(true);
    retry.deck.dispose();
  });
  it("aborts only unfinished writes on failure, preserves previous success when folder selection is cancelled", async () => {
    const fail = await setup({
      "fs.writeChunk": () => {
        throw new Error("SYNTHETIC_WRITE_FAILURE");
      },
    });
    const result = await copyBatch(fail.deck, rows.slice(0, 1), new AbortController().signal, () => undefined);
    expect(result.results[0]?.status).toBe("failed");
    expect(fail.host.requests.filter((r) => r.method === "abortWrite")).toHaveLength(1);
    fail.deck.dispose();
    const cancel = await setup({ "fs.pickFolder": () => null });
    expect(
      (await copyBatch(cancel.deck, rows, new AbortController().signal, () => undefined, result.results)).results,
    ).toEqual(result.results);
    expect(cancel.host.requests.some((r) => r.method === "createOutputFolder")).toBe(false);
    cancel.deck.dispose();
  });
  it("cancels between complete native groups and between folder pages", async () => {
    const abort = new AbortController();
    const { deck, host } = await setup({
      "file-ops.executeRename": () => ({
        historyHandle: "history",
        success: 1,
        failed: 0,
        notStarted: 2,
        items: [],
        done: false,
      }),
      "fs.listFiles": () => {
        abort.abort();
        return { files: [file(1)], nextCursor: "cursor" };
      },
    });
    const signal = new AbortController();
    const out = await renameBatch(
      deck,
      { planHandle: "plan", items: [], expiresAt: Date.now() + 300000 },
      signal.signal,
      () => signal.abort(),
    );
    expect(out?.success).toBe(1);
    expect(host.requests.filter((r) => r.method === "executeRename")).toHaveLength(1);
    await expect(folderFiles(deck, false, abort.signal)).rejects.toThrow("CANCELLED");
    expect(host.requests.filter((r) => r.method === "listFiles")).toHaveLength(1);
    deck.dispose();
  });
});
