// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { readExtraction } from "./batch.ts";
vi.mock("./batch.ts", async (original) => ({
  ...(await original<typeof import("./batch.ts")>()),
  readExtraction: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("keeps the earlier PDF photo and manual name when new margins erase the crop", async () => {
  const createObjectURL = vi.fn(() => "blob:synthetic-photo");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = vi.fn();
    },
  );
  const file = { handle: "pdf", name: "합성.pdf", ext: "pdf", size: 1, modifiedAt: 0 };
  const host = createMockHost({
    module: { id: "photo-extract", version: "0.2.0" },
    caps: { fs: "1.4.0" },
    granted: ["fs"],
    handlers: { "fs.pickFiles": () => [file] },
  });
  const deck = await connect({ window: host.window });
  vi.mocked(readExtraction)
    .mockResolvedValueOnce({
      file,
      students: [],
      warnings: [],
      photos: [{ key: "pdf:1:0", bytes: new Uint8Array([1]), mime: "image/png", extension: "png" }],
    })
    .mockRejectedValueOnce(new Error("EMPTY_CROP"));
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
  const name = await screen.findByRole("textbox", { name: "저장할 이름" });
  fireEvent.change(name, { target: { value: "직접지정한이름" } });
  fireEvent.click(screen.getByRole("button", { name: /이름·여백 조정/ }));
  fireEvent.click(screen.getByRole("button", { name: "PDF 여백 다시 적용" }));
  await screen.findByText(/PDF 여백이 너무 커/);
  expect((screen.getByRole("textbox", { name: "저장할 이름" }) as HTMLInputElement).value).toBe("직접지정한이름");
  expect(screen.getByText("예정 파일명: 직접지정한이름.png")).toBeTruthy();
  expect(screen.getByRole("button", { name: "사진 저장" }).hasAttribute("disabled")).toBe(false);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  deck.dispose();
});
