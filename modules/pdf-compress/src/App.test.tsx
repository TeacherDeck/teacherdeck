// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import type { FolderHandleInfo } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { runBatch } from "./batch.ts";
vi.mock("./batch.ts", async (original) => ({ ...(await original<typeof import("./batch.ts")>()), runBatch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("compresses selected and dropped PDFs automatically in preserving mode and asks for the folder once", async () => {
  const first = { handle: "a", name: "합성 첫문서.pdf", ext: "pdf", size: 4, modifiedAt: 0 };
  const second = { ...first, handle: "b", name: "합성 둘째문서.pdf" };
  const folder = { handle: "output", name: "합성 결과" };
  const pickFolder = vi.fn(() => ({ handle: "parent", name: "합성 저장 폴더" }));
  const host = createMockHost({
    module: { id: "pdf-compress", version: "0.1.0" },
    caps: { fs: "1.1.0", storage: "1.0.0" },
    granted: ["fs", "storage"],
    handlers: {
      "storage.get": () => null,
      "storage.set": () => null,
      "fs.pickFiles": () => [first],
      "fs.pickFolder": pickFolder,
    },
  });
  const deck = await connect({ window: host.window });
  vi.mocked(runBatch).mockImplementation(async (_deck, selected) => ({
    folder,
    results: selected.map((file) => ({ file, status: "compressed", outputSize: 2, folder })),
  }));
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^PDF 추가$/ }));
  await screen.findByText(/1개 PDF를 줄였어요/);
  expect(runBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runBatch).mock.calls[0]?.[3].mode).toBe("preserve");
  await act(async () => {
    host.emit("fs.dropped", { files: [second] });
  });
  await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole("button", { name: /^취소$/ }).hasAttribute("disabled")).toBe(true));
  expect(vi.mocked(runBatch).mock.calls[1]?.[1]).toEqual([second]);
  expect(pickFolder).toHaveBeenCalledOnce();
  expect(screen.queryByRole("checkbox", { name: "이미지 문서로 바뀌는 것을 확인했어요" })).toBeNull();
  view.unmount();
  deck.dispose();
});

async function dropHarness(pickFolder: () => FolderHandleInfo | null | Promise<FolderHandleInfo | null>) {
  const first = { handle: "a", name: "합성 첫문서.pdf", ext: "pdf", size: 4, modifiedAt: 0 };
  const second = { ...first, handle: "b", name: "합성 둘째문서.pdf" };
  const folder = { handle: "output", name: "합성 결과" };
  const host = createMockHost({
    module: { id: "pdf-compress", version: "0.1.0" },
    caps: { fs: "1.1.0", storage: "1.0.0" },
    granted: ["fs", "storage"],
    handlers: { "storage.get": () => null, "storage.set": () => null, "fs.pickFolder": pickFolder },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return { first, second, folder, host, deck, view };
}

it("reuses a chosen folder for a drop arriving immediately after completion before React commits its new subscription", async () => {
  const pickFolder = vi.fn(() => ({ handle: "parent", name: "합성 저장 폴더" }));
  const { first, second, folder, host, deck, view } = await dropHarness(pickFolder);
  let batches = 0;
  vi.mocked(runBatch).mockImplementation(async (_deck, selected) => {
    if (++batches === 1) {
      // Deliver after the await continuation clears the execution lock, but before
      // React can replace an effect's closure. This is a real bridge-event boundary,
      // not a later DOM query that waits away the stale folder value.
      queueMicrotask(() => queueMicrotask(() => host.emit("fs.dropped", { files: [second] })));
    }
    return { folder, results: selected.map((file) => ({ file, status: "compressed", outputSize: 2, folder })) };
  });
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(runBatch).mock.calls.map((call) => call[1])).toEqual([[first], [second]]);
    expect(vi.mocked(runBatch).mock.calls.map((call) => call[2])).toEqual(["parent", "parent"]);
    expect(pickFolder).toHaveBeenCalledOnce();
    expect(screen.getAllByText(/^합성 첫문서\.pdf ·/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^합성 둘째문서\.pdf ·/).length).toBeGreaterThan(0);
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("rejects drops while choosing a folder and permits a new choice after cancellation without losing pending files", async () => {
  let cancelChoice: ((folder: FolderHandleInfo | null) => void) | undefined;
  const pendingChoice = new Promise<FolderHandleInfo | null>((resolve) => {
    cancelChoice = resolve;
  });
  const pickFolder = vi
    .fn<() => FolderHandleInfo | null | Promise<FolderHandleInfo | null>>()
    .mockReturnValueOnce(pendingChoice)
    .mockReturnValue({ handle: "parent", name: "합성 저장 폴더" });
  const { first, second, folder, host, deck, view } = await dropHarness(pickFolder);
  vi.mocked(runBatch).mockImplementation(async (_deck, selected) => ({
    folder,
    results: selected.map((file) => ({ file, status: "compressed", outputSize: 2, folder })),
  }));
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
      await host.flush();
    });
    expect(pickFolder).toHaveBeenCalledOnce();
    await act(async () => {
      host.emit("fs.dropped", { files: [second] });
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(pickFolder).toHaveBeenCalledOnce();
    expect(screen.getByText("현재 파일을 처리하고 있어요. 끝난 뒤 다음 파일을 추가해 주세요.")).toBeTruthy();
    expect(screen.queryAllByText(/^합성 둘째문서\.pdf ·/)).toHaveLength(0);
    await act(async () => {
      cancelChoice?.(null);
      await host.flush();
    });
    expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(/^합성 첫문서\.pdf ·/)).toHaveLength(1);
    await act(async () => {
      host.emit("fs.dropped", { files: [second] });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([second]);
    expect(pickFolder).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/^합성 첫문서\.pdf ·/)).toHaveLength(1);
    expect(screen.getAllByText(/^합성 둘째문서\.pdf ·/)).toHaveLength(2);
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("keeps the previous destination when a next-folder dialog is cancelled and blocks drops while it is open", async () => {
  let cancelChoice: ((folder: FolderHandleInfo | null) => void) | undefined;
  const pendingChoice = new Promise<FolderHandleInfo | null>((resolve) => {
    cancelChoice = resolve;
  });
  const pickFolder = vi
    .fn<() => FolderHandleInfo | null | Promise<FolderHandleInfo | null>>()
    .mockReturnValueOnce({ handle: "parent", name: "합성 저장 폴더" })
    .mockReturnValueOnce(pendingChoice);
  const { first, folder, host, deck, view } = await dropHarness(pickFolder);
  vi.mocked(runBatch).mockImplementation(async (_deck, selected) => ({
    folder,
    results: selected.map((file) => ({ file, status: "compressed", outputSize: 2, folder })),
  }));
  try {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다음 저장 폴더 선택" }));
      await host.flush();
    });
    expect(screen.getByText("합성 저장 폴더")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다음 저장 폴더 선택" }));
      await host.flush();
    });
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(pickFolder).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByText(/^합성 첫문서\.pdf ·/)).toHaveLength(0);
    await act(async () => {
      cancelChoice?.(null);
      await host.flush();
    });
    expect(screen.getByText("합성 저장 폴더")).toBeTruthy();
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[2]).toBe("parent");
    expect(pickFolder).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/^합성 첫문서\.pdf ·/)).toHaveLength(2);
  } finally {
    view.unmount();
    deck.dispose();
  }
});
