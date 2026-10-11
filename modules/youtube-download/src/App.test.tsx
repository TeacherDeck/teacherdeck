// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError, type Deck } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { App } from "./App.tsx";
type Status = Awaited<ReturnType<Deck["mediaDownload"]["status"]>>;
const file = { handle: "output", name: "합성 영상.mp4", ext: "mp4", size: 1024, modifiedAt: 0 };
const complete: Status = { jobHandle: "job", stage: "complete", downloadedBytes: 1024, file };
const decks: Deck[] = [];
afterEach(() => {
  cleanup();
  decks.splice(0).forEach((deck) => deck.dispose());
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  let status: () => Status | Promise<Status> = () => complete;
  let start: () => { jobHandle: string } | Promise<{ jobHandle: string }> = () => ({ jobHandle: "job" });
  let choose: () => { handle: string; name: string } | null = () => ({ handle: "folder", name: "합성 저장 폴더" });
  const starts: unknown[] = [],
    cancels: unknown[] = [],
    reveals: unknown[] = [];
  const host = createMockHost({
    module: { id: "youtube-download", version: "0.1.0" },
    granted: ["fs", "media-download"],
    handlers: {
      "fs.pickFolder": () => choose(),
      "fs.reveal": (args) => {
        reveals.push(args);
        return null;
      },
      "media-download.start": (args) => {
        starts.push(args);
        return start();
      },
      "media-download.status": () => status(),
      "media-download.cancel": (args) => {
        cancels.push(args);
        return { requested: true };
      },
    },
  });
  const deck = await connect({ window: host.window });
  decks.push(deck);
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return {
    view,
    starts,
    cancels,
    reveals,
    setStatus: (next: typeof status) => {
      status = next;
    },
    setStart: (next: typeof start) => {
      start = next;
    },
    setChoose: (next: typeof choose) => {
      choose = next;
    },
  };
}
async function configure() {
  fireEvent.change(screen.getByRole("textbox", { name: "YouTube 영상 주소" }), {
    target: { value: "https://youtu.be/ABCDEFGHI_1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "저장 폴더 선택" }));
  await screen.findByText("합성 저장 폴더");
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(false),
  );
}
it("rejects invalid input without host calls and preserves a chosen folder on picker cancellation", async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText(/공개 YouTube 영상 한 개의 https 주소/);
  expect(f.starts).toHaveLength(0);
  await configure();
  f.setChoose(() => null);
  fireEvent.click(screen.getByRole("button", { name: "저장 폴더 바꾸기" }));
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.getByText("합성 저장 폴더")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText("새 MP4 파일을 저장했어요.");
  expect(f.starts).toEqual([{ url: "https://www.youtube.com/watch?v=ABCDEFGHI_1", folderHandle: "folder" }]);
  fireEvent.click(screen.getByRole("button", { name: "저장 위치 열기" }));
  await waitFor(() => expect(f.reveals).toEqual([{ handle: "output" }]));
});
it("retains completed output while recovering from a transient status failure on a later attempt", async () => {
  const f = await fixture();
  await configure();
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByRole("button", { name: "저장 위치 열기" });
  f.setStatus(() => {
    throw new DeckCallError("INTERNAL", "합성 내부 오류");
  });
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByRole("button", { name: "진행 다시 확인" });
  expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "취소" })).toBeTruthy();
  expect(screen.queryByText("합성 내부 오류")).toBeNull();
  f.setStatus(() => ({
    jobHandle: "job",
    downloadedBytes: 1024,
    stage: "failed",
    error: { code: "TIMEOUT", message: "합성 오류" },
  }));
  fireEvent.click(screen.getByRole("button", { name: "진행 다시 확인" }));
  await screen.findByText(/준비와 다운로드가 30분을 넘었어요/);
  expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "저장 위치 열기" })).toBeTruthy();
});
it("honors cancellation pressed before the start response arrives and waits for the host terminal stage", async () => {
  const f = await fixture();
  await configure();
  const pending = deferred<{ jobHandle: string }>();
  f.setStart(() => pending.promise);
  f.setStatus(() => ({ jobHandle: "job", stage: "cancelled", downloadedBytes: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByRole("button", { name: "취소 요청 중" })).toBeTruthy();
  await act(async () => pending.resolve({ jobHandle: "job" }));
  await screen.findByText("취소했어요. 이미 저장된 파일은 유지해요.");
  expect(f.cancels).toEqual([{ jobHandle: "job" }]);
  expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "저장 위치 열기" })).toBeNull();
});
it("cancels late successful start responses after module unmount", async () => {
  const f = await fixture();
  await configure();
  const pending = deferred<{ jobHandle: string }>();
  f.setStart(() => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  f.view.unmount();
  await act(async () => pending.resolve({ jobHandle: "job" }));
  await waitFor(() => expect(f.cancels).toEqual([{ jobHandle: "job" }]));
});
it("shows unknown engine preparation progress and cancels an owned job on unload", async () => {
  const f = await fixture();
  await configure();
  f.setStatus(() => ({ jobHandle: "job", stage: "preparing-engine", downloadedBytes: 0 }));
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText(/다운로드 준비 중이에요/);
  expect(screen.getByRole("progressbar")).toBeTruthy();
  expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  f.view.unmount();
  await waitFor(() => expect(f.cancels).toEqual([{ jobHandle: "job" }]));
});
it("shows fixed guidance from start and terminal errors but hides arbitrary provider details", async () => {
  const f = await fixture();
  await configure();
  const login =
    "이 영상은 YouTube가 로그인이나 접근 확인을 요구하고 있어요. 로그인·쿠키 연동은 지원하지 않으니 다른 공개 영상을 선택해 주세요.";
  f.setStart(() => {
    throw new DeckCallError("CAPABILITY_UNAVAILABLE", login);
  });
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText(login);
  f.setStart(() => ({ jobHandle: "job" }));
  const certificate = "인터넷 보안 인증서를 확인하지 못했어요. PC 날짜와 학교망 연결 상태를 확인해 주세요.";
  f.setStatus(() => ({
    jobHandle: "job",
    stage: "failed",
    downloadedBytes: 0,
    error: { code: "CAPABILITY_UNAVAILABLE", message: certificate },
  }));
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText(certificate);
  f.setStatus(() => ({
    jobHandle: "job",
    stage: "failed",
    downloadedBytes: 0,
    error: { code: "CAPABILITY_UNAVAILABLE", message: certificate + " 합성 프로세스 원문" },
  }));
  fireEvent.click(screen.getByRole("button", { name: "다운로드" }));
  await screen.findByText("완료하지 못했어요. 주소·연결·저장 공간을 확인하고 다시 시도해 주세요.");
  expect(screen.queryByText(/합성 프로세스 원문/)).toBeNull();
  expect((screen.getByRole("button", { name: "다운로드" }) as HTMLButtonElement).disabled).toBe(false);
});
