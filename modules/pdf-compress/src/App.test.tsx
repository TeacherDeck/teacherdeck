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
import { DEFAULT_OPTIONS, type Options } from "./logic.ts";
vi.mock("./batch.ts", async (original) => ({ ...(await original<typeof import("./batch.ts")>()), runBatch: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settingsHarness(
  getOptions: () => unknown,
  pickFolder = vi.fn<() => FolderHandleInfo | null | Promise<FolderHandleInfo | null>>(() => ({
    handle: "parent",
    name: "합성 저장 폴더",
  })),
) {
  const file = { handle: "synthetic", name: "합성 문서.pdf", ext: "pdf", size: 100, modifiedAt: 0 };
  const saveOptions = vi.fn(() => null);
  const host = createMockHost({
    module: { id: "pdf-compress", version: "0.1.0" },
    caps: { fs: "1.1.0", storage: "1.0.0" },
    granted: ["fs", "storage"],
    handlers: {
      "storage.get": getOptions,
      "storage.set": saveOptions,
      "fs.pickFiles": () => [file],
      "fs.pickFolder": pickFolder,
    },
  });
  const deck = await connect({ window: host.window });
  vi.mocked(runBatch).mockResolvedValue({ folder: null, results: [] });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return { file, host, deck, view, pickFolder, saveOptions };
}

it("keeps a user's quality choice when stored options arrive after an early drop", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view, pickFolder } = await settingsHarness(() => stored.promise);
  try {
    fireEvent.click(screen.getByText("압축 방식·화질"));
    const quality = screen.getByRole("spinbutton", { name: "사진 품질 (%)" });
    await act(async () => {
      fireEvent.change(quality, { target: { value: "100" } });
      fireEvent.blur(quality);
      host.emit("fs.dropped", { files: [file] });
      await host.flush();
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(pickFolder).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^합성 문서\.pdf ·/)).toHaveLength(1);
    await act(async () => {
      stored.resolve({ mode: "preserve", dpi: 120, quality: 30 });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(screen.getByRole("spinbutton", { name: "사진 품질 (%)" }).getAttribute("value")).toBe("100");
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([file]);
    expect(vi.mocked(runBatch).mock.calls[0]?.[3].quality).toBe(100);
    expect(pickFolder).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("waits for saved settings before automatically processing an early file selection", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view, pickFolder, saveOptions } = await settingsHarness(() => stored.promise);
  try {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^PDF 추가$/ }));
      await host.flush();
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(pickFolder).not.toHaveBeenCalled();
    expect(saveOptions).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^합성 문서\.pdf ·/)).toHaveLength(1);
    await act(async () => {
      stored.resolve({ mode: "raster", dpi: 90, quality: 30 });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([file]);
    expect(vi.mocked(runBatch).mock.calls[0]?.[3]).toEqual({ mode: "preserve", dpi: 90, quality: 30 });
    expect(saveOptions).toHaveBeenCalledWith({
      key: "pdf-compression",
      value: { mode: "preserve", dpi: 90, quality: 30 },
    });
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("waits for initialization when pending files are compressed manually", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view } = await settingsHarness(() => stored.promise);
  try {
    fireEvent.click(screen.getByRole("checkbox", { name: "파일을 추가하면 바로 압축" }));
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
    });
    fireEvent.click(screen.getByRole("button", { name: "미처리 파일 압축" }));
    expect(runBatch).not.toHaveBeenCalled();
    await act(async () => {
      stored.resolve({ mode: "preserve", dpi: 200, quality: 45 });
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[3]).toEqual({ mode: "preserve", dpi: 200, quality: 45 });
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("processes an early drop with defaults when loading settings fails", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view } = await settingsHarness(() => stored.promise);
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
      await host.flush();
    });
    expect(runBatch).not.toHaveBeenCalled();
    await act(async () => {
      stored.reject(new Error("SYNTHETIC_STORAGE_FAILURE"));
      await host.flush();
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([file]);
    expect(vi.mocked(runBatch).mock.calls[0]?.[3]).toEqual(DEFAULT_OPTIONS);
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("does not choose a folder or process queued files after unmounting during settings restoration", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view, pickFolder, saveOptions } = await settingsHarness(() => stored.promise);
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
      await host.flush();
    });
    view.unmount();
    await act(async () => {
      stored.resolve({ mode: "preserve", dpi: 120, quality: 30 });
      await host.flush();
      host.emit("fs.dropped", { files: [file] });
    });
    expect(pickFolder).not.toHaveBeenCalled();
    expect(saveOptions).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
  } finally {
    deck.dispose();
  }
});

it("falls back after the SDK timeout instead of leaving an early drop waiting forever", async () => {
  vi.useFakeTimers();
  const stored = deferred<Options>();
  const { file, host, deck, view, pickFolder } = await settingsHarness(() => stored.promise);
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(runBatch).not.toHaveBeenCalled();
    expect(pickFolder).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(runBatch).toHaveBeenCalledOnce();
    expect(vi.mocked(runBatch).mock.calls[0]?.[3]).toEqual(DEFAULT_OPTIONS);
    expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true);
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("cancels a run waiting for settings immediately and retains the file for a manual retry", async () => {
  const stored = deferred<Options>();
  const { file, host, deck, view, pickFolder } = await settingsHarness(() => stored.promise);
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
      await host.flush();
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true));
    expect(screen.getAllByText(/^합성 문서\.pdf ·/)).toHaveLength(1);
    expect(pickFolder).not.toHaveBeenCalled();
    await act(async () => {
      stored.resolve({ mode: "preserve", dpi: 120, quality: 30 });
      await host.flush();
    });
    expect(runBatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "미처리 파일 압축" }));
    await waitFor(() => expect(runBatch).toHaveBeenCalledOnce());
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([file]);
    expect(vi.mocked(runBatch).mock.calls[0]?.[3].quality).toBe(30);
  } finally {
    view.unmount();
    deck.dispose();
  }
});

it("does not start compression if the folder dialog resolves after unmounting", async () => {
  const destination = deferred<FolderHandleInfo>();
  const pickFolder = vi.fn(() => destination.promise);
  const { file, host, deck, view, saveOptions } = await settingsHarness(() => null, pickFolder);
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [file] });
      await host.flush();
    });
    expect(pickFolder).toHaveBeenCalledOnce();
    view.unmount();
    await act(async () => {
      destination.resolve({ handle: "parent", name: "합성 저장 폴더" });
      await host.flush();
    });
    expect(saveOptions).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
  } finally {
    deck.dispose();
  }
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
