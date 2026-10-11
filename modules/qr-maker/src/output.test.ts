// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { QrOutput } from "./output.ts";

async function setup(pick?: MockHandler) {
  const host = createMockHost({
    module: { id: "qr-maker", version: "0.1.0" },
    caps: { fs: "1.2.0" },
    granted: ["fs"],
    handlers: {
      "fs.pickDestination":
        pick ?? (() => ({ grantHandle: "destination", label: "합성 결과", available: true, persistent: false })),
      "fs.beginWrite": () => ({ writeId: "write", chunkBytes: 65536 }),
      "fs.writeChunk": (args) => {
        const { offset, data } = args as { offset: number; data: number[] };
        return { nextOffset: offset + data.length };
      },
      "fs.commitWrite": () => ({ handle: "saved", name: "QR 코드.svg", ext: "svg", size: 4, modifiedAt: 0 }),
      "fs.abortWrite": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  return { deck, host, output: new QrOutput(deck) };
}

describe("QR file saving", () => {
  it("writes through the SDK and reuses the selected append-new destination", async () => {
    const { deck, host, output } = await setup();
    const blob = () => Promise.resolve(new Blob(["synthetic"]));
    expect(await output.save("svg", blob, new AbortController().signal)).toBe(true);
    expect(await output.save("png", blob, new AbortController().signal)).toBe(true);
    expect(host.requests.filter((request) => request.method === "pickDestination")).toHaveLength(1);
    expect(host.requests[0]?.args).toEqual({ remember: false });
    expect(host.requests.filter((request) => request.method === "beginWrite").map((request) => request.args)).toEqual([
      { batchId: "destination", suggestedName: "QR 코드.svg", size: 9 },
      { batchId: "destination", suggestedName: "QR 코드.png", size: 9 },
    ]);
    expect(host.requests.filter((request) => request.method === "commitWrite")).toHaveLength(2);
    deck.dispose();
  });

  it("does not create a file when the chooser is cancelled", async () => {
    const { deck, host, output } = await setup(() => null);
    expect(await output.save("png", () => Promise.resolve(new Blob(["synthetic"])), new AbortController().signal)).toBe(
      false,
    );
    expect(host.requests.map((request) => request.method)).toEqual(["pickDestination"]);
    deck.dispose();
  });

  it("refuses a stale export after asynchronous conversion", async () => {
    const { deck, host, output } = await setup();
    await output.select();
    const controller = new AbortController();
    const pending = output.save(
      "png",
      async () => {
        controller.abort();
        return new Blob(["stale"]);
      },
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(host.requests.some((request) => request.method === "beginWrite")).toBe(false);
    deck.dispose();
  });

  it("reports a chooser error without passing its detail into UI messages", async () => {
    const { deck, output } = await setup(() => {
      throw new DeckCallError("NOT_FOUND", "저장 폴더를 찾지 못했어요.");
    });
    await expect(
      output.save("svg", () => Promise.resolve(new Blob(["synthetic"])), new AbortController().signal),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(output.destination).toBeNull();
    deck.dispose();
  });
});
