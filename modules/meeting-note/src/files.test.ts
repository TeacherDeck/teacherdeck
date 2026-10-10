// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportText, importMeeting, pickMeeting, saveFile } from "./files.ts";
import { emptyMeeting, parseEntry } from "./meeting.ts";
import { EMPTY_LIBRARY, LIBRARY_KEY, archiveMeeting, removeArchive } from "./library.ts";
afterEach(() => vi.unstubAllGlobals());
const sample = () => ({
  ...emptyMeeting(),
  title: "가상 회의",
  speakers: ["가상 화자 A"],
  selected: "가상 화자 A",
  draft: "작성 중 초안",
  entries: [
    parseEntry("! 공개 결정", [], "가상 화자 A", "public"),
    parseEntry("// 개인 메모", [], "가상 화자 A", "private"),
  ].filter((entry) => entry !== null),
});
describe("meeting file and archive safety", () => {
  it("removes only a confirmed module archive, recovers capacity at twenty, and rolls back failed removal", async () => {
    const library = {
      rosters: [],
      archive: Array.from({ length: 20 }, (_, index) => ({
        key: `archive.item${index}`,
        title: "가상 보관",
        count: 2,
      })),
    };
    const store = new Map<string, unknown>([
      [LIBRARY_KEY, library],
      ["meeting.v1", sample()],
      ...library.archive.map((item) => [item.key, sample()] as [string, unknown]),
    ]);
    let failDelete = false;
    const host = createMockHost({
      granted: ["storage"],
      handlers: {
        "storage.set": (value) => {
          const args = value as { key: string; value: unknown };
          store.set(args.key, args.value);
          return null;
        },
        "storage.delete": (value) => {
          if (failDelete) throw new DeckCallError("INTERNAL", "합성 오류");
          store.delete((value as { key: string }).key);
          return null;
        },
      },
    });
    const deck = await connect({ window: host.window });
    await expect(archiveMeeting(deck, sample(), library)).rejects.toThrow("ARCHIVE_FULL");
    failDelete = true;
    await expect(removeArchive(deck, "archive.item0", library)).rejects.toMatchObject({ code: "INTERNAL" });
    expect(store.get(LIBRARY_KEY)).toEqual(library);
    expect(store.has("archive.item0")).toBe(true);
    failDelete = false;
    const smaller = await removeArchive(deck, "archive.item0", library);
    expect(smaller.archive).toHaveLength(19);
    expect(store.has("archive.item0")).toBe(false);
    expect(store.get("meeting.v1")).toEqual(sample());
    expect(store.has("archive.item1")).toBe(true);
    const fullAgain = await archiveMeeting(deck, sample(), smaller);
    expect(fullAgain.archive).toHaveLength(20);
    deck.dispose();
  });
  it("imports legacy agendas/speaker assignments/private notes without exposing private data in any public format", () => {
    const meeting = importMeeting({
      title: "가상 원본",
      place: "가상 장소",
      startedAt: "2026-10-10T00:00:00Z",
      speakers: [{ name: "가상 화자 A" }],
      cur: 0,
      absentees: ["가상 결석자"],
      agendas: [{ title: "공개 안건" }],
      entries: [
        { type: "액션", text: "공개 조치", sp: 0, ag: 1, priv: false, owner: "가상 담당", due: "10/10" },
        { type: "발언", text: "개인 메모", sp: null, ag: 1, priv: true },
      ],
    });
    expect(meeting.entries).toMatchObject([
      { kind: "안건", text: "공개 안건" },
      { kind: "조치", speaker: "가상 화자 A", owner: "가상 담당" },
      { private: true },
    ]);
    for (const format of ["txt", "md", "summary"] as const) {
      expect(exportText(meeting, format)).not.toContain("개인 메모");
      expect(exportText(meeting, format)).toContain("공개 조치");
    }
    expect(importMeeting(JSON.parse(JSON.stringify(meeting)))).toEqual(meeting);
    expect(() => importMeeting({ title: "가상", speakers: [], agendas: [], entries: [{ text: "invalid" }] })).toThrow();
  });
  it("reads selected JSON through bounded resource chunks and closes the read token", async () => {
    const data = new TextEncoder().encode(JSON.stringify(sample()));
    const origin = "http://deckmod.meeting-note.modules.localhost";
    const host = createMockHost({
      granted: ["fs"],
      handlers: {
        "fs.pickFiles": () => [{ handle: "input", size: data.length }],
        "fs.openRead": () => ({
          readId: "read",
          size: data.length,
          chunkBytes: 64,
          url: origin + "/_resources/" + "a".repeat(32),
        }),
        "fs.closeRead": () => null,
      },
    });
    host.window.location = { origin };
    const deck = await connect({ window: host.window });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const q = new URL(url).searchParams;
        const offset = Number(q.get("offset"));
        return new Response(data.slice(offset, offset + Number(q.get("length"))));
      }),
    );
    expect(await pickMeeting(deck)).toEqual(sample());
    expect(host.requests.at(-1)?.method).toBe("closeRead");
    deck.dispose();
  });
  it("saves an actual backup payload including private/draft and closes the output batch on write failure", async () => {
    const chunks: number[] = [];
    let fail = false;
    const host = createMockHost({
      granted: ["fs"],
      handlers: {
        "fs.pickFolder": () => ({ handle: "parent", name: "합성" }),
        "fs.createOutputFolder": () => ({ batchId: "batch", folder: { handle: "folder", name: "합성" } }),
        "fs.beginWrite": () => ({ writeId: "write", chunkBytes: 65536 }),
        "fs.writeChunk": (value) => {
          const args = value as { offset: number; data: number[] };
          if (fail) throw new DeckCallError("INTERNAL", "합성 오류");
          chunks.push(...args.data);
          return { nextOffset: args.offset + args.data.length };
        },
        "fs.commitWrite": () => ({
          handle: "saved",
          name: "synthetic",
          size: chunks.length,
          ext: "json",
          modifiedAt: 0,
        }),
        "fs.abortWrite": () => null,
        "fs.closeOutputFolder": () => null,
      },
    });
    const deck = await connect({ window: host.window });
    expect(await saveFile(deck, sample(), true, "txt")).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(chunks)))).toMatchObject({
      draft: "작성 중 초안",
      entries: [{ private: false }, { private: true, text: "개인 메모" }],
    });
    fail = true;
    await expect(saveFile(deck, sample(), false, "md")).rejects.toMatchObject({ code: "INTERNAL" });
    expect(host.requests.slice(-2).map((r) => r.method)).toEqual(["abortWrite", "closeOutputFolder"]);
    deck.dispose();
  });
  it("rolls back a new archive key when index save fails and preserves existing archive data", async () => {
    const store = new Map<string, unknown>([["archive.existing", sample()]]);
    const host = createMockHost({
      granted: ["storage"],
      handlers: {
        "storage.set": (value) => {
          const args = value as { key: string; value: unknown };
          if (args.key === LIBRARY_KEY) throw new DeckCallError("INTERNAL", "합성 오류");
          store.set(args.key, args.value);
          return null;
        },
        "storage.delete": (value) => {
          store.delete((value as { key: string }).key);
          return null;
        },
      },
    });
    const deck = await connect({ window: host.window });
    await expect(archiveMeeting(deck, sample(), EMPTY_LIBRARY)).rejects.toMatchObject({ code: "INTERNAL" });
    expect([...store.keys()]).toEqual(["archive.existing"]);
    expect(host.requests.at(-1)?.method).toBe("delete");
    deck.dispose();
  });
});
