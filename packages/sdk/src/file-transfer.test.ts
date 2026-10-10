// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect } from "./client.ts";
import { DeckCallError, MAX_MESSAGE_BYTES } from "./protocol.ts";
import { createMockHost, type MockHandler } from "./testing.ts";
const ORIGIN = "http://deckmod.sample-tool.modules.localhost";
const URL = `${ORIGIN}/_resources/${"a".repeat(32)}`;
const READ = { readId: "read-1", size: 5, chunkBytes: 3, url: URL };
const RESULT = { handle: "result-1", name: "synthetic.bin", ext: "bin", size: 0, modifiedAt: 0 };
async function setup(handlers: Record<string, MockHandler> = {}, caps = { fs: "1.1.0" }, granted = ["fs"]) {
  const host = createMockHost({
    caps,
    granted,
    handlers: {
      "fs.openRead": () => READ,
      "fs.closeRead": () => null,
      "fs.createOutputFolder": () => ({ batchId: "batch-1", folder: { handle: "folder-1", name: "합성 결과" } }),
      "fs.beginWrite": () => ({ writeId: "write-1", chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const a = args as { offset: number; data: number[] };
        return { nextOffset: a.offset + a.data.length };
      },
      "fs.commitWrite": () => RESULT,
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
      ...handlers,
    },
  });
  host.window.location = { ...host.window.location, origin: ORIGIN };
  const deck = await connect({ window: host.window, logger: { warn: () => undefined, debug: () => undefined } });
  return { host, deck };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<number[]> {
  const result: number[] = [];
  for await (const chunk of source) result.push(...chunk);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("fs 1.1 typed bridge contract", () => {
  it.each(["openRead", "beginWrite", "createOutputFolder"] as const)(
    "keeps delayed %s allocation pending beyond the default timeout",
    async (method) => {
      vi.useFakeTimers();
      const late = deferred<unknown>();
      const { deck, host } = await setup({ [`fs.${method}`]: () => late.promise });
      const result =
        method === "openRead"
          ? READ
          : method === "beginWrite"
            ? { writeId: "write-1", chunkBytes: 65536 }
            : { batchId: "batch-1", folder: { handle: "folder-1", name: "합성 결과" } };
      let settled = false;
      const pending =
        method === "openRead"
          ? deck.fs.openRead({ handle: "input-1" })
          : method === "beginWrite"
            ? deck.fs.beginWrite({ batchId: "batch-1", suggestedName: "synthetic.bin", size: 0 })
            : deck.fs.createOutputFolder({ parentHandle: "parent-1", suggestedName: "합성 결과" });
      const observed = pending.then(
        (value) => {
          settled = true;
          return value;
        },
        (error: unknown) => {
          settled = true;
          throw error;
        },
      );
      await vi.advanceTimersByTimeAsync(31_000);
      expect(settled).toBe(false);
      expect(host.requests.map((r) => r.method)).toEqual([method]);
      late.resolve(result);
      await expect(observed).resolves.toEqual(result);
      deck.dispose();
    },
  );
  it.each(["read", "write"] as const)(
    "cleans up a cancelled %s allocation after more than 30 seconds",
    async (kind) => {
      vi.useFakeTimers();
      const late = deferred<unknown>();
      const allocation = kind === "read" ? "openRead" : "beginWrite";
      const cleanup = kind === "read" ? "closeRead" : "abortWrite";
      const { deck, host } = await setup({ [`fs.${allocation}`]: () => late.promise });
      const ac = new AbortController();
      const pending =
        kind === "read"
          ? collect(deck.fs.readChunks({ handle: "input-1" }, { signal: ac.signal }))
          : deck.fs.writeBlob(
              { batchId: "batch-1", suggestedName: "synthetic.bin", blob: new Blob([]) },
              { signal: ac.signal },
            );
      const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
      await vi.advanceTimersByTimeAsync(31_000);
      ac.abort();
      late.resolve(kind === "read" ? { ...READ, size: 0 } : { writeId: "write-1", chunkBytes: 65536 });
      await rejected;
      expect(host.requests.map((r) => r.method)).toEqual([allocation, cleanup]);
      expect(host.requests.at(-1)?.args).toEqual(kind === "read" ? { readId: "read-1" } : { writeId: "write-1" });
      deck.dispose();
    },
  );
  it("maps every raw method and never sends file bytes through read requests", async () => {
    const { deck, host } = await setup();
    await deck.fs.openRead({ handle: "input-1" });
    await deck.fs.closeRead({ readId: "read-1" });
    await deck.fs.createOutputFolder({ parentHandle: "parent-1", suggestedName: "합성 결과" });
    await deck.fs.beginWrite({ batchId: "batch-1", suggestedName: "synthetic.bin", size: 2 });
    await deck.fs.writeChunk({ writeId: "write-1", offset: 0, data: [0, 255] });
    await deck.fs.commitWrite({ writeId: "write-1" });
    await deck.fs.abortWrite({ writeId: "write-1" });
    await deck.fs.closeOutputFolder({ batchId: "batch-1" });
    expect(host.requests.map((r) => r.method)).toEqual([
      "openRead",
      "closeRead",
      "createOutputFolder",
      "beginWrite",
      "writeChunk",
      "commitWrite",
      "abortWrite",
      "closeOutputFolder",
    ]);
    expect(host.requests[0]?.args).toEqual({ handle: "input-1" });
    expect(host.requests[4]?.args).toEqual({ writeId: "write-1", offset: 0, data: [0, 255] });
    deck.dispose();
  });
  it("rejects old hosts and ungranted fs before sending new API calls", async () => {
    const old = await setup({}, { fs: "1.0.0" });
    await expect(old.deck.fs.openRead({ handle: "input-1" })).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
    expect(old.host.requests).toHaveLength(0);
    old.deck.dispose();
    const denied = await setup({}, { fs: "1.1.0" }, []);
    await expect(
      denied.deck.fs.beginWrite({ batchId: "batch-1", suggestedName: "synthetic.bin", size: 0 }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(denied.host.requests).toHaveLength(0);
    denied.deck.dispose();
  });
});
describe("readChunks", () => {
  it.each([{ size: 512 * 1024 * 1024 + 1 }, { size: -1 }, { chunkBytes: 262145 }, { chunkBytes: 0 }])(
    "refuses malformed read bounds and still closes",
    async (bounds) => {
      const { deck, host } = await setup({ "fs.openRead": () => ({ ...READ, ...bounds }) });
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(collect(deck.fs.readChunks({ handle: "input-1" }))).rejects.toMatchObject({ code: "INVALID_ARGS" });
      expect(fetch).not.toHaveBeenCalled();
      expect(host.requests.at(-1)?.method).toBe("closeRead");
      deck.dispose();
    },
  );
  it("aborts a pending fetch and sends closeRead exactly once", async () => {
    const { deck, host } = await setup();
    const ac = new AbortController();
    const started = deferred<boolean>();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new Error("sensitive URL")), { once: true });
            started.resolve(true);
          }),
      ),
    );
    const pending = collect(deck.fs.readChunks({ handle: "input-1" }, { signal: ac.signal }));
    await started.promise;
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED", message: "파일 작업을 취소했어요." });
    expect(host.requests.filter((r) => r.method === "closeRead")).toHaveLength(1);
    deck.dispose();
  });
  it("fetches exact sequential ranges from its own origin, then closes once", async () => {
    const { deck, host } = await setup();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      const query = new globalThis.URL(url).searchParams;
      return new Response(new Uint8Array(Number(query.get("length"))).fill(Number(query.get("offset"))));
    });
    vi.stubGlobal("fetch", fetch);
    expect(await collect(deck.fs.readChunks({ handle: "input-1" }))).toEqual([0, 0, 0, 3, 3]);
    expect(fetch.mock.calls.map(([url]) => new globalThis.URL(url).search)).toEqual([
      "?offset=0&length=3",
      "?offset=3&length=2",
    ]);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(host.requests.filter((r) => r.method === "closeRead")).toHaveLength(1);
    deck.dispose();
  });
  it("handles empty files and closes when a consumer breaks early", async () => {
    const empty = await setup({ "fs.openRead": () => ({ ...READ, size: 0 }) });
    const fetch = vi.fn(async () => new Response(new Uint8Array(3)));
    vi.stubGlobal("fetch", fetch);
    expect(await collect(empty.deck.fs.readChunks({ handle: "input-1" }))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    empty.deck.dispose();
    const { deck, host } = await setup();
    for await (const chunk of deck.fs.readChunks({ handle: "input-1" })) {
      expect(chunk).toHaveLength(3);
      break;
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(host.requests.filter((r) => r.method === "closeRead")).toHaveLength(1);
    deck.dispose();
  });
  it("aborts before open without a request and cleans up a late open response", async () => {
    const ac = new AbortController();
    ac.abort();
    const first = await setup();
    await expect(collect(first.deck.fs.readChunks({ handle: "input-1" }, { signal: ac.signal }))).rejects.toMatchObject(
      { code: "CANCELLED" },
    );
    expect(first.host.requests).toHaveLength(0);
    first.deck.dispose();
    const late = deferred<typeof READ>();
    const secondAc = new AbortController();
    const second = await setup({ "fs.openRead": () => late.promise });
    const pending = collect(second.deck.fs.readChunks({ handle: "input-1" }, { signal: secondAc.signal }));
    await second.host.flush();
    secondAc.abort();
    late.resolve(READ);
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(second.host.requests.map((r) => r.method)).toEqual(["openRead", "closeRead"]);
    expect(second.host.received.some((m) => m.kind === "cancel")).toBe(false);
    second.deck.dispose();
  });
  it("closes immediately when aborted while a consumer holds a yielded chunk", async () => {
    const { deck, host } = await setup();
    const ac = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(3))),
    );
    const iterator = deck.fs.readChunks({ handle: "input-1" }, { signal: ac.signal })[Symbol.asyncIterator]();
    await iterator.next();
    ac.abort();
    await host.flush();
    expect(host.requests.filter((r) => r.method === "closeRead")).toHaveLength(1);
    await expect(iterator.next()).rejects.toMatchObject({ code: "CANCELLED" });
    deck.dispose();
  });
  it.each([
    "http://deckmod.other-tool.modules.localhost/_resources/" + "a".repeat(32),
    ORIGIN + "/_resources/not-a-token",
    URL + "?offset=0",
    URL + "#fragment",
    "https://example.invalid/_resources/" + "a".repeat(32),
  ])("rejects a non-self or malformed resource URL without fetching", async (url) => {
    const { deck, host } = await setup({ "fs.openRead": () => ({ ...READ, url }) });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(collect(deck.fs.readChunks({ handle: "input-1" }))).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(fetch).not.toHaveBeenCalled();
    expect(host.requests.at(-1)?.method).toBe("closeRead");
    deck.dispose();
  });
  it.each([2, 4])("rejects a short or oversized response (%i bytes) and retains primary error", async (length) => {
    const { deck } = await setup({
      "fs.closeRead": () => {
        throw new DeckCallError("NOT_FOUND", "읽기 종료됨");
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(length))),
    );
    await expect(collect(deck.fs.readChunks({ handle: "input-1" }))).rejects.toMatchObject({ code: "INVALID_ARGS" });
    deck.dispose();
  });
  it("maps HTTP error codes without exposing error bodies or token URLs", async () => {
    const { deck } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "NOT_FOUND", message: "private source name" }), { status: 404 }),
      ),
    );
    await expect(collect(deck.fs.readChunks({ handle: "input-1" }))).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "파일을 읽지 못했어요.",
    });
    deck.dispose();
  });
  it("reports cleanup failure after an otherwise successful empty read", async () => {
    const { deck } = await setup({
      "fs.openRead": () => ({ ...READ, size: 0 }),
      "fs.closeRead": () => {
        throw new DeckCallError("BUSY", "정리 대기");
      },
    });
    await expect(collect(deck.fs.readChunks({ handle: "input-1" }))).rejects.toMatchObject({ code: "BUSY" });
    deck.dispose();
  });
});
describe("writeBlob", () => {
  it("refuses an oversized Blob before beginWrite", async () => {
    const { deck, host } = await setup();
    const blob = new Blob();
    Object.defineProperty(blob, "size", { value: 512 * 1024 * 1024 + 1 });
    await expect(deck.fs.writeBlob({ batchId: "batch-1", suggestedName: "synthetic.bin", blob })).rejects.toMatchObject(
      { code: "INVALID_ARGS" },
    );
    expect(host.requests).toHaveLength(0);
    deck.dispose();
  });
  it("aborts if the host advertises oversized write chunks", async () => {
    const { deck, host } = await setup({ "fs.beginWrite": () => ({ writeId: "write-1", chunkBytes: 65537 }) });
    await expect(
      deck.fs.writeBlob({ batchId: "batch-1", suggestedName: "synthetic.bin", blob: new Blob() }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(host.requests.map((r) => r.method)).toEqual(["beginWrite", "abortWrite"]);
    deck.dispose();
  });
  it("slices at 64KiB, sends sequential bounded arrays and commits, without reading the whole Blob", async () => {
    const { deck, host } = await setup();
    const blob = new Blob([new Uint8Array(65536 + 7).fill(255)]);
    const whole = vi.spyOn(blob, "arrayBuffer");
    expect(await deck.fs.writeBlob({ batchId: "batch-1", suggestedName: "synthetic.bin", blob })).toEqual(RESULT);
    const requests = host.requests.filter((r) => r.method === "writeChunk");
    expect(requests.map((r) => (r.args as { offset: number }).offset)).toEqual([0, 65536]);
    expect(requests.map((r) => (r.args as { data: number[] }).data.length)).toEqual([65536, 7]);
    expect(requests.every((r) => new TextEncoder().encode(JSON.stringify(r.args)).length < MAX_MESSAGE_BYTES)).toBe(
      true,
    );
    expect(whole).not.toHaveBeenCalled();
    expect(host.requests.map((r) => r.method)).toEqual(["beginWrite", "writeChunk", "writeChunk", "commitWrite"]);
    deck.dispose();
  });
  it("writes empty files through begin/commit without a chunk", async () => {
    const { deck, host } = await setup();
    await deck.fs.writeBlob({ batchId: "batch-1", suggestedName: "empty.bin", blob: new Blob() });
    expect(host.requests.map((r) => r.method)).toEqual(["beginWrite", "commitWrite"]);
    deck.dispose();
  });
  it("pre-abort sends nothing and abort during begin cleans up the late write id", async () => {
    const ac = new AbortController();
    ac.abort();
    const first = await setup();
    await expect(
      first.deck.fs.writeBlob(
        { batchId: "batch-1", suggestedName: "empty.bin", blob: new Blob() },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(first.host.requests).toHaveLength(0);
    first.deck.dispose();
    const late = deferred<{ writeId: string; chunkBytes: number }>();
    const secondAc = new AbortController();
    const second = await setup({ "fs.beginWrite": () => late.promise });
    const promise = second.deck.fs.writeBlob(
      { batchId: "batch-1", suggestedName: "empty.bin", blob: new Blob() },
      { signal: secondAc.signal },
    );
    await second.host.flush();
    secondAc.abort();
    late.resolve({ writeId: "late-1", chunkBytes: 65536 });
    await expect(promise).rejects.toMatchObject({ code: "CANCELLED" });
    expect(second.host.requests.map((r) => r.method)).toEqual(["beginWrite", "abortWrite"]);
    second.deck.dispose();
  });
  it("aborts exactly once when the signal aborts during a chunk, without committing", async () => {
    const ac = new AbortController();
    const { deck, host } = await setup({
      "fs.writeChunk": () => {
        ac.abort();
        return { nextOffset: 2 };
      },
    });
    await expect(
      deck.fs.writeBlob(
        { batchId: "batch-1", suggestedName: "synthetic.bin", blob: new Blob([new Uint8Array(2)]) },
        { signal: ac.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(host.requests.map((r) => r.method)).toEqual(["beginWrite", "writeChunk", "abortWrite"]);
    deck.dispose();
  });
  it("preserves the published result when abort arrives during commit", async () => {
    const ac = new AbortController();
    const { deck, host } = await setup({
      "fs.commitWrite": () => {
        ac.abort();
        return RESULT;
      },
    });
    expect(
      await deck.fs.writeBlob(
        { batchId: "batch-1", suggestedName: "empty.bin", blob: new Blob() },
        { signal: ac.signal },
      ),
    ).toEqual(RESULT);
    expect(host.requests.map((r) => r.method)).toEqual(["beginWrite", "commitWrite"]);
    deck.dispose();
  });
  it("retries one timed-out chunk with identical bytes and offset", async () => {
    let attempts = 0;
    const { deck, host } = await setup({
      "fs.writeChunk": () => {
        if (++attempts === 1) throw new DeckCallError("TIMEOUT", "응답 없음");
        return { nextOffset: 2 };
      },
    });
    await deck.fs.writeBlob({
      batchId: "batch-1",
      suggestedName: "synthetic.bin",
      blob: new Blob([new Uint8Array([1, 2])]),
    });
    const chunks = host.requests.filter((r) => r.method === "writeChunk");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.args).toEqual(chunks[1]?.args);
    deck.dispose();
  });
  it("refuses a wrong next offset and preserves the primary error when cleanup fails", async () => {
    const { deck, host } = await setup({
      "fs.writeChunk": () => ({ nextOffset: 99 }),
      "fs.abortWrite": () => {
        throw new DeckCallError("BUSY", "정리 대기");
      },
    });
    await expect(
      deck.fs.writeBlob({ batchId: "batch-1", suggestedName: "synthetic.bin", blob: new Blob([new Uint8Array(2)]) }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(host.requests.at(-1)?.method).toBe("abortWrite");
    expect(host.requests.some((r) => r.method === "commitWrite")).toBe(false);
    deck.dispose();
  });
});
