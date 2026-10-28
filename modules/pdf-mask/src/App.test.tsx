// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./pdf.ts", () => ({ renderPage: vi.fn(async () => new Blob(["synthetic-preview"])) }));
vi.mock("./ocr.ts", () => ({ recognizePages: vi.fn() }));
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
import { readInput, type Input } from "./batch.ts";
import { recognizePages } from "./ocr.ts";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function scannedInput(): Input {
  return {
    file: { handle: "scan", name: "synthetic-scan.pdf", ext: "pdf", size: 10, modifiedAt: 0 },
    doc: { getPage: async () => ({}), loadingTask: { destroy: vi.fn(async () => undefined) } },
    pages: [{ number: 1, width: 600, height: 800, boxes: [] }],
  } as unknown as Input;
}
async function mountScanner() {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL() {
        return "blob:synthetic-preview";
      }
      static override revokeObjectURL() {
        /* synthetic resource */
      }
    },
  );
  const host = createMockHost({
    module: { id: "pdf-mask", version: "0.2.0" },
    granted: ["fs"],
    handlers: { "fs.pickFiles": () => [scannedInput().file] },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return () => {
    view.unmount();
    deck.dispose();
  };
}
it("automatically scans image pages and keeps low confidence visible after search refresh", async () => {
  const input = scannedInput();
  const firstPage = input.pages[0];
  if (!firstPage) throw new Error("Synthetic page missing");
  vi.mocked(readInput).mockResolvedValueOnce(input);
  vi.mocked(recognizePages).mockResolvedValueOnce({
    input: {
      ...input,
      pages: [
        {
          ...firstPage,
          ocr: "read",
          ocrConfidence: 40,
          boxes: [{ text: "010-0000-0000", x: 20, y: 30, width: 150, height: 20 }],
        },
      ],
    },
    summary: { read: 1, empty: 0, uncertain: 1 },
  });
  const close = await mountScanner();
  try {
    fireEvent.click(screen.getByRole("button", { name: "파일 선택" }));
    await screen.findByRole("checkbox", { name: "전화번호 · 010-0000-0000" });
    expect(screen.getByText("이 페이지의 글자 인식이 불확실해요")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "전화번호 · 010-0000-0000" }));
    fireEvent.click(screen.getByRole("button", { name: "자동 후보 다시 찾기" }));
    expect((screen.getByRole("checkbox", { name: "전화번호 · 010-0000-0000" }) as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByText("이 페이지의 글자 인식이 불확실해요")).toBeTruthy();
  } finally {
    close();
  }
});
it("does not replace the previous PDF when an automatic scan is cancelled", async () => {
  const close = await mountScanner();
  try {
    fireEvent.click(screen.getByRole("button", { name: "파일 선택" }));
    await screen.findByText(/1쪽에서 개인정보 후보 0건/);
    const input = scannedInput();
    vi.mocked(readInput).mockResolvedValueOnce(input);
    vi.mocked(recognizePages).mockImplementationOnce(
      async (_input, _numbers, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true });
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "파일 선택" }));
    await screen.findByText("사진으로 된 1쪽의 글자를 PC에서 읽고 있어요.");
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await screen.findByText("읽기를 취소했어요. 이전 문서는 유지해요.");
    expect(input.doc.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByText(/사진으로 된 1쪽의 글자/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "명단·검색어" }));
    fireEvent.change(screen.getByRole("textbox", { name: "제거할 검색어" }), { target: { value: "가상가" } });
    fireEvent.click(screen.getByRole("button", { name: "검색어 추가" }));
    expect(screen.getByRole("checkbox", { name: "검색어 · 가상가" })).toBeTruthy();
  } finally {
    close();
  }
});
it("connects supplied roster names to candidates and explains OCR uncertainty", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "명단·검색어" }));
    fireEvent.change(screen.getByRole("textbox", { name: "제거할 검색어" }), { target: { value: "가상가" } });
    fireEvent.click(screen.getByRole("button", { name: "검색어 추가" }));
    expect(screen.getByText("검색어 1개 · 찾은 영역 1건")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "검색어 · 가상가" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "명단·검색어도 후보에 포함" }));
    expect(screen.getByText("검색어 1개 · 찾은 영역 0건")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "검색어 · 가상가" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "명단·검색어도 후보에 포함" }));
    expect(screen.getByText("검색어 1개 · 찾은 영역 1건")).toBeTruthy();
    expect(screen.getByText(/사진 속 글자는 PC 안에서 읽으며 인식 오류가 있을 수 있어요/)).toBeTruthy();
  } finally {
    view.unmount();
    deck.dispose();
  }
});
it("keeps secondary controls collapsed until they are requested", async () => {
  const close = await mountScanner();
  try {
    fireEvent.click(screen.getByRole("button", { name: "파일 선택" }));
    await screen.findByText(/1쪽에서 개인정보 후보 0건/);

    expect(screen.queryByRole("textbox", { name: "제거할 검색어" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이 페이지 이미지 글자 읽기" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "왼쪽" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "명단·검색어" }));
    expect(screen.getByRole("textbox", { name: "제거할 검색어" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "이미지 글자 다시 읽기" }));
    expect(screen.getByRole("button", { name: "이 페이지 이미지 글자 읽기" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역" }));
    expect(screen.getByRole("spinbutton", { name: "왼쪽" })).toBeTruthy();
  } finally {
    close();
  }
});
