// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
import { App } from "./App.tsx";
import * as io from "./io.ts";
const files = [1, 2].map((i) => ({
  handle: `source-${i}`,
  name: `합성자료${i}.txt`,
  ext: "txt",
  size: 10,
  modifiedAt: 0,
}));
async function setup(overrides: Record<string, MockHandler> = {}) {
  const host = createMockHost({
    module: { id: "file-rename", version: "0.1.0" },
    granted: ["fs", "file-ops", "storage"],
    handlers: {
      "fs.pickFiles": () => files,
      "file-ops.listHistory": () => ({ entries: [] }),
      "storage.get": () => null,
      ...overrides,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() => expect(host.requests.some((r) => r.method === "listHistory")).toBe(true));
  return { deck, host, view };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("rename screen workflows", () => {
  it("preserves partial results on plan expiry and requires a fresh preview for the remaining files", async () => {
    const partial = {
      historyHandle: "history",
      success: 1,
      failed: 0,
      notStarted: 1,
      done: false,
      items: [
        { sourceHandle: "source-1", status: "success" as const },
        { sourceHandle: "source-2", status: "notStarted" as const },
      ],
    };
    vi.spyOn(io, "renameBatch").mockImplementation(async (_deck, _plan, _signal, progress) => {
      progress(partial);
      throw new io.RenamePlanExpired(partial);
    });
    const { deck, view } = await setup({
      "file-ops.planRename": () => ({
        planHandle: "plan",
        expiresAt: Date.now() + 300000,
        items: files.map((file) => ({ sourceHandle: file.handle, finalName: `new-${file.name}`, status: "ready" })),
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("합성자료1.txt");
    await choose("실행 방식", "원본 이름 변경");
    fireEvent.click(screen.getByRole("button", { name: "원본 폴더 충돌 확인" }));
    await screen.findByText("원본 폴더 충돌을 확인했어요. 실행 직전에 다시 검사해요.");
    fireEvent.click(screen.getByRole("button", { name: "원본 이름 변경" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByText("호스트 확인 후 변경"));
    await screen.findByText(/이름 변경 계획이 만료됐어요/);
    expect((screen.getByRole("button", { name: "남은 변경 계속" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "실패·미처리 새 미리보기" }));
    expect(screen.queryByText("합성자료1.txt")).toBeNull();
    expect(screen.getByText("합성자료2.txt")).toBeTruthy();
    view.unmount();
    deck.dispose();
  });
  it("keeps manual names when switching modes, sorts before assigning serials and shows exact Excel failures", async () => {
    const { deck, view } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("합성자료1.txt");
    const names = screen.getAllByRole("textbox", { name: "최종 파일명 (확장자 포함)" });
    expect((names[0] as HTMLInputElement).value).toBe("001_합성자료1.txt");
    fireEvent.change(names[0] as HTMLElement, { target: { value: "직접확인.txt" } });
    await choose("이름 만드는 방식", "엑셀 연결");
    expect((screen.getAllByRole("textbox", { name: "최종 파일명 (확장자 포함)" })[0] as HTMLInputElement).value).toBe(
      "직접확인.txt",
    );
    expect((screen.getByRole("button", { name: "새 폴더에 복사" }) as HTMLButtonElement).disabled).toBe(true);
    await choose("이름 만드는 방식", "문서 정보");
    expect((screen.getAllByRole("textbox", { name: "최종 파일명 (확장자 포함)" })[0] as HTMLInputElement).value).toBe(
      "직접확인.txt",
    );
    view.unmount();
    deck.dispose();
  });
  it("defaults to copy and keeps successful results when retry is cancelled at folder selection", async () => {
    const done = {
      source: "source-1",
      name: "001_합성자료1.txt",
      status: "success" as const,
      saved: { handle: "saved", name: "합성자료1.txt", ext: "txt", size: 10, modifiedAt: 0 },
      folder: { handle: "first-folder", name: "첫 결과" },
    };
    const failed = { source: "source-2", name: "002_합성자료2.txt", status: "failed" as const };
    const copy = vi
      .spyOn(io, "copyBatch")
      .mockImplementation(async (_deck, _rows, _signal, progress, previous = []) => {
        const results = previous.length ? previous : [done, failed];
        progress(results);
        return { results };
      });
    const { deck, view } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("합성자료1.txt");
    fireEvent.click(screen.getByRole("button", { name: "새 폴더에 복사" }));
    await screen.findByRole("button", { name: "실패·미처리 다시 시도" });
    fireEvent.click(screen.getByRole("button", { name: "실패·미처리 다시 시도" }));
    await waitFor(() => expect(copy).toHaveBeenCalledTimes(2));
    expect(copy.mock.calls[1]?.[4]).toEqual([done, failed]);
    expect((screen.getByRole("textbox", { name: "복사 결과" }) as HTMLTextAreaElement).value).toContain(
      "001_합성자료1.txt · 완료",
    );
    expect(screen.getByRole("button", { name: "결과 폴더 1 열기" })).toBeTruthy();
    view.unmount();
    deck.dispose();
  });
  it("checks host collisions, requires summary confirmation, and retries only failed original changes", async () => {
    const { deck, host, view } = await setup({
      "file-ops.planRename": () => ({
        planHandle: "plan",
        expiresAt: Date.now() + 300000,
        items: files.map((f) => ({ sourceHandle: f.handle, finalName: `new-${f.name}`, status: "ready" })),
      }),
      "file-ops.executeRename": () => ({
        historyHandle: "history",
        success: 1,
        failed: 1,
        notStarted: 0,
        done: true,
        items: [
          { sourceHandle: "source-1", status: "success" },
          { sourceHandle: "source-2", status: "changed" },
        ],
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("합성자료1.txt");
    await choose("실행 방식", "원본 이름 변경");
    expect((screen.getByRole("button", { name: "원본 이름 변경" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "원본 폴더 충돌 확인" }));
    await screen.findByText("원본 폴더 충돌을 확인했어요. 실행 직전에 다시 검사해요.");
    fireEvent.click(screen.getByRole("button", { name: "원본 이름 변경" }));
    const dialog = await screen.findByRole("dialog");
    expect(host.requests.some((r) => r.method === "executeRename")).toBe(false);
    fireEvent.click(within(dialog).getByText("호스트 확인 후 변경"));
    await screen.findByRole("button", { name: "실패·미처리 새 미리보기" });
    fireEvent.click(screen.getByRole("button", { name: "실패·미처리 새 미리보기" }));
    expect(screen.queryByText("합성자료1.txt")).toBeNull();
    expect(screen.getByText("합성자료2.txt")).toBeTruthy();
    view.unmount();
    deck.dispose();
  });
});

async function choose(header: string, label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: header }));
  fireEvent.click(await screen.findByRole("option", { name: label, hidden: true }));
}
