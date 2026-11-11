// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
vi.mock("./pdf.ts", () => ({ openPdf: vi.fn(), renderPage: vi.fn() }));
import { runBatch } from "./batch.ts";
import { DEFAULT_OPTIONS } from "./logic.ts";
const files = ["a", "b", "c"].map((handle) => ({ handle, name: `${handle}.pdf`, ext: "pdf", size: 4, modifiedAt: 0 }));
async function fixture() {
  const closed = vi.fn();
  const written: Uint8Array[] = [];
  const host = createMockHost({
    module: { id: "pdf-compress", version: "0.1.0" },
    caps: { fs: "1.4.0" },
    granted: ["fs"],
    handlers: {
      "fs.openOutputFolder": () => ({ batchId: "batch", folder: { handle: "output", name: "합성 결과" } }),
      "fs.closeOutputFolder": closed,
    },
  });
  const deck = await connect({ window: host.window });
  deck.fs.readChunks = async function* () {
    yield new Uint8Array([1, 2, 3, 4]);
  };
  deck.fs.writeBlob = async ({ blob, suggestedName }) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    written.push(bytes);
    return { handle: "saved", name: suggestedName, ext: "pdf", size: bytes.length, modifiedAt: 0 };
  };
  return { deck, host, closed, written };
}
describe("PDF batch output boundaries", () => {
  it("writes each source beside its original by default without opening dialogs or creating directories", async () => {
    const f = await fixture();
    await runBatch(
      f.deck,
      files.slice(0, 2),
      null,
      DEFAULT_OPTIONS,
      new AbortController().signal,
      () => undefined,
      async () => new Uint8Array([9]),
    );
    expect(f.host.requests.filter((r) => r.method === "openOutputFolder").map((r) => r.args)).toEqual([
      { sourceHandle: "a" },
      { sourceHandle: "b" },
    ]);
    expect(f.host.requests.some((r) => ["pickFiles", "pickFolder", "createOutputFolder"].includes(r.method))).toBe(
      false,
    );
    expect(f.closed).toHaveBeenCalledTimes(2);
    f.deck.dispose();
  });
  it("uses the explicitly selected existing folder for every source", async () => {
    const f = await fixture();
    await runBatch(
      f.deck,
      files.slice(0, 2),
      "chosen",
      DEFAULT_OPTIONS,
      new AbortController().signal,
      () => undefined,
      async () => new Uint8Array([9]),
    );
    expect(f.host.requests.filter((r) => r.method === "openOutputFolder").map((r) => r.args)).toEqual([
      { parentHandle: "chosen" },
      { parentHandle: "chosen" },
    ]);
    f.deck.dispose();
  });
  it("keeps source bytes when larger, continues failures, and closes output", async () => {
    const f = await fixture();
    let calls = 0;
    const result = await runBatch(
      f.deck,
      files,
      "parent",
      DEFAULT_OPTIONS,
      new AbortController().signal,
      () => undefined,
      async () => {
        calls++;
        if (calls === 2) throw new Error("SYNTHETIC_FAILURE");
        return calls === 1 ? new Uint8Array(5) : new Uint8Array([9, 8]);
      },
    );
    expect(result.results.map((r) => r.status)).toEqual(["original", "failed", "compressed"]);
    expect([...(f.written[0] ?? [])]).toEqual([1, 2, 3, 4]);
    expect([...(f.written[1] ?? [])]).toEqual([9, 8]);
    expect(f.closed).toHaveBeenCalledTimes(2);
  });
  it("cancellation preserves completed outputs and leaves remaining files untouched", async () => {
    const f = await fixture();
    const abort = new AbortController();
    const write = f.deck.fs.writeBlob;
    f.deck.fs.writeBlob = async (...args) => {
      const saved = await write(...args);
      abort.abort();
      return saved;
    };
    const encode = vi.fn(async () => new Uint8Array([9]));
    const result = await runBatch(f.deck, files, "parent", DEFAULT_OPTIONS, abort.signal, () => undefined, encode);
    expect(result.results).toHaveLength(1);
    expect(f.written).toHaveLength(1);
    expect(encode).toHaveBeenCalledOnce();
    expect(f.closed).toHaveBeenCalledOnce();
  });
});
