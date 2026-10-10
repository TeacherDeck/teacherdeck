// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { hasSafeFrameSources } from "../check-security.ts";

describe("SEC-002 reserved module frame sources", () => {
  it("accepts the reserved suffix and legacy debug probe only", () => {
    expect(hasSafeFrameSources({ "frame-src": "http://*.modules.localhost http://deckmod.localhost" })).toBe(true);
    expect(hasSafeFrameSources("default-src 'self'; frame-src http://*.modules.localhost")).toBe(true);
  });
  it("rejects whole localhost, invalid middle wildcards, IPC and remote frame sources", () => {
    for (const source of [
      "http://*.localhost",
      "http://deckmod.*.localhost",
      "http://ipc.localhost",
      "http://tauri.localhost",
      "https:",
      "*",
      "http://remote.example",
      "http://*.modules.localhost http://ipc.localhost",
    ]) {
      expect(hasSafeFrameSources({ "frame-src": source })).toBe(false);
      expect(hasSafeFrameSources(`default-src 'self'; frame-src ${source}`)).toBe(false);
    }
  });
});
