// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
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
  render(
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
  deck.dispose();
});
