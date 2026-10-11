// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it, vi } from "vitest";
import { connect } from "./client.ts";
import { createMockHost } from "./testing.ts";

describe("approved foundation capability helpers", () => {
  it("does not post requests without the module's declared authority", async () => {
    const host = createMockHost();
    const deck = await connect({ window: host.window, logger: { warn: () => undefined, debug: () => undefined } });
    for (const request of [
      () => deck.fileOps.planRename({ items: [] }),
      () => deck.schoolData.status(),
      () => deck.office.availability(),
      () => deck.network.adapters(),
      () => deck.messaging.connect({ provider: "gentoo" }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(host.requests).toHaveLength(0);
    deck.dispose();
  });
  it("guards fs 1.3 folder listing before calling an older host", async () => {
    const host = createMockHost({ granted: ["fs"], caps: { fs: "1.2.0" } });
    const deck = await connect({ window: host.window });
    await expect(deck.fs.listFiles({ folderHandle: "opaque", recursive: false })).rejects.toMatchObject({
      code: "VERSION_MISMATCH",
    });
    expect(host.requests).toHaveLength(0);
    deck.dispose();
  });
  it("waits for the trusted school grant instead of applying the ordinary RPC timeout", async () => {
    vi.useFakeTimers();
    const host = createMockHost({ granted: ["school-data"] });
    const original = host.window.parent.postMessage.bind(host.window.parent);
    host.window.parent.postMessage = (message, origin) => {
      if ((message as { kind?: string }).kind !== "req") original(message, origin);
    };
    const deck = await connect({ window: host.window, timeoutMs: 5 });
    const result = deck.schoolData.requestAccess({ kinds: ["homeroom"], scopes: ["roster-basic"], remember: false });
    let settled = false;
    const outcome = result.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    deck.dispose();
    await outcome;
    vi.useRealTimers();
  });
});
