// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { connect } from "./client.ts";
import { createMockHost } from "./testing.ts";

describe("fs 1.4 direct output", () => {
  it("sends an opaque source or selected folder without opening a picker", async () => {
    const batch = { batchId: "synthetic-batch", folder: { handle: "synthetic-folder", name: "합성 폴더" } };
    const host = createMockHost({ granted: ["fs"], handlers: { "fs.openOutputFolder": () => batch } });
    const deck = await connect({ window: host.window });
    expect(await deck.fs.openOutputFolder({ sourceHandle: "synthetic-source" })).toEqual(batch);
    expect(await deck.fs.openOutputFolder({ parentHandle: "synthetic-selected" })).toEqual(batch);
    expect(host.requests.map(({ method, args }) => ({ method, args }))).toEqual([
      { method: "openOutputFolder", args: { sourceHandle: "synthetic-source" } },
      { method: "openOutputFolder", args: { parentHandle: "synthetic-selected" } },
    ]);
    deck.dispose();
  });
  it("rejects older or undeclared fs before sending requests", async () => {
    for (const granted of [[], ["fs"]]) {
      const host = createMockHost({ granted, caps: { fs: "1.3.0" } });
      const deck = await connect({ window: host.window });
      await expect(deck.fs.openOutputFolder({ sourceHandle: "synthetic-source" })).rejects.toMatchObject({
        code: granted.length === 0 ? "PERMISSION_DENIED" : "VERSION_MISMATCH",
      });
      expect(host.requests).toEqual([]);
      deck.dispose();
    }
  });
  it("rejects absent, empty and ambiguous destination handles", async () => {
    const host = createMockHost({ granted: ["fs"] });
    const deck = await connect({ window: host.window });
    for (const args of [
      {},
      { sourceHandle: "" },
      { sourceHandle: "", parentHandle: "synthetic-selected" },
      { sourceHandle: "synthetic-source", parentHandle: "synthetic-selected" },
    ]) {
      await expect(deck.fs.openOutputFolder(args)).rejects.toMatchObject({ code: "INVALID_ARGS" });
    }
    expect(host.requests).toEqual([]);
    deck.dispose();
  });
});
