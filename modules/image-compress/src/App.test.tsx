// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { runBatch } from "./batch.ts";
vi.mock("./batch.ts", async (original) => ({ ...(await original<typeof import("./batch.ts")>()), runBatch: vi.fn() }));
const first = { handle: "first", name: "합성 첫사진.png", ext: "png", size: 4, modifiedAt: 0 };
const second = { ...first, handle: "second", name: "합성 다음사진.png" };
const third = { ...first, handle: "third", name: "합성 추가사진.png" };
const folder = { handle: "output", name: "합성 결과" };
async function setup() {
  const selection = { files: [first] };
  const host = createMockHost({
    module: { id: "image-compress", version: "0.1.2" },
    caps: { fs: "1.1.0", storage: "1.0.0" },
    granted: ["fs", "storage"],
    handlers: {
      "storage.get": () => null,
      "storage.set": () => null,
      "fs.pickFiles": () => selection.files,
      "fs.pickFolder": () => ({ handle: "parent", name: "합성 저장 폴더" }),
      "fs.reveal": () => null,
    },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return { deck, host, selection };
}
const pick = () => fireEvent.click(screen.getByRole("button", { name: /파일 선택/ }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("compression additions and recovery", () => {
  it("runs picker and drop additions through the same automatic compression path", async () => {
    vi.mocked(runBatch).mockImplementation(async (_deck, selected) => ({
      folder,
      results: selected.map((file) => ({ file, status: "compressed" as const, outputSize: 2, folder })),
    }));
    const { deck, host } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "저장 폴더 선택" }));
    await screen.findByText("합성 저장 폴더");
    fireEvent.click(screen.getByRole("checkbox", { name: "파일 추가 시 바로 압축" }));
    pick();
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(1));
    await screen.findByText(/대기 0개/);
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([first]);
    await act(async () => {
      host.emit("fs.dropped", { files: [second] });
    });
    await waitFor(() => expect(runBatch).toHaveBeenCalledTimes(2));
    await screen.findByText(/2개 · .*대기 0개/);
    expect(vi.mocked(runBatch).mock.calls[1]?.[1]).toEqual([second]);
    expect(screen.getByText(/합성 첫사진.png · 압축 ·/)).toBeTruthy();
    expect(screen.getByText(/합성 다음사진.png · 압축 ·/)).toBeTruthy();
    deck.dispose();
  });
  it("keeps results, their output folder, and failures when a picker is cancelled or another input is added", async () => {
    vi.mocked(runBatch).mockResolvedValueOnce({
      folder,
      results: [
        { file: first, status: "compressed", outputSize: 2, folder },
        { file: second, status: "failed", folder },
      ],
    });
    const { deck, selection } = await setup();
    selection.files = [first, second];
    pick();
    await screen.findByText(/2개 ·/);
    fireEvent.click(screen.getByRole("button", { name: "압축하여 저장" }));
    await screen.findByText(/합성 다음사진.png · 처리하지 못했어요/);
    const retry = screen.getByRole("button", { name: "실패한 파일 재시도" });
    expect(retry.hasAttribute("disabled")).toBe(false);
    selection.files = [];
    pick();
    await waitFor(() => expect(screen.getByText(/합성 다음사진.png · 처리하지 못했어요/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "결과 폴더 열기" })).toBeTruthy();
    selection.files = [third];
    pick();
    await screen.findByText(/3개 · .*대기 1개/);
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/합성 첫사진.png · 압축 ·/)).toBeTruthy();
    vi.mocked(runBatch).mockResolvedValueOnce({
      folder: { handle: "retry-output", name: "합성 재시도 결과" },
      results: [
        {
          file: second,
          status: "compressed",
          outputSize: 2,
          folder: { handle: "retry-output", name: "합성 재시도 결과" },
        },
      ],
    });
    fireEvent.click(retry);
    await screen.findByText(/합성 다음사진.png · 압축 ·/);
    expect(vi.mocked(runBatch).mock.calls[1]?.[1]).toEqual([second]);
    expect(screen.getByText(/합성 첫사진.png · 압축 ·/)).toBeTruthy();
    expect(screen.getByText(/3개 · .*대기 1개/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "저장 위치 열기" })).toHaveLength(2);
    expect(retry.hasAttribute("disabled")).toBe(true);
    deck.dispose();
  });
  it("keeps cancelled unprocessed files queued and resumes without reprocessing saved files", async () => {
    vi.mocked(runBatch)
      .mockImplementationOnce(async (_deck, _files, _parent, _options, signal) => {
        const abortSignal = signal as AbortSignal;
        await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(false));
        fireEvent.click(screen.getByRole("button", { name: "취소" }));
        expect(abortSignal.aborted).toBe(true);
        return { folder, results: [{ file: first, status: "compressed", outputSize: 2, folder }] };
      })
      .mockResolvedValueOnce({ folder, results: [{ file: second, status: "compressed", outputSize: 2, folder }] });
    const { deck, selection } = await setup();
    selection.files = [first, second];
    pick();
    await screen.findByText(/2개 ·/);
    fireEvent.click(screen.getByRole("button", { name: "압축하여 저장" }));
    await screen.findByText(/2개 · .*대기 1개/);
    fireEvent.click(screen.getByRole("button", { name: "압축하여 저장" }));
    await screen.findByText(/2개 · .*대기 0개/);
    expect(vi.mocked(runBatch).mock.calls[1]?.[1]).toEqual([second]);
    expect(screen.getByText(/합성 첫사진.png · 압축 ·/)).toBeTruthy();
    deck.dispose();
  });
});

describe("compression progress units", () => {
  it("shows one of three completed files as one third of the progress bar", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(runBatch).mockImplementation(async (_deck, _files, _parent, _options, _signal, _encoder, progress) => {
      const completed = [{ file: first, status: "compressed" as const, outputSize: 2, folder }];
      progress(completed);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { folder, results: completed };
    });
    const { deck, selection } = await setup();
    selection.files = [first, second, third];
    pick();
    await screen.findByText(/3개 ·/);
    fireEvent.click(screen.getByRole("button", { name: "압축하여 저장" }));
    const bar = await screen.findByRole("progressbar", { name: "압축 진행" });
    await waitFor(() => expect(Number(bar.getAttribute("aria-valuenow"))).toBeCloseTo(1 / 3));
    expect(screen.getByText("1 / 3개 처리했어요.")).toBeTruthy();
    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true));
    deck.dispose();
  });
});

describe("atomic compression input deduplication", () => {
  it("accepts a repeated drop in one React batch once and writes the original once", async () => {
    vi.mocked(runBatch).mockImplementation(async (_deck, selected) => ({
      folder,
      results: selected.map((file) => ({ file, status: "compressed" as const, outputSize: 2, folder })),
    }));
    const { deck, host } = await setup();
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
      host.emit("fs.dropped", { files: [first] });
    });
    await screen.findByText(/1개 · .*대기 1개/);
    expect(screen.getAllByText(/합성 첫사진.png · .*압축 대기/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "압축하여 저장" }));
    await screen.findByText(/1개 · .*대기 0개/);
    expect(vi.mocked(runBatch).mock.calls[0]?.[1]).toEqual([first]);
    deck.dispose();
  });
});
