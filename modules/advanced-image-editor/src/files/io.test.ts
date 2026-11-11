// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocument, createPixelLayer, createRaster } from "../core/model.ts";
import { encodeProject } from "./project.ts";
import { OutputSession, exportDocument, importDocument, readInput } from "./index.ts";
import { MAX_INPUT_BYTES } from "./limits.ts";

async function setup(extra: Record<string, MockHandler> = {}) {
  const host = createMockHost({
    module: { id: "advanced-image-editor", version: "0.1.0" },
    caps: { fs: "1.4.0" },
    granted: ["fs"],
    handlers: {
      "fs.pickFolder": () => ({ handle: "synthetic-parent", name: "합성 폴더" }),
      "fs.openOutputFolder": () => ({
        batchId: "synthetic-batch",
        folder: { handle: "synthetic-output", name: "합성 결과" },
      }),
      "fs.beginWrite": () => ({ writeId: "synthetic-write", chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const a = args as { offset: number; data: number[] };
        return { nextOffset: a.offset + a.data.length };
      },
      "fs.commitWrite": () => ({
        handle: "synthetic-result",
        name: "합성.deckimage",
        ext: "deckimage",
        size: 2,
        modifiedAt: 0,
      }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
      ...extra,
    },
  });
  return { host, deck: await connect({ window: host.window }) };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("safe SDK file handling", () => {
  it("remembers the explicitly picked parent of a new document after releasing each save grant", async () => {
    const { deck, host } = await setup();
    const first = new OutputSession(deck);
    const signal = new AbortController().signal;
    await first.save(new Blob(["first"]), "합성.deckimage", signal);
    const parent = first.selectedFolder;
    expect(parent?.handle).toBe("synthetic-parent");
    await first.close();
    const second = new OutputSession(deck, parent?.handle);
    await second.save(new Blob(["second"]), "합성.deckimage", signal);
    await second.close();
    expect(host.requests.filter((r) => r.method === "pickFolder")).toHaveLength(1);
    expect(host.requests.filter((r) => r.method === "openOutputFolder").map((r) => r.args)).toEqual([
      { parentHandle: "synthetic-parent" },
      { parentHandle: "synthetic-parent" },
    ]);
    expect(host.requests.filter((r) => r.method === "closeOutputFolder")).toHaveLength(2);
    deck.dispose();
  });
  it("saves imported PSD and project exports in their source folder without any picker", async () => {
    const { deck, host } = await setup();
    const session = new OutputSession(deck);
    const signal = new AbortController().signal;
    await session.save(new Blob(["project"]), "합성.deckimage", signal, "source-psd");
    await session.save(new Blob(["psd"]), "합성.psd", signal, "source-psd");
    await session.close();
    expect(host.requests.filter((r) => r.method === "openOutputFolder").map((r) => r.args)).toEqual([
      { sourceHandle: "source-psd" },
    ]);
    expect(host.requests.some((r) => ["pickFiles", "pickFolder", "createOutputFolder"].includes(r.method))).toBe(false);
    deck.dispose();
  });
  it("uses an explicitly selected existing folder directly", async () => {
    const { deck, host } = await setup();
    const session = new OutputSession(deck, "selected-parent");
    await session.save(new Blob(["project"]), "합성.deckimage", new AbortController().signal, "source-psd");
    await session.close();
    expect(host.requests.find((r) => r.method === "openOutputFolder")?.args).toEqual({
      parentHandle: "selected-parent",
    });
    expect(host.requests.some((r) => ["pickFolder", "createOutputFolder"].includes(r.method))).toBe(false);
    deck.dispose();
  });
  it("reads opaque source handles in chunks and closes the host read on success", async () => {
    const origin = "http://deckmod.advanced-image-editor.modules.localhost";
    const host = createMockHost({
      module: { id: "advanced-image-editor", version: "0.1.0" },
      caps: { fs: "1.4.0" },
      granted: ["fs"],
      handlers: {
        "fs.openRead": () => ({
          readId: "synthetic-read",
          size: 5,
          chunkBytes: 3,
          url: `${origin}/_resources/${"a".repeat(32)}`,
        }),
        "fs.closeRead": () => null,
      },
    });
    host.window.location = { ...host.window.location, origin };
    const deck = await connect({ window: host.window });
    const readFetch = vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      return new Response(new Uint8Array(Number(query.get("length"))).fill(Number(query.get("offset"))));
    });
    vi.stubGlobal("fetch", readFetch);
    const bytes = await readInput(
      deck,
      { handle: "synthetic-input", name: "합성.png", ext: "png", size: 5, modifiedAt: 0 },
      new AbortController().signal,
    );
    expect([...bytes]).toEqual([0, 0, 0, 3, 3]);
    expect(readFetch).toHaveBeenCalledTimes(2);
    expect(host.requests.map((r) => r.method)).toEqual(["openRead", "closeRead"]);
    deck.dispose();
  });
  it("saves only new output batches with distinct names and closes its handle without deleting saved work", async () => {
    const { host, deck } = await setup();
    const session = new OutputSession(deck),
      signal = new AbortController().signal;
    await session.save(new Blob(["first"]), "합성.deckimage", signal);
    await session.save(new Blob(["second"]), "합성.deckimage", signal);
    await session.close();
    await session.close();
    expect(
      host.requests
        .filter((r) => r.method === "beginWrite")
        .map((r) => (r.args as { suggestedName: string }).suggestedName),
    ).toEqual(["합성.deckimage", "합성_2.deckimage"]);
    expect(host.requests.filter((r) => r.method === "pickFolder")).toHaveLength(1);
    expect(host.requests.filter((r) => r.method === "closeOutputFolder")).toHaveLength(1);
    expect(host.requests.some((r) => /delete|overwrite/.test(r.method))).toBe(false);
    deck.dispose();
  });
  it("writes nothing after folder cancellation and propagates a failed save", async () => {
    const cancelled = await setup({ "fs.pickFolder": () => null });
    const session = new OutputSession(cancelled.deck);
    expect(await session.save(new Blob(), "합성.png", new AbortController().signal)).toBeNull();
    expect(cancelled.host.requests.some((r) => r.method === "beginWrite")).toBe(false);
    cancelled.deck.dispose();
    const failed = await setup({
      "fs.commitWrite": () => {
        throw new DeckCallError("INTERNAL", "저장하지 못했어요.");
      },
    });
    const failedSession = new OutputSession(failed.deck);
    await expect(
      failedSession.save(new Blob(["data"]), "합성.png", new AbortController().signal),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(failed.host.requests.some((r) => r.method === "abortWrite")).toBe(true);
    await failedSession.close();
    failed.deck.dispose();
  });
  it("refuses oversized inputs before opening a read handle", async () => {
    const { host, deck } = await setup();
    await expect(
      readInput(
        deck,
        { handle: "source", name: "합성.psd", ext: "psd", size: MAX_INPUT_BYTES + 1, modifiedAt: 0 },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INPUT_LIMIT" });
    expect(host.requests).toHaveLength(0);
    await expect(
      readInput(
        deck,
        { handle: "source", name: "합성.psd", ext: "psd", size: 10, modifiedAt: 0 },
        new AbortController().signal,
        256 * 1024 * 1024,
      ),
    ).rejects.toMatchObject({ code: "MEMORY_LIMIT" });
    expect(host.requests).toHaveLength(0);
    deck.dispose();
  });
});
describe("file Worker lifecycle", () => {
  it("permits small native saves using the actual ZIP peak and reserves retained editor memory before export", async () => {
    const document = createDocument(32, 24);
    document.layers.push(createPixelLayer(createRaster(32, 24)));
    const runner = vi.fn(async () => ({
      blob: new Blob([Uint8Array.from(encodeProject(document))]),
      revision: document.revision,
      format: "deckimage" as const,
    }));
    const saved = await exportDocument(document, "deckimage", new AbortController().signal, runner);
    expect(saved.blob.size).toBeGreaterThan(0);
    expect(runner).toHaveBeenCalledOnce();
    await expect(
      exportDocument(document, "deckimage", new AbortController().signal, { reservedBytes: 256 * 1024 * 1024 }),
    ).rejects.toThrow();
    expect(document.layers[0]?.kind).toBe("pixel");
  });
  it("terminates a long operation on cancellation without transferring the live document buffers", async () => {
    let transfers: unknown,
      terminate = 0;
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: unknown;
        onerror: unknown;
        postMessage(_request: unknown, transfer?: unknown) {
          transfers = transfer;
        }
        terminate() {
          terminate++;
        }
      },
    );
    const document = createDocument(2, 2),
      controller = new AbortController();
    const operation = exportDocument(document, "psd", controller.signal);
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: "CANCELLED" });
    expect(terminate).toBe(1);
    expect(transfers).toBeUndefined();
    expect(document.width).toBe(2);
  });
  it("keeps compatibility reason codes for explicit UI choices and terminates finished workers", async () => {
    let terminate = 0;
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        postMessage() {
          queueMicrotask(() =>
            this.onmessage?.({ data: { error: "PSD_COMPLEX_TEXT", reasons: ["서식을 단순하게 바꿔야 해요."] } }),
          );
        }
        terminate() {
          terminate++;
        }
      },
    );
    const bytes = new Uint8Array(33),
      view = new DataView(bytes.buffer);
    bytes[0] = 137;
    bytes.set([80, 78, 71], 1);
    bytes.set([73, 72, 68, 82], 12);
    view.setUint32(8, 13);
    view.setUint32(16, 1);
    view.setUint32(20, 1);
    await expect(importDocument(bytes, new AbortController().signal)).rejects.toMatchObject({
      code: "PSD_COMPLEX_TEXT",
      reasons: ["서식을 단순하게 바꿔야 해요."],
    });
    expect(terminate).toBe(1);
  });
});
