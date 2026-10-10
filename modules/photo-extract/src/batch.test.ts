// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputSession } from "./output-session.ts";
import { readExtraction, savePhotos, type PlannedPhoto } from "./batch.ts";
import { fakeJpeg } from "./fixtures.test-support.ts";
const origin = "http://deckmod.photo-extract.modules.localhost";
const file = { handle: "source-1", name: "합성 명렬표.xls", ext: "xls", size: 4, modifiedAt: 0 };
async function setup(handlers: Record<string, MockHandler> = {}) {
  const writes: number[][] = [];
  const host = createMockHost({
    module: { id: "photo-extract", version: "0.1.0" },
    caps: { fs: "1.1.0" },
    granted: ["fs"],
    handlers: {
      "fs.pickFolder": () => ({ handle: "parent-1", name: "합성 폴더" }),
      "fs.createOutputFolder": () => ({ batchId: "batch-1", folder: { handle: "folder-1", name: "합성 결과" } }),
      "fs.beginWrite": () => ({ writeId: "write-1", chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const row = args as { data: number[]; offset: number };
        writes.push(row.data);
        return { nextOffset: row.offset + row.data.length };
      },
      "fs.commitWrite": () => ({ handle: "result-1", name: "합성 사진.jpg", ext: "jpg", size: 7, modifiedAt: 0 }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
      "fs.openRead": () => ({
        readId: "read-1",
        size: 4,
        chunkBytes: 4,
        url: `${origin}/_resources/${"a".repeat(32)}`,
      }),
      "fs.closeRead": () => null,
      ...handlers,
    },
  });
  host.window.location = { ...host.window.location, origin };
  return { deck: await connect({ window: host.window }), host, writes };
}
const photo = (i: number): PlannedPhoto => ({
  id: `p-${i}`,
  key: `xl/media/p${i}.jpeg`,
  bytes: fakeJpeg(i),
  extension: "jpg",
  mime: "image/jpeg",
  filename: `1030${i}_가상${i}.jpg`,
  label: "합성 사진",
  confirmed: true,
});
afterEach(() => vi.unstubAllGlobals());
describe("SDK-only photo output", () => {
  it("writes every photo unchanged into a new output batch and closes it", async () => {
    const { deck, host, writes } = await setup();
    const result = await savePhotos(deck, [photo(1), photo(2)], new AbortController().signal);
    expect(result?.saved).toEqual(["p-1", "p-2"]);
    expect(writes).toEqual([Array.from(fakeJpeg(1)), Array.from(fakeJpeg(2))]);
    expect(
      host.requests
        .filter((r) => r.method === "beginWrite")
        .map((r) => (r.args as { suggestedName: string }).suggestedName),
    ).toEqual(["10301_가상1.jpg", "10302_가상2.jpg"]);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    expect(host.requests.some((r) => /delete|overwrite/i.test(r.method))).toBe(false);
    deck.dispose();
  });
  it("folder-picker cancellation creates no output and keeps the source data", async () => {
    const { deck, host } = await setup({ "fs.pickFolder": () => null });
    const original = photo(1);
    expect(await savePhotos(deck, [original], new AbortController().signal)).toBeNull();
    expect(host.requests.some((r) => r.method === "createOutputFolder")).toBe(false);
    expect(original.bytes).toEqual(fakeJpeg(1));
    deck.dispose();
  });
  it("continues after one write failure and cancels remaining files after a committed photo", async () => {
    let calls = 0;
    const { deck, host } = await setup({
      "fs.beginWrite": () => {
        if (++calls === 1) throw { code: "INTERNAL", message: "쓰기 실패" };
        return { writeId: "write-2", chunkBytes: 65536 };
      },
    });
    const result = await savePhotos(deck, [photo(1), photo(2)], new AbortController().signal);
    expect(result?.failed).toEqual(["p-1"]);
    expect(result?.saved).toEqual(["p-2"]);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
    const abort = new AbortController();
    const cancelled = await setup({
      "fs.commitWrite": () => {
        abort.abort();
        return { handle: "result", name: "합성.jpg", ext: "jpg", size: 7, modifiedAt: 0 };
      },
    });
    const stopped = await savePhotos(cancelled.deck, [photo(1), photo(2)], abort.signal);
    expect(stopped?.cancelled).toBe(true);
    expect(cancelled.host.requests.filter((r) => r.method === "beginWrite")).toHaveLength(1);
    expect(cancelled.host.requests.at(-1)?.method).toBe("closeOutputFolder");
    cancelled.deck.dispose();
  });
  it("does not classify an explicitly cancelled transfer as a failed photo", async () => {
    const abort = new AbortController();
    const { deck, host } = await setup({
      "fs.beginWrite": () => {
        abort.abort();
        throw { code: "CANCELLED", message: "취소" };
      },
    });
    const result = await savePhotos(deck, [photo(1), photo(2)], abort.signal);
    expect(result?.cancelled).toBe(true);
    expect(result?.failed).toEqual([]);
    expect(result?.saved).toEqual([]);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
  });
  it("reads only a selected handle, closes the read after decoding failure, and never changes input", async () => {
    const { deck, host } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([80, 75, 0, 0]))),
    );
    await expect(
      readExtraction(deck, file, new AbortController().signal, async () => {
        throw new Error("INVALID_ARCHIVE");
      }),
    ).rejects.toThrow("INVALID_ARCHIVE");
    expect(host.requests.map((r) => r.method)).toEqual(["openRead", "closeRead"]);
    expect(file.size).toBe(4);
    deck.dispose();
  });
});

describe("photo retry output session", () => {
  it("reuses the output folder across a failed write and retry, then releases the batch", async () => {
    let attempts = 0;
    const { deck, host } = await setup({
      "fs.beginWrite": () => {
        if (++attempts === 1) throw { code: "INTERNAL", message: "합성 쓰기 실패" };
        return { writeId: "write-2", chunkBytes: 65536 };
      },
    });
    const session = new OutputSession(deck, "명렬표 사진");
    const first = await savePhotos(deck, [photo(1), photo(2)], new AbortController().signal, () => undefined, session);
    expect(first?.failed).toEqual(["p-1"]);
    expect(first?.saved).toEqual(["p-2"]);
    const retried = await savePhotos(deck, [photo(1)], new AbortController().signal, () => undefined, session);
    expect(retried?.saved).toEqual(["p-1"]);
    expect(retried?.folder).toEqual(first?.folder);
    expect(host.requests.filter((request) => request.method === "pickFolder")).toHaveLength(1);
    expect(host.requests.filter((request) => request.method === "createOutputFolder")).toHaveLength(1);
    await session.close();
    expect(host.requests.filter((request) => request.method === "closeOutputFolder")).toHaveLength(1);
    deck.dispose();
  });
});
