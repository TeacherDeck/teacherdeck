// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { emptyMeeting } from "./meeting.ts";
import { createWriter, loadMeeting, MAX_BYTES, MEETING_KEY } from "./storage.ts";
describe("meeting storage", () => {
  it("restores saved state through the mock host and persists the latest snapshot", async () => {
    const state = { ...emptyMeeting(), title: "가상 회의" };
    const store = new Map<string, unknown>([[MEETING_KEY, state]]);
    const host = createMockHost({
      module: { id: "meeting-note", version: "0.1.0" },
      granted: ["storage"],
      handlers: {
        "storage.get": () => store.get(MEETING_KEY),
        "storage.set": async (args) => {
          const { value } = args as { value: unknown };
          await Promise.resolve();
          store.set(MEETING_KEY, value);
          return null;
        },
      },
    });
    const deck = await connect({ window: host.window });
    expect(await loadMeeting(deck)).toEqual(state);
    const writer = createWriter(deck);
    await Promise.all([writer({ ...state, title: "이전" }), writer({ ...state, title: "최신" })]);
    expect(store.get(MEETING_KEY)).toMatchObject({ title: "최신" });
    expect(host.requests.map((r) => `${r.cap}.${r.method}`)).toEqual(["storage.get", "storage.set", "storage.set"]);
    await expect(writer({ ...state, draft: "가".repeat(MAX_BYTES) })).rejects.toThrow("MEETING_TOO_LARGE");
    expect(host.requests).toHaveLength(3);
    deck.dispose();
  });
});
