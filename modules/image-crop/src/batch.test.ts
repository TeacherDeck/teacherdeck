// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { FONT_STACK } from "@deck/ui";
import { OutputSession } from "./output-session.ts";
import { saveCrops, renderCrop, type CropItem, type Renderer } from "./batch.ts";
const item = (handle: string): CropItem => ({
  file: { handle, name: "합성.png", ext: "png", size: 4, modifiedAt: 0 },
  bytes: new Uint8Array([1, 2, 3, 4]),
  sourceWidth: 100,
  sourceHeight: 80,
  edit: { turns: 1, flipX: true, flipY: false, rect: { x: 10, y: 20, width: 30, height: 40 } },
});
async function setup(extra: Record<string, MockHandler> = {}) {
  const host = createMockHost({
    module: { id: "image-crop", version: "0.1.0" },
    caps: { fs: "1.1.0" },
    granted: ["fs"],
    handlers: {
      "fs.pickFolder": () => ({ handle: "parent", name: "합성 폴더" }),
      "fs.createOutputFolder": () => ({ batchId: "batch", folder: { handle: "output", name: "합성 결과" } }),
      "fs.beginWrite": () => ({ writeId: "write", chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const a = args as { offset: number; data: number[] };
        return { nextOffset: a.offset + a.data.length };
      },
      "fs.commitWrite": () => ({ handle: "result", name: "합성 결과.png", ext: "png", size: 4, modifiedAt: 0 }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
      ...extra,
    },
  });
  return { host, deck: await connect({ window: host.window }) };
}
const renderer: Renderer = async (request) => ({
  blob: new Blob([request.bytes]),
  sourceWidth: 100,
  sourceHeight: 80,
  imageWidth: 80,
  imageHeight: 100,
});
describe("crop SDK output lifecycle", () => {
  it("supplies the shared font token from the UI thread instead of importing UI inside the Worker", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        terminate() {}
        postMessage(value: unknown) {
          sent = value;
          queueMicrotask(() =>
            this.onmessage?.({
              data: {
                blob: new Blob(["synthetic"]),
                sourceWidth: 100,
                sourceHeight: 80,
                imageWidth: 100,
                imageHeight: 80,
              },
            }),
          );
        }
      },
    );
    try {
      const request = { bytes: new Uint8Array([1]), edit: item("source").edit, preview: false, format: "png" as const };
      await renderCrop(request, new AbortController().signal);
      expect(sent).toEqual({ ...request, fontFamily: FONT_STACK });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves originals and edits, saves all distinct names to a new batch", async () => {
    const { deck, host } = await setup();
    const items = [item("first"), item("second")];
    const result = await saveCrops(deck, items, "png", new AbortController().signal, () => undefined, renderer);
    expect(result?.saved).toEqual(["first", "second"]);
    expect(
      host.requests
        .filter((r) => r.method === "beginWrite")
        .map((r) => (r.args as { suggestedName: string }).suggestedName),
    ).toEqual(["합성_자르기.png", "합성_자르기_2.png"]);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    expect(items[0]?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(items[0]?.edit.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    deck.dispose();
  });
  it("folder cancellation writes nothing and per-file errors do not discard following items", async () => {
    const cancelled = await setup({ "fs.pickFolder": () => null });
    expect(
      await saveCrops(cancelled.deck, [item("a")], "png", new AbortController().signal, () => undefined, renderer),
    ).toBeNull();
    expect(cancelled.host.requests.some((r) => r.method === "createOutputFolder")).toBe(false);
    cancelled.deck.dispose();
    const { deck, host } = await setup();
    let calls = 0;
    const render: Renderer = async (request, signal) => {
      if (++calls === 1) throw new Error("INVALID_IMAGE");
      return renderer(request, signal);
    };
    const result = await saveCrops(
      deck,
      [item("bad"), item("good")],
      "jpeg",
      new AbortController().signal,
      () => undefined,
      render,
    );
    expect(result?.failed).toEqual(["bad"]);
    expect(result?.saved).toEqual(["good"]);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
  });
  it("stops remaining files after cancellation while keeping completed results", async () => {
    const abort = new AbortController();
    const { deck, host } = await setup({
      "fs.commitWrite": () => {
        abort.abort();
        return { handle: "result", name: "합성.png", ext: "png", size: 4, modifiedAt: 0 };
      },
    });
    const result = await saveCrops(
      deck,
      [item("first"), item("later")],
      "png",
      abort.signal,
      () => undefined,
      renderer,
    );
    expect(result?.cancelled).toBe(true);
    expect(host.requests.filter((r) => r.method === "beginWrite")).toHaveLength(1);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
  });
});

describe("continuous crop output session", () => {
  it("picks and creates once, gives repeated saves distinct names, and closes once at task end", async () => {
    const { deck, host } = await setup();
    const session = new OutputSession(deck, "잘라낸 이미지");
    for (const handle of ["first", "second", "first"])
      await saveCrops(deck, [item(handle)], "png", new AbortController().signal, () => undefined, renderer, session);
    expect(host.requests.filter((request) => request.method === "pickFolder")).toHaveLength(1);
    expect(host.requests.filter((request) => request.method === "createOutputFolder")).toHaveLength(1);
    expect(host.requests.filter((request) => request.method === "closeOutputFolder")).toHaveLength(0);
    expect(
      host.requests
        .filter((request) => request.method === "beginWrite")
        .map((request) => (request.args as { suggestedName: string }).suggestedName),
    ).toEqual(["합성_자르기.png", "합성_자르기_2.png", "합성_자르기_3.png"]);
    await session.close();
    await session.close();
    expect(host.requests.filter((request) => request.method === "closeOutputFolder")).toHaveLength(1);
    expect(await session.get(new AbortController().signal)).toBeNull();
    deck.dispose();
  });
  it("closes a batch acquired after the editor has already been disposed", async () => {
    let resolveCreation: ((value: { batchId: string; folder: { handle: string; name: string } }) => void) | undefined;
    const { deck, host } = await setup({
      "fs.createOutputFolder": () =>
        new Promise((resolve) => {
          resolveCreation = resolve;
        }),
    });
    const session = new OutputSession(deck, "잘라낸 이미지");
    const opening = session.get(new AbortController().signal);
    while (!resolveCreation) await new Promise((resolve) => setTimeout(resolve, 0));
    const closing = session.close();
    resolveCreation({ batchId: "late-batch", folder: { handle: "late-folder", name: "합성 결과" } });
    expect(await opening).toBeNull();
    await closing;
    expect(host.requests.filter((request) => request.method === "closeOutputFolder")).toHaveLength(1);
    deck.dispose();
  });
  it("keeps a cancelled picker reusable without creating an output folder", async () => {
    let picks = 0;
    const { deck, host } = await setup({
      "fs.pickFolder": () => (++picks === 1 ? null : { handle: "parent", name: "합성 폴더" }),
    });
    const session = new OutputSession(deck, "잘라낸 이미지");
    expect(await session.get(new AbortController().signal)).toBeNull();
    expect(host.requests.filter((request) => request.method === "createOutputFolder")).toHaveLength(0);
    expect(await session.get(new AbortController().signal)).not.toBeNull();
    await session.close();
    deck.dispose();
  });
});

describe("expired crop output recovery", () => {
  it("returns committed files and identifies expired destinations without repeatedly writing to them", async () => {
    let attempts = 0;
    const { deck, host } = await setup({
      "fs.beginWrite": () => {
        if (++attempts === 2) throw new DeckCallError("NOT_FOUND", "저장 작업 만료");
        return { writeId: "write", chunkBytes: 65536 };
      },
    });
    const session = new OutputSession(deck, "잘라낸 이미지");
    const result = await saveCrops(
      deck,
      [item("first"), item("expired"), item("pending")],
      "png",
      new AbortController().signal,
      () => undefined,
      renderer,
      session,
    );
    expect(result?.saved).toEqual(["first"]);
    expect(result?.failed).toEqual(["expired"]);
    expect(result?.destinationExpired).toBe(true);
    expect(attempts).toBe(2);
    await session.close();
    expect(host.requests.filter((request) => request.method === "closeOutputFolder")).toHaveLength(1);
    deck.dispose();
  });
});

describe("lazy large crop batches", () => {
  it("reads and renders 500 handles sequentially without retaining their source bytes", async () => {
    const files = Array.from({ length: 500 }, (_, n) => ({ ...item(String(n)), bytes: undefined }));
    let active = 0,
      maximum = 0,
      reads = 0,
      writes = 0;
    const render: Renderer = async (request, signal) => {
      maximum = Math.max(maximum, ++active);
      await Promise.resolve();
      active--;
      return renderer(request, signal);
    };
    const fs = {
      pickFolder: async () => ({ handle: "parent", name: "합성 폴더" }),
      createOutputFolder: async () => ({ batchId: "batch", folder: { handle: "output", name: "합성 결과" } }),
      closeOutputFolder: async () => undefined,
      readChunks: async function* () {
        reads++;
        yield new Uint8Array([1, 2, 3, 4]);
      },
      writeBlob: async () => {
        writes++;
        return { handle: "output", name: "합성.png", size: 4, ext: "png", modifiedAt: 0 };
      },
    } as unknown as Parameters<typeof saveCrops>[0]["fs"];
    const result = await saveCrops({ fs }, files, "png", new AbortController().signal, undefined, render);
    expect(result?.saved).toHaveLength(500);
    expect(reads).toBe(500);
    expect(writes).toBe(500);
    expect(maximum).toBe(1);
    expect(files.every((file) => file.bytes === undefined)).toBe(true);
  });
  it("rejects a source whose dimensions changed after admission, preserving the edited snapshot", async () => {
    const { deck, host } = await setup();
    const before = item("changed");
    const render: Renderer = async (request, signal) => ({ ...(await renderer(request, signal)), sourceWidth: 200 });
    const result = await saveCrops(deck, [before], "png", new AbortController().signal, undefined, render);
    expect(result?.failed).toEqual(["changed"]);
    expect(host.requests.some((r) => r.method === "beginWrite")).toBe(false);
    expect(before.edit.rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    deck.dispose();
  });
});
