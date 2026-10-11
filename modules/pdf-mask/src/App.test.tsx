// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./pdf.ts", () => ({ renderPage: vi.fn(async () => new Blob(["synthetic-preview"])) }));
vi.mock("./batch.ts", () => ({
  readInput: vi.fn(async (_deck, file) => ({
    file,
    doc: { getPage: async () => ({}), loadingTask: { destroy: async () => undefined } },
    pages: [{ number: 1, width: 600, height: 800, boxes: [{ text: "가상가", x: 20, y: 30, width: 40, height: 20 }] }],
  })),
  readFile: vi.fn(),
  redact: vi.fn(),
  saveResult: vi.fn(),
}));
import { App } from "./App.tsx";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("connects supplied roster names to candidates and exposes their inclusion without claiming OCR", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL() {
        return "blob:synthetic-preview";
      }
      static override revokeObjectURL() {
        /* Synthetic URL owns no resource. */
      }
    },
  );
  const host = createMockHost({
    module: { id: "pdf-mask", version: "0.1.3" },
    granted: ["fs"],
    handlers: {
      "fs.pickFiles": () => [{ handle: "synthetic", name: "synthetic.pdf", ext: "pdf", size: 10, modifiedAt: 0 }],
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "파일 선택" }));
    await screen.findByText(/1쪽에서 개인정보 후보 0건/);
    fireEvent.change(screen.getByRole("textbox", { name: "제거할 검색어" }), { target: { value: "가상가" } });
    fireEvent.click(screen.getByRole("button", { name: "검색어 추가" }));
    expect(screen.getByText("명단·검색어 1개 · 찾은 영역 1건")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "검색어 · 가상가" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "명단·검색어도 후보에 포함" }));
    expect(screen.getByText("명단·검색어 1개 · 찾은 영역 0건")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "검색어 · 가상가" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "명단·검색어도 후보에 포함" }));
    expect(screen.getByText("명단·검색어 1개 · 찾은 영역 1건")).toBeTruthy();
    expect(screen.getByText(/스캔 이미지의 글자는 자동으로 읽지 못해요/)).toBeTruthy();
  } finally {
    view.unmount();
    deck.dispose();
  }
});
