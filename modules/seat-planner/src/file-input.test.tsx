// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, type Deck, type FileHandleInfo } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { emptyState } from "./logic.ts";
import { exportFile } from "./state.ts";
const seed = () => emptyState();
const save = (deck: Deck, source?: FileHandleInfo, chooseFolder = false) =>
  exportFile(deck, seed(), null, source, chooseFolder);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function setup(bytesOverride?: Uint8Array) {
  const bytes = bytesOverride ?? new TextEncoder().encode(JSON.stringify(seed()));
  const file: FileHandleInfo = {
    handle: "source",
    name: "합성백업.json",
    ext: "json",
    size: bytes.length,
    modifiedAt: 0,
  };
  const origin = "http://deckmod.seat-planner.modules.localhost";
  const values = new Map<string, unknown>();
  let written = 0;
  const host = createMockHost({
    module: { id: "seat-planner", version: "0.2.0" },
    granted: ["fs", "storage", "window", "messaging"],
    handlers: {
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "storage.set": (args) => {
        const a = args as { key: string; value: unknown };
        values.set(a.key, a.value);
        return null;
      },
      "storage.keys": () => [...values.keys()],
      "storage.delete": (args) => {
        values.delete((args as { key: string }).key);
        return null;
      },
      "fs.pickFiles": () => {
        throw new Error("UNEXPECTED_FILE_PICKER");
      },
      "fs.pickFolder": () => ({ handle: "chosen", name: "합성폴더" }),
      "fs.openRead": () => ({
        readId: "read",
        size: bytes.length,
        chunkBytes: 64,
        url: origin + "/_resources/" + "a".repeat(32),
      }),
      "fs.closeRead": () => null,
      "fs.openOutputFolder": () => ({ batchId: "batch", folder: { handle: "output", name: "합성폴더" } }),
      "fs.beginWrite": () => {
        written = 0;
        return { writeId: "write", chunkBytes: 65536 };
      },
      "fs.writeChunk": (args) => {
        const a = args as { offset: number; data: number[] };
        written += a.data.length;
        return { nextOffset: a.offset + a.data.length };
      },
      "fs.commitWrite": () => ({ ...file, handle: "saved", size: written }),
      "fs.abortWrite": () => null,
      "fs.closeOutputFolder": () => null,
    },
  });
  host.window.location = { origin };
  const deck = await connect({ window: host.window });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      const offset = Number(q.get("offset"));
      return new Response(bytes.slice(offset, offset + Number(q.get("length"))));
    }),
  );
  return { host, deck, file };
}
async function open(bytesOverride?: Uint8Array) {
  const context = await setup(bytesOverride);
  const view = render(
    <DeckProvider>
      <App deck={context.deck} />
    </DeckProvider>,
  );
  await waitFor(() =>
    expect(
      [...view.container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "기록 파일 가져오기" && !button.disabled,
      ),
    ).toBe(true),
  );
  return { ...context, view };
}
describe("native file input and direct output", () => {
  it("accepts a dropped backup and visibly identifies it without opening either picker", async () => {
    const { host, deck, file } = await open();
    await act(async () => host.emit("fs.dropped", { files: [file] }));
    await waitFor(() => expect(screen.getAllByText(/합성백업.json/).length).toBeGreaterThan(0));
    await waitFor(() => expect(host.requests.some((r) => r.method === "closeRead")).toBe(true));
    expect(host.requests.some((r) => r.method === "pickFiles" || r.method === "pickFolder")).toBe(false);
    deck.dispose();
  });
  it("keeps the received filename visible while the native read is still pending", async () => {
    const { host, deck, file } = await open();
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const fetchChunk = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string) => {
      await gate;
      return fetchChunk(url);
    });
    await act(async () => host.emit("fs.dropped", { files: [file] }));
    try {
      await screen.findByText(/합성백업.json.*읽고 있어요/);
      await waitFor(() => expect(host.requests.some((r) => r.method === "openRead")).toBe(true));
      expect(host.requests.some((r) => r.method === "closeRead" || r.method === "pickFiles")).toBe(false);
    } finally {
      resume();
    }
    await waitFor(() => expect(host.requests.some((r) => r.method === "closeRead")).toBe(true));
    deck.dispose();
  });
  it("rejects multiple dropped imports visibly instead of silently choosing one", async () => {
    const { host, deck, file } = await open();
    await act(async () => host.emit("fs.dropped", { files: [file, { ...file, handle: "second" }] }));
    await screen.findByText(/1개씩/);
    expect(host.requests.some((r) => r.method === "openRead" || r.method === "pickFiles")).toBe(false);
    deck.dispose();
  });
  it("does not reuse a previous roster source after starting a new manual task", async () => {
    const { host, deck, file } = await open(new TextEncoder().encode("1 합성학생가"));
    await act(async () => host.emit("fs.dropped", { files: [{ ...file, name: "합성명단.txt", ext: "txt" }] }));
    await screen.findByText(/합성명단.txt.*읽었어요/);
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText(/명단을 적용했어요/);
    fireEvent.click(screen.getByRole("button", { name: "새 작업" }));
    const dialog = await screen.findByRole("dialog");
    const newTaskButton = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "새 작업",
    );
    if (!newTaskButton) throw new Error("MISSING_CONFIRMATION_ACTION");
    fireEvent.click(newTaskButton);
    await screen.findByText(/새 작업을 시작했어요/);
    fireEvent.change(screen.getByRole("textbox", { name: "학생 명단" }), { target: { value: "1 합성학생나" } });
    fireEvent.click(screen.getByRole("button", { name: "명단 적용" }));
    await screen.findByText(/명단을 적용했어요/);
    fireEvent.click(screen.getByRole("button", { name: "기록 파일 저장" }));
    await waitFor(() => expect(host.requests.some((r) => r.method === "openOutputFolder")).toBe(true));
    expect(host.requests.find((r) => r.method === "openOutputFolder")?.args).toEqual({ parentHandle: "chosen" });
    expect(host.requests.some((r) => r.method === "pickFolder")).toBe(true);
    deck.dispose();
  });
  it("saves next to the associated source without choosing or creating a folder", async () => {
    const { host, deck, file } = await setup();
    expect(await save(deck, file)).toBe(true);
    expect(host.requests.find((r) => r.method === "openOutputFolder")?.args).toEqual({ sourceHandle: file.handle });
    expect(host.requests.some((r) => r.method === "pickFolder" || r.method === "createOutputFolder")).toBe(false);
    expect(host.requests.at(-1)?.method).toBe("closeOutputFolder");
    deck.dispose();
  });
  it("uses an explicitly chosen folder directly instead of the source folder", async () => {
    const { host, deck, file } = await setup();
    expect(await save(deck, file, true)).toBe(true);
    expect(host.requests.find((r) => r.method === "openOutputFolder")?.args).toEqual({ parentHandle: "chosen" });
    expect(host.requests.some((r) => r.method === "createOutputFolder")).toBe(false);
    deck.dispose();
  });
  it("asks for an actual destination when the new document has no source", async () => {
    const { host, deck } = await setup();
    expect(await save(deck)).toBe(true);
    expect(host.requests.some((r) => r.method === "pickFolder")).toBe(true);
    expect(host.requests.find((r) => r.method === "openOutputFolder")?.args).toEqual({ parentHandle: "chosen" });
    expect(host.requests.some((r) => r.method === "createOutputFolder")).toBe(false);
    deck.dispose();
  });
});
