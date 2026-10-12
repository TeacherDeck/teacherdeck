// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, fireEvent, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { readImage, renderCrop, saveCrops } from "./batch.ts";
import { orientedSize } from "./edit.ts";
vi.mock("./batch.ts", async (original) => ({
  ...(await original<typeof import("./batch.ts")>()),
  readImage: vi.fn(),
  renderCrop: vi.fn(),
  saveCrops: vi.fn(),
}));
const files = [
  { handle: "first", name: "합성 첫사진.png", ext: "png", size: 4, modifiedAt: 0 },
  { handle: "second", name: "합성 다음사진.png", ext: "png", size: 4, modifiedAt: 0 },
];
async function setup(previewSize = 1, incoming = files, pickInitial = true) {
  const originalUrl = URL;
  vi.stubGlobal(
    "URL",
    class extends originalUrl {
      static override createObjectURL = vi.fn(() => "blob:crop-preview");
      static override revokeObjectURL = vi.fn();
    },
  );
  vi.mocked(readImage).mockImplementation(async () => new Uint8Array([1, 2, 3, 4]));
  vi.mocked(renderCrop).mockImplementation(async ({ edit }) => {
    const size = orientedSize(100, 80, edit.turns);
    const blob = new Blob([new Uint8Array([1])]);
    Object.defineProperty(blob, "size", { value: previewSize });
    return {
      blob,
      sourceWidth: 100,
      sourceHeight: 80,
      imageWidth: size.width,
      imageHeight: size.height,
    };
  });
  const host = createMockHost({
    module: { id: "image-crop", version: "0.1.0" },
    caps: { fs: "1.4.0" },
    granted: ["fs"],
    handlers: { "fs.pickFiles": () => incoming },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  if (pickInitial) {
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByRole("group", { name: "사진에서 자를 영역" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "현재 사진 저장" }).hasAttribute("disabled")).toBe(false),
    );
  }
  return { deck, host };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("image crop editing flow", () => {
  it("acknowledges dropped filenames before decoding without opening a picker", async () => {
    const { deck, host } = await setup(1, files, false);
    let finish: ((value: Uint8Array<ArrayBuffer>) => void) | undefined;
    vi.mocked(readImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = files[0];
    if (!first) throw new Error("SYNTHETIC_FILE_MISSING");
    await act(async () => {
      host.emit("fs.dropped", { files: [first] });
    });
    expect(await screen.findByText("합성 첫사진.png · 파일 입력됨")).toBeTruthy();
    expect(screen.getByText("입력한 파일 1개 · 읽는 중")).toBeTruthy();
    expect(host.requests.some((r) => ["pickFiles", "pickFolder"].includes(r.method))).toBe(false);
    await act(async () => {
      finish?.(new Uint8Array([1, 2, 3, 4]));
    });
    await screen.findByRole("group", { name: "사진에서 자를 영역" });
    deck.dispose();
  });
  it("queues an additional drop during reading and ignores a repeated in-flight handle", async () => {
    const { deck, host } = await setup();
    const third = { handle: "third", name: "합성 세번째.png", ext: "png", size: 4, modifiedAt: 0 };
    const fourth = { ...third, handle: "fourth", name: "합성 네번째.png" };
    let finish: ((value: Uint8Array<ArrayBuffer>) => void) | undefined;
    vi.mocked(readImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      host.emit("fs.dropped", { files: [third] });
    });
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => {
      host.emit("fs.dropped", { files: [third, fourth] });
    });
    await act(async () => {
      finish?.(new Uint8Array([1, 2, 3, 4]));
    });
    await screen.findByText("1/4");
    expect(readImage).toHaveBeenCalledTimes(4);
    deck.dispose();
  });
  it("passes resizing, adjustments and text to real save request and keeps photo-local undo/redo", async () => {
    vi.mocked(saveCrops).mockResolvedValue({
      folder: { handle: "output", name: "합성 결과" },
      saved: ["first"],
      failed: [],
      cancelled: false,
    });
    const { deck } = await setup();
    // These toolbar nodes remain mounted while preview work toggles their disabled state.
    const undo = screen.getByRole("button", { name: "편집 되돌리기" });
    const redo = screen.getByRole("button", { name: "편집 다시 적용" });
    const save = screen.getByRole("button", { name: "현재 사진 저장" });
    fireEvent.click(screen.getByRole("button", { name: "크기·밝기·대비" }));
    const width = screen.getByLabelText("저장 너비 (px)");
    const brightness = screen.getByLabelText("밝기 (%)") as HTMLInputElement;
    fireEvent.change(width, { target: { value: "50" } });
    fireEvent.blur(width);
    fireEvent.change(brightness, { target: { value: "120" } });
    fireEvent.blur(brightness);
    await waitFor(() => expect(undo.hasAttribute("disabled")).toBe(false));
    fireEvent.click(undo);
    expect(brightness.value).toBe("100");
    await waitFor(() => expect(redo.hasAttribute("disabled")).toBe(false));
    fireEvent.click(redo);
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "텍스트·사각형 표시" }));
    fireEvent.click(screen.getByRole("combobox", { name: "표시 종류" }));
    fireEvent.click(screen.getByRole("option", { name: "한 줄 텍스트" }));
    const annotation = screen.getByLabelText("사진에 넣을 텍스트");
    await waitFor(() => expect(annotation.hasAttribute("disabled")).toBe(false));
    fireEvent.change(annotation, { target: { value: "합성 주석" } });
    await waitFor(() => expect(save.hasAttribute("disabled")).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(saveCrops).toHaveBeenCalledOnce());
    expect(vi.mocked(saveCrops).mock.calls[0]?.[1][0]?.edit).toMatchObject({
      outputWidth: 50,
      brightness: 120,
      annotation: { kind: "text", text: "합성 주석" },
    });
    await screen.findByText("2/2");
    expect(undo.hasAttribute("disabled")).toBe(true);
    deck.dispose();
  });
  it("admits 500 images while keeping sequential editing available", async () => {
    const many = Array.from({ length: 500 }, (_, n) => ({
      ...{ handle: "synthetic", name: "합성.png", ext: "png", size: 4, modifiedAt: 0 },
      handle: `synthetic-${n}`,
      name: `합성${n}.png`,
    }));
    const { deck } = await setup(1, many);
    await screen.findByText("1/500");
    expect(readImage).toHaveBeenCalledTimes(500);
    expect(screen.getByRole("button", { name: "다음 사진" }).hasAttribute("disabled")).toBe(false);
    deck.dispose();
  });
  it("uses shared keyboard crop controls and saves the current edit before advancing to the next image", async () => {
    vi.mocked(saveCrops).mockResolvedValue({
      folder: { handle: "output", name: "합성 결과" },
      saved: ["first"],
      failed: [],
      cancelled: false,
    });
    const { deck } = await setup();
    fireEvent.keyDown(screen.getByRole("group", { name: "사진에서 자를 영역" }), { key: "ArrowLeft", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "현재 사진 저장" }));
    await waitFor(() => expect(saveCrops).toHaveBeenCalledOnce());
    const items = vi.mocked(saveCrops).mock.calls[0]?.[1];
    expect(items).toHaveLength(1);
    expect(items?.[0]?.edit.rect.width).toBe(99);
    await screen.findByText("2/2");
    deck.dispose();
  });
  it("releases oversized cached previews and regenerates each selected image", async () => {
    const { deck } = await setup(40 * 1024 * 1024);
    // Two admission renders plus a selected-image render: neither 40MiB preview is retained.
    await waitFor(() => expect(renderCrop).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "다음 사진" }));
    await waitFor(() => expect(renderCrop).toHaveBeenCalledTimes(4));
    deck.dispose();
  });
  it("applies a chosen ratio and rotation to every image while retaining sequential previews", async () => {
    vi.mocked(saveCrops).mockResolvedValue({
      folder: { handle: "output", name: "합성 결과" },
      saved: ["first", "second"],
      failed: [],
      cancelled: false,
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("combobox", { name: "자르기 비율" }));
    fireEvent.click(screen.getByRole("option", { name: "1:1 정사각형" }));
    fireEvent.click(screen.getByRole("button", { name: "오른쪽으로 90도 회전" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "현재 설정을 모두 적용" }).hasAttribute("disabled")).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "현재 설정을 모두 적용" }));
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    await waitFor(() => expect(saveCrops).toHaveBeenCalledOnce());
    const items = vi.mocked(saveCrops).mock.calls[0]?.[1];
    expect(items?.map((item) => item.edit.turns)).toEqual([1, 1]);
    expect(items?.every((item) => item.edit.rect.width === item.edit.rect.height)).toBe(true);
    deck.dispose();
  });
});

describe("crop save recovery", () => {
  it("does not assign another source's saved folder to an unopened failed source", async () => {
    vi.mocked(saveCrops).mockResolvedValueOnce({
      folder: { handle: "source-a-parent", name: "합성 A 폴더" },
      folders: { first: { handle: "source-a-parent", name: "합성 A 폴더" } },
      saved: ["first"],
      failed: ["second"],
      cancelled: false,
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    await screen.findByText(/합성 다음사진.png · 저장 실패/);
    expect(screen.getAllByRole("button", { name: "저장 위치 열기" })).toHaveLength(1);
    deck.dispose();
  });
  it("lists each failed photo and retries only unsaved photos in the same session", async () => {
    vi.mocked(saveCrops)
      .mockResolvedValueOnce({
        folder: { handle: "output", name: "합성 결과" },
        saved: ["first"],
        failed: ["second"],
        cancelled: false,
      })
      .mockResolvedValueOnce({
        folder: { handle: "output", name: "합성 결과" },
        saved: ["second"],
        failed: [],
        cancelled: false,
      });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    await screen.findByText(/합성 다음사진.png · 저장 실패/);
    expect(screen.getByText(/합성 첫사진.png · 저장했어요/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "저장하지 못한 사진 재시도" });
    fireEvent.click(retry);
    await screen.findByText(/합성 다음사진.png · 저장했어요/);
    expect(vi.mocked(saveCrops).mock.calls[1]?.[1].map((entry) => entry.file.handle)).toEqual(["second"]);
    expect(vi.mocked(saveCrops).mock.calls[0]?.[6]).toBe(vi.mocked(saveCrops).mock.calls[1]?.[6]);
    expect(retry.hasAttribute("disabled")).toBe(true);
    deck.dispose();
  });
  it("keeps unprocessed photos recoverable after cancellation", async () => {
    vi.mocked(saveCrops).mockResolvedValueOnce({
      folder: { handle: "output", name: "합성 결과" },
      saved: ["first"],
      failed: [],
      cancelled: true,
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    await screen.findByText(/합성 다음사진.png · 아직 저장하지 않았어요/);
    expect(screen.getByText(/합성 첫사진.png · 저장했어요/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "저장하지 못한 사진 재시도" }).hasAttribute("disabled")).toBe(false);
    deck.dispose();
  });
});

describe("crop destination recovery UI", () => {
  it("starts a new output session for unsaved photos after expiration while preserving successful results", async () => {
    vi.mocked(saveCrops)
      .mockResolvedValueOnce({
        folder: { handle: "old-output", name: "합성 결과" },
        folders: { first: { handle: "old-output", name: "합성 결과" } },
        saved: ["first"],
        failed: ["second"],
        cancelled: false,
        destinationExpired: true,
      })
      .mockResolvedValueOnce({
        folder: { handle: "new-output", name: "합성 새 결과" },
        folders: { second: { handle: "new-output", name: "합성 새 결과" } },
        saved: ["second"],
        failed: [],
        cancelled: false,
      });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    await screen.findByText(/저장 작업이 만료됐거나/);
    expect(screen.getByText(/합성 첫사진.png · 저장했어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장하지 못한 사진 재시도" }));
    await screen.findByText(/합성 다음사진.png · 저장했어요/);
    expect(vi.mocked(saveCrops).mock.calls[1]?.[1].map((entry) => entry.file.handle)).toEqual(["second"]);
    expect(vi.mocked(saveCrops).mock.calls[0]?.[6]).not.toBe(vi.mocked(saveCrops).mock.calls[1]?.[6]);
    expect(screen.getAllByRole("button", { name: "저장 위치 열기" })).toHaveLength(2);
    deck.dispose();
  });
});

describe("crop progress units", () => {
  it("shows one of two completed photos at half of the progress bar", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(saveCrops).mockImplementation(async (_deck, _items, _format, _signal, progress) => {
      progress?.(1);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { folder: { handle: "output", name: "합성 결과" }, saved: ["first"], failed: [], cancelled: false };
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "전체 사진 저장" }));
    const bar = await screen.findByRole("progressbar", { name: "처리 진행" });
    await waitFor(() => expect(Number(bar.getAttribute("aria-valuenow"))).toBe(0.5));
    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true));
    deck.dispose();
  });
});
