// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { connect } from "./client.ts";
import { createDocumentSession } from "./document-session.ts";
import { createMockHost } from "./testing.ts";
const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function setup(write = async () => {}, state: (args: unknown) => Promise<void> = async () => {}) {
  const host = createMockHost({
    granted: ["window"],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "document" }),
      "window.setDocumentState": state,
      "window.completeDocumentSave": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  const error = vi.fn();
  const session = createDocumentSession(deck, { save: write, onError: error });
  await session.ready;
  return { host, deck, session, error };
}
describe("document session", () => {
  it("connects lazily and reconnects after a StrictMode effect cleanup", async () => {
    const host = createMockHost({
      granted: ["window"],
      handlers: {
        "window.registerDocument": () => ({ documentHandle: "document" }),
        "window.setDocumentState": () => null,
        "window.completeDocumentSave": () => null,
      },
    });
    const deck = await connect({ window: host.window });
    createDocumentSession(deck, { save: async () => {} });
    await host.flush();
    expect(host.requests).toEqual([]);
    const write = vi.fn(async () => {});
    const session = createDocumentSession(deck, { save: write, isSaved: () => false });
    await session.ready;
    session.dispose();
    await session.ready;
    await session.change(() => {});
    expect(await session.save()).toBe(false);
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toEqual({
      documentHandle: "document",
      dirty: true,
      saving: false,
    });
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "strict" });
    await session.settle();
    await host.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(host.requests.find((request) => request.method === "completeDocumentSave")?.args).toEqual({
      documentHandle: "document",
      requestId: "strict",
      saved: false,
    });
    session.dispose();
    deck.dispose();
  });
  it("waits for the first dirty acknowledgement and preserves queued edits in order", async () => {
    const gate = deferred();
    const { session, deck } = await setup(
      async () => {},
      () => gate.promise,
    );
    const values: number[] = [];
    const first = session.change(() => values.push(1));
    const second = session.change(() => values.push(2));
    await Promise.resolve();
    expect(values).toEqual([]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(values).toEqual([1, 2]);
    void session.change(() => values.push(3));
    expect(values).toEqual([1, 2, 3]);
    session.dispose();
    deck.dispose();
  });
  it("does not apply an edit when protection fails", async () => {
    const { session, deck, error } = await setup(
      async () => {},
      async () => {
        throw new Error("NO_ACK");
      },
    );
    const edit = vi.fn();
    expect(await session.change(edit)).toBe(false);
    expect(edit).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    session.dispose();
    deck.dispose();
  });
  it("keeps failed saves dirty and answers lifecycle requests only after persistence", async () => {
    const gate = deferred();
    const { session, host, deck } = await setup(() => gate.promise);
    await session.change(() => {});
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "request" });
    await host.flush();
    expect(host.requests.some((r) => r.method === "completeDocumentSave")).toBe(false);
    gate.resolve();
    await session.settle();
    await host.flush();
    expect(host.requests.find((r) => r.method === "completeDocumentSave")?.args).toEqual({
      documentHandle: "document",
      requestId: "request",
      saved: true,
    });
    session.dispose();
    deck.dispose();
    const failure = await setup(async () => {
      throw new Error("QUOTA");
    });
    await failure.session.change(() => {});
    expect(await failure.session.save()).toBe(false);
    expect(failure.host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toEqual({
      documentHandle: "document",
      dirty: true,
      saving: false,
    });
    failure.session.dispose();
    failure.deck.dispose();
  });
  it("queues edits behind a save and keeps their protection before applying them", async () => {
    const gate = deferred();
    const { session, host, deck } = await setup(() => gate.promise);
    await session.change(() => {});
    const save = session.save();
    const edit = vi.fn();
    const changed = session.change(edit);
    await host.flush();
    expect(edit).not.toHaveBeenCalled();
    gate.resolve();
    expect(await save).toBe(false);
    await changed;
    expect(edit).toHaveBeenCalledOnce();
    expect(host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toEqual({
      documentHandle: "document",
      dirty: true,
      saving: false,
    });
    session.dispose();
    deck.dispose();
  });
  it("refuses lifecycle completion for edits requested during persistence or its final acknowledgement", async () => {
    for (const boundary of ["write", "ack"] as const) {
      const gate = deferred();
      const reached = deferred();
      const { session, host, deck, error } = await setup(
        async () => {
          if (boundary === "write") {
            reached.resolve();
            await gate.promise;
          }
        },
        async (args) => {
          const state = args as { dirty: boolean; saving: boolean };
          if (boundary === "ack" && !state.dirty && !state.saving) {
            reached.resolve();
            await gate.promise;
          }
        },
      );
      await session.change(() => {});
      host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: boundary });
      await reached.promise;
      const edit = vi.fn();
      const changed = session.change(edit);
      expect(edit).not.toHaveBeenCalled();
      gate.resolve();
      await changed;
      await session.settle();
      await host.flush();
      expect(edit).toHaveBeenCalledOnce();
      expect(host.requests.find((request) => request.method === "completeDocumentSave")?.args).toEqual({
        documentHandle: "document",
        requestId: boundary,
        saved: false,
      });
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toEqual({
        documentHandle: "document",
        dirty: true,
        saving: false,
      });
      expect(error).not.toHaveBeenCalled();
      session.dispose();
      deck.dispose();
    }
  });
  it("does not mutate an unmounted module after a late acknowledgement", async () => {
    const gate = deferred();
    const { session, host, deck } = await setup(
      async () => {},
      () => gate.promise,
    );
    const edit = vi.fn();
    const changed = session.change(edit);
    await host.flush();
    session.dispose();
    gate.resolve();
    await changed;
    expect(edit).not.toHaveBeenCalled();
    deck.dispose();
  });
});
