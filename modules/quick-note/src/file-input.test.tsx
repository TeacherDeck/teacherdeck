// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, type Deck, type FileHandleInfo } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { emptyDocument } from "./logic.ts";
import { exportBackup } from "./files.ts";
const seed = () => emptyDocument();
const save = (deck: Deck, source?: FileHandleInfo, chooseFolder = false) =>
  exportBackup(deck, seed(), source, chooseFolder);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function setup() {
  const bytes = new TextEncoder().encode(JSON.stringify(seed()));
  const file: FileHandleInfo = {
    handle: "source",
    name: "합성백업.json",
    ext: "json",
    size: bytes.length,
    modifiedAt: 0,
  };
  const origin = "http://deckmod.quick-note.modules.localhost";
  const values = new Map<string, unknown>();
  let written = 0;
  const host = createMockHost({
    module: { id: "quick-note", version: "0.2.0" },
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
  return { host, deck, file, values };
}
async function open() {
  const context = await setup();
  const view = render(
    <DeckProvider>
      <App deck={context.deck} />
    </DeckProvider>,
  );
  const expander = await screen.findByRole("button", { name: "백업 · 가져오기" });
  if (expander.getAttribute("aria-expanded") === "false") fireEvent.click(expander);
  await waitFor(() =>
    expect(
      [...view.container.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "JSON 백업 가져오기" && !button.disabled,
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
  it("rejects multiple dropped imports visibly instead of silently choosing one", async () => {
    const { host, deck, file } = await open();
    await act(async () => host.emit("fs.dropped", { files: [file, { ...file, handle: "second" }] }));
    await screen.findByText(/1개씩/);
    expect(host.requests.some((r) => r.method === "openRead" || r.method === "pickFiles")).toBe(false);
    deck.dispose();
  });
  it("does not attach a cancelled external source to a later internal recovery", async () => {
    const { host, deck, file, values } = await open();
    values.set("recovery.v1.synthetic", seed());
    await act(async () => host.emit("fs.dropped", { files: [file] }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "이전 자료 찾기" }));
    const review = await screen.findByRole("button", { name: "이전 자료 복원 확인" });
    await waitFor(() => expect(review.hasAttribute("disabled")).toBe(false));
    fireEvent.click(review);
    fireEvent.click(await screen.findByRole("button", { name: "확인하고 복원" }));
    await screen.findByText(/백업을 복원했어요/);
    fireEvent.click(screen.getByRole("button", { name: "JSON 백업 저장" }));
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
