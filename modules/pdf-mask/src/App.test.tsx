// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { readInput, redact, saveResult, type Input } from "./batch.ts";
import { recognizePages } from "./ocr.ts";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const documentHandlers = {
  "window.registerDocument": () => ({ documentHandle: "document" }),
  "window.setDocumentState": () => null,
  "window.completeDocumentSave": () => null,
};
async function replacementDialog() {
  const dialog = await screen.findByRole("dialog", { hidden: true });
  // jsdom has no layout for Tabster's visibility check; use the same explicit focus as shell dialog tests.
  await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
  const action = dialog.querySelector("button");
  if (!action) throw new Error("SYNTHETIC_DIALOG_ACTION_MISSING");
  action.focus();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "취소" })).toBeTruthy());
  return dialog;
}

async function protectedDocument(state: () => null | Promise<null> = documentHandlers["window.setDocumentState"]) {
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
    granted: ["fs", "window"],
    handlers: { ...documentHandlers, "window.setDocumentState": state },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  const input = scannedInput();
  const page = input.pages[0];
  if (!page) throw new Error("SYNTHETIC_PAGE_MISSING");
  page.boxes = [{ text: "합성 문서", x: 20, y: 30, width: 40, height: 20 }];
  vi.mocked(readInput).mockResolvedValueOnce(input);
  await act(async () => {
    host.emit("fs.dropped", { files: [input.file] });
    await host.flush();
  });
  return { host, deck, view, input };
}

it("does not install a PDF workspace before its dirty acknowledgement", async () => {
  let release!: () => void;
  const pending = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  const { host, deck, view } = await protectedDocument(() => pending);
  expect(screen.queryByText("synthetic-scan.pdf · 1쪽")).toBeNull();
  expect(host.requests.find((r) => r.method === "setDocumentState")?.args).toMatchObject({ dirty: true });
  await act(async () => {
    release();
    await host.flush();
  });
  expect(await screen.findByText("synthetic-scan.pdf · 1쪽")).toBeTruthy();
  view.unmount();
  deck.dispose();
});

it("keeps failed saves protected and completes a reviewed retry before accepting new edits", async () => {
  const { host, deck, view } = await protectedDocument();
  await screen.findByText("synthetic-scan.pdf · 1쪽");
  fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
  const acknowledgement = screen.getByRole("checkbox", { name: "제거 영역과 이미지 PDF로 바뀌는 것을 확인했어요" });
  fireEvent.click(acknowledgement);
  vi.mocked(redact).mockResolvedValue(new Blob(["synthetic"]));
  vi.mocked(saveResult).mockRejectedValueOnce(new Error("SYNTHETIC_SAVE_FAILURE"));
  await act(async () => {
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "failed" });
    await host.flush();
  });
  await waitFor(() =>
    expect(host.requests.find((r) => r.method === "completeDocumentSave")?.args).toMatchObject({ saved: false }),
  );
  expect(host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toMatchObject({
    dirty: true,
    saving: false,
  });
  expect(screen.getByRole("checkbox", { name: "검색어 · 직접 지정 영역" })).toBeTruthy();
  vi.mocked(saveResult).mockResolvedValueOnce({
    folder: { handle: "out", name: "합성 폴더" },
    saved: { handle: "result", name: "synthetic-redacted.pdf", ext: "pdf", size: 10, modifiedAt: 0 },
  });
  await act(async () => {
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "retry" });
    await host.flush();
  });
  await waitFor(() =>
    expect(host.requests.filter((r) => r.method === "completeDocumentSave").at(-1)?.args).toMatchObject({
      saved: true,
    }),
  );
  expect(host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toMatchObject({
    dirty: false,
    saving: false,
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
    await host.flush();
  });
  expect(host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toMatchObject({ dirty: true });
  expect((acknowledgement as HTMLInputElement).checked).toBe(false);
  view.unmount();
  deck.dispose();
});

it("preserves reviewed regions when replacing or clearing a document is cancelled", async () => {
  const { host, deck, view, input } = await protectedDocument();
  await screen.findByText("synthetic-scan.pdf · 1쪽");
  fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
  await act(async () => {
    host.emit("fs.dropped", { files: [{ ...input.file, handle: "other", name: "synthetic-other.pdf" }] });
    await host.flush();
  });
  const dialog = await replacementDialog();
  const cancelReplacement = within(dialog).getByRole("button", { name: "취소" });
  await act(async () => {
    fireEvent.click(cancelReplacement);
    await host.flush();
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("checkbox", { name: "검색어 · 직접 지정 영역" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "문서 비우기" }));
  const discard = within(await replacementDialog()).getByRole("button", { name: "영역 버리고 계속" });
  await act(async () => {
    fireEvent.click(discard);
    await host.flush();
  });
  await waitFor(() => expect(screen.queryByText("synthetic-scan.pdf · 1쪽")).toBeNull());
  expect(host.requests.filter((r) => r.method === "setDocumentState").at(-1)?.args).toMatchObject({
    dirty: false,
    saving: false,
  });
  view.unmount();
  deck.dispose();
});

async function saveReviewedWorkspace(host: ReturnType<typeof createMockHost>) {
  await screen.findByText("synthetic-scan.pdf · 1쪽");
  fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "제거 영역과 이미지 PDF로 바뀌는 것을 확인했어요" }));
  vi.mocked(redact)
    .mockClear()
    .mockResolvedValue(new Blob(["synthetic"]));
  vi.mocked(saveResult)
    .mockClear()
    .mockResolvedValue({
      folder: { handle: "out", name: "합성 폴더" },
      saved: { handle: "result", name: "synthetic-redacted.pdf", ext: "pdf", size: 10, modifiedAt: 0 },
    });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "정보 제거하여 저장" }));
    await host.flush();
  });
  await waitFor(() =>
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: false,
      saving: false,
    }),
  );
  expect(redact).toHaveBeenCalledOnce();
}

it("waits for an acknowledged edit before deciding whether a dropped PDF needs replacement confirmation", async () => {
  let delay = false;
  let release!: () => void;
  const pending = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  const { host, deck, view, input } = await protectedDocument(() => (delay ? pending : null));
  await saveReviewedWorkspace(host);
  const reads = vi.mocked(readInput).mock.calls.length;
  delay = true;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
    await host.flush();
    host.emit("fs.dropped", { files: [{ ...input.file, handle: "other", name: "synthetic-other.pdf" }] });
    await host.flush();
  });
  expect(screen.getAllByRole("checkbox", { name: "검색어 · 직접 지정 영역" })).toHaveLength(1);
  expect(readInput).toHaveBeenCalledTimes(reads);
  expect(input.doc.loadingTask.destroy).not.toHaveBeenCalled();
  await act(async () => {
    release();
    await host.flush();
  });
  const dialog = await replacementDialog();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await host.flush();
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getAllByRole("checkbox", { name: "검색어 · 직접 지정 영역" })).toHaveLength(2);
  expect(screen.getByText("synthetic-scan.pdf · 1쪽")).toBeTruthy();
  expect(readInput).toHaveBeenCalledTimes(reads);
  expect(input.doc.loadingTask.destroy).not.toHaveBeenCalled();
  view.unmount();
  deck.dispose();
});

it("rejects an immediate host save after a queued edit until its new regions are reviewed", async () => {
  let delay = false;
  let release!: () => void;
  const pending = new Promise<null>((resolve) => {
    release = () => resolve(null);
  });
  const { host, deck, view } = await protectedDocument(() => (delay ? pending : null));
  await saveReviewedWorkspace(host);
  delay = true;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "직접 지정 영역 추가" }));
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "queued-edit" });
    await host.flush();
  });
  expect(redact).toHaveBeenCalledOnce();
  await act(async () => {
    release();
    await host.flush();
  });
  await waitFor(() =>
    expect(host.requests.filter((request) => request.method === "completeDocumentSave").at(-1)?.args).toMatchObject({
      requestId: "queued-edit",
      saved: false,
    }),
  );
  expect(redact).toHaveBeenCalledOnce();
  expect(saveResult).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("checkbox", { name: "검색어 · 직접 지정 영역" })).toHaveLength(2);
  const acknowledgement = screen.getByRole("checkbox", { name: "제거 영역과 이미지 PDF로 바뀌는 것을 확인했어요" });
  expect((acknowledgement as HTMLInputElement).checked).toBe(false);
  expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
    dirty: true,
    saving: false,
  });
  await act(async () => {
    fireEvent.click(acknowledgement);
    host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "reviewed-edit" });
    await host.flush();
  });
  await waitFor(() =>
    expect(host.requests.filter((request) => request.method === "completeDocumentSave").at(-1)?.args).toMatchObject({
      requestId: "reviewed-edit",
      saved: true,
    }),
  );
  expect(redact).toHaveBeenCalledTimes(2);
  expect(vi.mocked(redact).mock.calls.at(-1)?.[1]).toHaveLength(2);
  view.unmount();
  deck.dispose();
});

function scannedInput(): Input {
  return {
    file: { handle: "scan", name: "synthetic-scan.pdf", ext: "pdf", size: 10, modifiedAt: 0 },
    doc: { getPage: async () => ({}), loadingTask: { destroy: vi.fn(async () => undefined) } },
    pages: [{ number: 1, width: 600, height: 800, boxes: [] }],
  } as unknown as Input;
}
it("shows a dropped filename immediately without a picker and reports busy, duplicate and unsupported drops", async () => {
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL() {
        return "blob:synthetic-preview";
      }
      static override revokeObjectURL() {
        /* Synthetic preview. */
      }
    },
  );
  const input = scannedInput();
  const firstPage = input.pages[0];
  if (!firstPage) throw new Error("Synthetic page missing");
  firstPage.boxes = [{ text: "합성 문서", x: 20, y: 30, width: 40, height: 20 }];
  let complete!: (input: Input) => void;
  vi.mocked(readInput).mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const pick = vi.fn(() => [input.file]);
  const host = createMockHost({ granted: ["fs", "window"], handlers: { ...documentHandlers, "fs.pickFiles": pick } });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  try {
    await act(async () => {
      host.emit("fs.dropped", { files: [input.file] });
      await host.flush();
    });
    expect(screen.getByText("synthetic-scan.pdf · 읽는 중")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("PDF를 입력했어요");
    expect(pick).not.toHaveBeenCalled();
    await act(async () => {
      host.emit("fs.dropped", { files: [input.file] });
      await host.flush();
    });
    expect(screen.getByRole("status").textContent).toContain("현재 문서를 처리하고 있어요");
    await act(async () => {
      complete(input);
      await host.flush();
    });
    await screen.findByText("synthetic-scan.pdf · 1쪽");
    await act(async () => {
      host.emit("fs.dropped", { files: [input.file] });
      await host.flush();
    });
    expect(screen.getByRole("status").textContent).toContain("이미 입력한 PDF예요");
    await act(async () => {
      host.emit("fs.dropped", { files: [{ ...input.file, handle: "unsupported", ext: "zip" }] });
      await host.flush();
    });
    expect(screen.getByRole("status").textContent).toContain("PDF 또는 검색어 목록");
    expect(pick).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    deck.dispose();
  }
});
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
    granted: ["fs", "window"],
    handlers: { ...documentHandlers, "fs.pickFiles": () => [scannedInput().file] },
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
    fireEvent.click(within(await replacementDialog()).getByRole("button", { name: "영역 버리고 계속" }));
    await screen.findByText("사진으로 된 1쪽의 글자를 PC에서 읽고 있어요.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await screen.findByText("읽기를 취소했어요. 이전 문서는 유지해요.");
    expect(input.doc.loadingTask.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByText(/사진으로 된 1쪽의 글자/)).toBeNull();
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
    granted: ["fs", "window"],
    handlers: {
      ...documentHandlers,
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
    expect(screen.getByText(/사진 속 글자는 PC 안에서 읽으며 인식 오류가 있을 수 있어요/)).toBeTruthy();
  } finally {
    view.unmount();
    deck.dispose();
  }
});
