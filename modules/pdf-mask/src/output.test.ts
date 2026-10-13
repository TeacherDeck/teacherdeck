// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { expect, it, vi } from "vitest";
vi.mock("./pdf.ts", () => ({ openPdf: vi.fn(), pageInfo: vi.fn(), renderPage: vi.fn() }));
import { saveResult, type Input } from "./batch.ts";

it("saves a new masked PDF beside its source or directly into an explicit folder and closes each grant", async () => {
  const file = { handle: "source", name: "합성 원본.pdf", ext: "pdf", size: 4, modifiedAt: 0 };
  const host = createMockHost({
    granted: ["fs"],
    handlers: {
      "fs.openOutputFolder": () => ({ batchId: "batch", folder: { handle: "folder", name: "합성 폴더" } }),
      "fs.closeOutputFolder": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  deck.fs.writeBlob = async ({ suggestedName }) => ({ ...file, handle: "saved", name: suggestedName });
  const input = { file } as Input;
  const blob = new Blob(["synthetic"]);
  const abort = new AbortController();
  try {
    await saveResult(deck, input, blob, abort.signal);
    await saveResult(deck, input, blob, abort.signal, "chosen");
    expect(host.requests.filter((r) => r.method === "openOutputFolder").map((r) => r.args)).toEqual([
      { sourceHandle: "source" },
      { parentHandle: "chosen" },
    ]);
    expect(host.requests.filter((r) => r.method === "closeOutputFolder")).toHaveLength(2);
    expect(host.requests.some((r) => ["pickFolder", "createOutputFolder"].includes(r.method))).toBe(false);
    abort.abort();
    expect(await saveResult(deck, input, blob, abort.signal)).toBeNull();
    expect(host.requests.filter((r) => r.method === "openOutputFolder")).toHaveLength(2);
  } finally {
    deck.dispose();
  }
});
