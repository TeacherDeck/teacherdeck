// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { describe, expect, it } from "vitest";
import { EMPTY_LIBRARY, LIBRARY_KEY } from "./library.ts";
import { emptyMeeting } from "./meeting.ts";
import { recoverMeetingStorage, saveRecoveryBackup } from "./recovery.ts";
import { MAX_BYTES, MEETING_KEY } from "./storage.ts";

async function setup(fail?: string, cancel = false) {
  const meeting = { ...emptyMeeting(), draft: "합성 보존 초안" };
  const broken = { archive: "합성 손상" };
  const archive = { ...emptyMeeting(), title: "합성 지난 회의" };
  const store = new Map<string, unknown>([
    [MEETING_KEY, meeting],
    [LIBRARY_KEY, broken],
    ["archive.synthetic", archive],
  ]);
  const chunks: number[] = [];
  const host = createMockHost({
    module: { id: "meeting-note", version: "0.4.1" },
    granted: ["storage", "fs"],
    handlers: {
      "storage.get": (value) => {
        if (fail === "read") throw new DeckCallError("INTERNAL", "합성 오류");
        return store.get((value as { key: string }).key) ?? null;
      },
      "storage.set": (value) => {
        const args = value as { key: string; value: unknown };
        if (args.key.startsWith("recovery.")) throw new DeckCallError("INTERNAL", "합성 저장 한도");
        store.set(args.key, args.value);
        return null;
      },
      "fs.pickFolder": () => (cancel ? null : { handle: "parent", name: "합성" }),
      "fs.openOutputFolder": () => ({ batchId: "batch", folder: { handle: "folder", name: "합성" } }),
      "fs.beginWrite": () => {
        if (fail === "begin") throw new DeckCallError("INTERNAL", "합성 오류");
        chunks.length = 0;
        return { writeId: "write", chunkBytes: 65536 };
      },
      "fs.writeChunk": (value) => {
        if (fail === "write") throw new DeckCallError("INTERNAL", "합성 오류");
        const args = value as { offset: number; data: number[] };
        chunks.push(...args.data);
        return { nextOffset: args.offset + args.data.length };
      },
      "fs.commitWrite": () => {
        if (fail === "commit") throw new DeckCallError("INTERNAL", "합성 오류");
        return {
          handle: "saved",
          name: "recovery.json",
          ext: "json",
          modifiedAt: 0,
          size: chunks.length + (fail === "size" ? 1 : 0),
        };
      },
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => {
        if (fail === "close") throw new DeckCallError("INTERNAL", "합성 오류");
        return null;
      },
    },
  });
  const deck = await connect({ window: host.window });
  return { deck, host, store, chunks, meeting, broken, archive };
}

describe("meeting recovery at storage quota", () => {
  it("requires a committed and closed original-value backup before avoiding duplicate internal copies", async () => {
    const { deck, host, store, meeting, archive, chunks } = await setup();
    await expect(recoverMeetingStorage(deck)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(store.get(MEETING_KEY)).toEqual(meeting);
    const backup = await saveRecoveryBackup(deck);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)))).toMatchObject({
      meeting,
      library: { archive: "합성 손상" },
    });
    await recoverMeetingStorage(deck, undefined, backup);
    expect(store.get(MEETING_KEY)).toEqual(meeting);
    expect(store.get(LIBRARY_KEY)).toEqual(EMPTY_LIBRARY);
    expect(store.get("archive.synthetic")).toEqual(archive);
    deck.dispose();
  });
  it("restores a replacement after preserving the damaged original externally", async () => {
    const { deck, store, archive } = await setup();
    store.set(MEETING_KEY, { entries: "합성 손상" });
    const backup = await saveRecoveryBackup(deck);
    const replacement = { ...emptyMeeting(), title: "합성 복구 회의" };
    await recoverMeetingStorage(deck, replacement, backup);
    expect(store.get(MEETING_KEY)).toEqual(replacement);
    expect(store.get("archive.synthetic")).toEqual(archive);
    deck.dispose();
  });
  it("a cancelled folder pick gives no authority and performs no output writes", async () => {
    const { deck, host, store, broken } = await setup(undefined, true);
    const backup = await saveRecoveryBackup(deck);
    expect(backup).toBeNull();
    expect(host.requests.some((request) => request.method === "beginWrite")).toBe(false);
    await expect(recoverMeetingStorage(deck, emptyMeeting(), backup)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(store.get(LIBRARY_KEY)).toEqual(broken);
    deck.dispose();
  });
  it.each(["begin", "write", "commit", "close", "size", "read"])(
    "%s failure returns no backup receipt or storage mutation",
    async (stage) => {
      const { deck, host, store, broken, meeting } = await setup(stage);
      await expect(saveRecoveryBackup(deck)).rejects.toThrow();
      expect(host.requests.some((request) => request.cap === "storage" && request.method === "set")).toBe(false);
      expect(store.get(MEETING_KEY)).toEqual(meeting);
      expect(store.get(LIBRARY_KEY)).toEqual(broken);
      deck.dispose();
    },
  );
  it.each([MEETING_KEY, LIBRARY_KEY])("rejects a stale external receipt when %s changed", async (key) => {
    const { deck, store } = await setup();
    const backup = await saveRecoveryBackup(deck);
    const changed = key === MEETING_KEY ? { ...emptyMeeting(), draft: "합성 변경 초안" } : { archive: "합성 변경 값" };
    store.set(key, changed);
    await expect(recoverMeetingStorage(deck, emptyMeeting(), backup)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(store.get(key)).toEqual(changed);
    deck.dispose();
  });
  it("receipt equality ignores object key order but captures a deep immutable original snapshot", async () => {
    const { deck, store, meeting } = await setup();
    const backup = await saveRecoveryBackup(deck);
    store.set(MEETING_KEY, Object.fromEntries(Object.entries(meeting).reverse()));
    await recoverMeetingStorage(deck, undefined, backup);
    const nextBackup = await saveRecoveryBackup(deck);
    const current = store.get(MEETING_KEY) as { draft: string };
    current.draft = "합성 값 변경";
    await expect(recoverMeetingStorage(deck, emptyMeeting(), nextBackup)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(store.get(MEETING_KEY)).toMatchObject({ draft: "합성 값 변경" });
    deck.dispose();
  });
  it("validates oversized replacement before replacing either original key", async () => {
    const { deck, store, meeting, broken } = await setup();
    const backup = await saveRecoveryBackup(deck);
    await expect(
      recoverMeetingStorage(deck, { ...emptyMeeting(), draft: "가".repeat(MAX_BYTES) }, backup),
    ).rejects.toThrow("MEETING_TOO_LARGE");
    expect(store.get(MEETING_KEY)).toEqual(meeting);
    expect(store.get(LIBRARY_KEY)).toEqual(broken);
    deck.dispose();
  });
});
