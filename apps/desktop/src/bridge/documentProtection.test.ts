// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { DocumentProtection, type DocumentDecision, type DocumentProtectionHost } from "./documentProtection.ts";
import type { DocumentAction } from "../generated/DocumentAction.ts";
import type { DocumentActionResult } from "../generated/DocumentActionResult.ts";

const empty: DocumentActionResult = { state: null, requestId: null, saved: null };
const state = { documentHandle: "synthetic-document", dirty: true, saving: false };
function setup(decision: DocumentDecision, respond: (action: DocumentAction) => DocumentActionResult = () => empty) {
  const host: DocumentProtectionHost = {
    documentAction: vi.fn(async (_moduleId, action) =>
      action.kind === "prepare" ? { state, requestId: "synthetic-leave", saved: null } : respond(action),
    ),
    moduleUnloaded: vi.fn(async () => undefined),
  };
  const discarded = vi.fn();
  const ask = vi.fn(async () => decision);
  let time = 0;
  const protection = new DocumentProtection(
    host,
    ask,
    discarded,
    () => undefined,
    async (ms) => {
      time += ms;
    },
    () => time,
  );
  return { host, discarded, ask, protection };
}

describe("unsaved document transition", () => {
  it("Cancel keeps the protected iframe and cancels only its prepared request", async () => {
    const { host, protection, discarded } = setup("cancel");
    expect(await protection.allow(["synthetic-tool"])).toBe(false);
    expect(host.moduleUnloaded).not.toHaveBeenCalled();
    expect(discarded).not.toHaveBeenCalled();
    expect(host.documentAction).toHaveBeenLastCalledWith("synthetic-tool", {
      kind: "cancelSave",
      requestId: "synthetic-leave",
    });
  });
  it("Discard uses the exact prepared document and unloads before dropping the iframe", async () => {
    const { host, protection, discarded } = setup("discard");
    expect(await protection.allow(["synthetic-tool"])).toBe(true);
    expect(host.documentAction).toHaveBeenCalledWith("synthetic-tool", {
      kind: "discard",
      documentHandle: "synthetic-document",
      requestId: "synthetic-leave",
    });
    expect(host.moduleUnloaded).toHaveBeenCalledWith("synthetic-tool");
    expect(discarded).toHaveBeenCalledWith("synthetic-tool");
    expect(vi.mocked(host.moduleUnloaded).mock.invocationCallOrder[0]).toBeLessThan(
      discarded.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("Save waits for the response and checks the current clean revision", async () => {
    let polls = 0;
    const { protection, host } = setup("save", (action) =>
      action.kind === "saveResult"
        ? ++polls < 3
          ? empty
          : { state: { ...state, dirty: false }, requestId: null, saved: true }
        : action.kind === "status"
          ? { ...empty, state: { ...state, dirty: false } }
          : empty,
    );
    expect(await protection.allow(["synthetic-tool"])).toBe(true);
    expect(polls).toBe(3);
    expect(host.moduleUnloaded).not.toHaveBeenCalled();
  });
  it("Save failure, timeout and a subsequent edit all preserve the iframe", async () => {
    for (const mode of ["failure", "timeout", "edit"]) {
      const { protection, host } = setup("save", (action) => {
        if (action.kind === "saveResult")
          return mode === "timeout"
            ? empty
            : { state: { ...state, dirty: mode === "failure" }, requestId: null, saved: mode !== "failure" };
        if (action.kind === "status") return { ...empty, state };
        return empty;
      });
      expect(await protection.allow(["synthetic-tool"])).toBe(false);
      expect(host.moduleUnloaded).not.toHaveBeenCalled();
    }
  });
  it("an already running save and unreachable host never authorize unload", async () => {
    const { protection, host } = setup("discard");
    vi.mocked(host.documentAction).mockResolvedValueOnce({
      state: { ...state, saving: true },
      requestId: "leave",
      saved: null,
    });
    expect(await protection.allow(["synthetic-tool"])).toBe(false);
    vi.mocked(host.documentAction).mockRejectedValueOnce(new Error("synthetic failure"));
    expect(await protection.allow(["synthetic-tool"])).toBe(false);
    expect(host.moduleUnloaded).not.toHaveBeenCalled();
  });
});
