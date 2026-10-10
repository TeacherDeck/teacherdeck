// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { readExtraction, savePhotos, type Extraction } from "./batch.ts";
import { fakeJpeg } from "./fixtures.test-support.ts";
vi.mock("./batch.ts", async (original) => ({
  ...(await original<typeof import("./batch.ts")>()),
  readExtraction: vi.fn(),
  savePhotos: vi.fn(),
}));
const file = { handle: "input-1", name: "합성 명렬표.xlsx", ext: "xlsx", size: 100, modifiedAt: 0 };
const sample: Extraction = {
  file,
  students: [
    {
      row: 2,
      col: 1,
      text: "1학년 3반 1번 가상가",
      sheet: "합성",
      grade: 1,
      classNumber: 3,
      number: 1,
      name: "가상가",
      photoKey: "xl/media/a.jpeg",
    },
    {
      row: 2,
      col: 5,
      text: "1학년 3반 2번 가상나",
      sheet: "합성",
      grade: 1,
      classNumber: 3,
      number: 2,
      name: "가상나",
    },
  ],
  photos: [
    { key: "xl/media/a.jpeg", bytes: fakeJpeg(1), extension: "jpg", mime: "image/jpeg", preview: true },
    { key: "xl/media/extra.jpeg", bytes: fakeJpeg(2), extension: "jpg", mime: "image/jpeg", preview: true },
  ],
  warnings: ["사진 없는 학생 1명을 유지해요."],
};
async function setup() {
  const selection = { files: [file] };
  const host = createMockHost({
    module: { id: "photo-extract", version: "0.1.0" },
    caps: { fs: "1.1.0" },
    granted: ["fs"],
    handlers: { "fs.pickFiles": () => selection.files },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return { deck, host, selection };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("compact photo extraction flow", () => {
  it("shows thumbnails, preserves the no-photo roster, edits a filename and saves all photos directly", async () => {
    const originalUrl = URL;
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends originalUrl {
        static override createObjectURL = vi.fn(() => "blob:synthetic");
        static override revokeObjectURL = revoke;
      },
    );
    vi.mocked(readExtraction).mockResolvedValue(sample);
    vi.mocked(savePhotos).mockResolvedValue({
      folder: { handle: "output", name: "합성 결과" },
      saved: ["a", "b"],
      failed: [],
      cancelled: false,
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("1개 파일 · 사진 2장 · 학생 2명");
    expect(await screen.findAllByRole("img")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /학생 명단/ }));
    expect(await screen.findByText(/2번 가상나 · 사진 없음/)).toBeTruthy();
    const names = screen.getAllByRole("textbox", { name: "저장할 이름" });
    fireEvent.change(names[1] as HTMLElement, { target: { value: "확인한 사진" } });
    expect(screen.getByText("예정 파일명: 확인한 사진.jpg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "사진 저장" }));
    await waitFor(() => expect(savePhotos).toHaveBeenCalledOnce());
    expect(vi.mocked(savePhotos).mock.calls[0]?.[1].map((p) => p.filename)).toEqual([
      "10301_가상가.jpg",
      "확인한 사진.jpg",
    ]);
    await screen.findByText("2장 저장했어요. 원본 문서는 그대로 유지해요.");
    cleanup();
    expect(revoke).toHaveBeenCalledTimes(2);
    deck.dispose();
  });
  it("rejects an oversized retained input without blocking later small documents", async () => {
    const sourcePhoto = sample.photos[0];
    if (!sourcePhoto) throw new Error("SYNTHETIC_PHOTO_MISSING");
    const large = new Uint8Array([1]);
    // Admission metadata is synthetic; no 129MiB image allocation is necessary.
    Object.defineProperty(large, "length", { value: 129 * 1024 * 1024 });
    const { deck, selection } = await setup();
    const oversized = { ...file, handle: "too-large", name: "합성 큰자료.xlsx" };
    const small = { ...file, handle: "small", name: "합성 작은자료.xlsx" };
    selection.files = [oversized, small];
    vi.mocked(readExtraction)
      .mockResolvedValueOnce({
        file: oversized,
        students: [],
        warnings: [],
        photos: [{ ...sourcePhoto, bytes: large, preview: false }],
      })
      .mockResolvedValueOnce({
        file: small,
        students: [],
        warnings: [],
        photos: [{ ...sourcePhoto, preview: false }],
      });
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("1개 파일 · 사진 1장 · 학생 0명");
    expect(screen.getByText(/1개 파일은 읽지 못했어요/)).toBeTruthy();
    deck.dispose();
  });
  it("keeps successful previews when another input fails and offers retry", async () => {
    const originalUrl = URL;
    vi.stubGlobal(
      "URL",
      class extends originalUrl {
        static override createObjectURL = vi.fn(() => "blob:synthetic");
        static override revokeObjectURL = vi.fn();
      },
    );
    vi.mocked(readExtraction).mockResolvedValueOnce(sample).mockRejectedValueOnce(new Error("INVALID_ARCHIVE"));
    const { deck, selection } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("1개 파일 · 사진 2장 · 학생 2명");
    selection.files = [{ ...file, handle: "input-2", name: "다른 합성.xlsx" }];
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByRole("button", { name: "다시 읽기" });
    expect(await screen.findAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("1개 파일 · 사진 2장 · 학생 2명")).toBeTruthy();
    deck.dispose();
  });
});

describe("photo saving recovery", () => {
  it("preserves saved and failed photo identities when another document is added, and retries only failures", async () => {
    const noPreview = { ...sample, photos: sample.photos.map((photo) => ({ ...photo, preview: false })) };
    vi.mocked(readExtraction).mockResolvedValueOnce(noPreview);
    const savedId = `${file.handle}:${sample.photos[0]?.key}`;
    const failedId = `${file.handle}:${sample.photos[1]?.key}`;
    vi.mocked(savePhotos)
      .mockResolvedValueOnce({
        folder: { handle: "output", name: "합성 결과" },
        saved: [savedId],
        failed: [failedId],
        cancelled: false,
      })
      .mockResolvedValueOnce({
        folder: { handle: "output", name: "합성 결과" },
        saved: [failedId],
        failed: [],
        cancelled: false,
      });
    const { deck, selection } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("1개 파일 · 사진 2장 · 학생 2명");
    fireEvent.click(screen.getByRole("button", { name: "사진 저장" }));
    await screen.findByText(/미확인_002.jpg · 저장 실패/);
    expect(screen.getByText(/10301_가상가.jpg · 저장했어요/)).toBeTruthy();
    const added = { ...file, handle: "input-new", name: "합성 추가.xlsx" };
    selection.files = [added];
    const addedPhoto = noPreview.photos[0];
    if (!addedPhoto) throw new Error("SYNTHETIC_PHOTO_MISSING");
    vi.mocked(readExtraction).mockResolvedValueOnce({
      ...noPreview,
      file: added,
      students: [],
      photos: [addedPhoto],
    });
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("2개 파일 · 사진 3장 · 학생 2명");
    expect(screen.getByText(/미확인_002.jpg · 저장 실패/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "결과 폴더 열기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장하지 못한 사진 재시도" }));
    await screen.findByText(/미확인_002.jpg · 저장했어요/);
    expect(vi.mocked(savePhotos).mock.calls[1]?.[1].map((photo) => photo.id)).toEqual([failedId]);
    expect(vi.mocked(savePhotos).mock.calls[0]?.[4]).toBe(vi.mocked(savePhotos).mock.calls[1]?.[4]);
    deck.dispose();
  });
});

describe("photo save progress units", () => {
  it("shows one of two completed photos at half of the progress bar", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(readExtraction).mockResolvedValue({
      ...sample,
      photos: sample.photos.map((photo) => ({ ...photo, preview: false })),
    });
    vi.mocked(savePhotos).mockImplementation(async (_deck, _photos, _signal, progress) => {
      progress?.(1);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        folder: { handle: "output", name: "합성 결과" },
        saved: [`${file.handle}:${sample.photos[0]?.key}`],
        failed: [],
        cancelled: false,
      };
    });
    const { deck } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "파일 추가" }));
    await screen.findByText("1개 파일 · 사진 2장 · 학생 2명");
    fireEvent.click(screen.getByRole("button", { name: "사진 저장" }));
    const bar = await screen.findByRole("progressbar", { name: "처리 진행" });
    await waitFor(() => expect(Number(bar.getAttribute("aria-valuenow"))).toBe(0.5));
    finish?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "취소" }).hasAttribute("disabled")).toBe(true));
    deck.dispose();
  });
});
