// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationPayload, PresentationSession } from "@deck/sdk";
import { DeckProvider } from "./DeckProvider.tsx";
import { PresentationControls, type PresentationControlsProps } from "./PresentationControls.tsx";

afterEach(cleanup);
const payload: PresentationPayload = {
  kind: "picker",
  title: "합성 수업",
  columns: null,
  items: [{ label: "1번 합성가", group: null, row: null, column: null }],
};
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(version = "1.1.0") {
  const events = new Map<string, (value: { presentationHandle: string }) => void>();
  const window = {
    setAlwaysOnTop: vi.fn(async () => undefined),
    setFullscreen: vi.fn(async () => undefined),
    listDisplays: vi.fn(async () => [
      { displayHandle: "primary", label: "화면 1", primary: true, width: 800, height: 600, scaleFactor: 1 },
      { displayHandle: "secondary", label: "화면 2", primary: false, width: 1280, height: 720, scaleFactor: 1 },
    ]),
    openPresentation: vi.fn(async () => ({ presentationHandle: "session", revision: 0 })),
    updatePresentation: vi.fn(async (args: { presentationHandle: string; revision: number }) => ({
      presentationHandle: args.presentationHandle,
      revision: args.revision,
    })),
    closePresentation: vi.fn(async () => undefined),
  };
  const deck: PresentationControlsProps["deck"] = {
    has: () => true,
    version: () => version,
    window,
    on: ((name: string, handler: (value: { presentationHandle: string }) => void) => {
      events.set(name, handler);
      return () => events.delete(name);
    }) as PresentationControlsProps["deck"]["on"],
  };
  const view = render(
    <DeckProvider mica={false}>
      <PresentationControls deck={deck} payload={payload} />
    </DeckProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "확장 학생 화면" }));
  return { deck, window, events, view };
}
async function open(f: ReturnType<typeof fixture>) {
  fireEvent.click(screen.getByRole("button", { name: "화면 목록 다시 읽기" }));
  await screen.findByText(/보조 화면을 우선/);
  fireEvent.click(screen.getByRole("button", { name: "확장 화면 열기" }));
  await waitFor(() => expect(f.window.openPresentation).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: "선택한 화면으로 다시 열기" });
}
describe("explicit public presentation controls", () => {
  it("keeps existing window 1.0 usable without calling extension methods", () => {
    const f = fixture("1.0.0");
    expect(screen.getByText(/앱 업데이트 후/)).toBeTruthy();
    expect(f.window.listDisplays).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "확장 화면 열기" })).toBeNull();
  });
  it("recommends the secondary display and publishes only on explicit open or update", async () => {
    const f = fixture();
    await open(f);
    expect(f.window.openPresentation).toHaveBeenCalledWith({ displayHandle: "secondary", payload });
    const changed = {
      ...payload,
      items: [{ ...payload.items[0], label: "2번 합성나", group: null, row: null, column: null }],
    };
    f.view.rerender(
      <DeckProvider mica={false}>
        <PresentationControls deck={f.deck} payload={changed} />
      </DeckProvider>,
    );
    expect(f.window.updatePresentation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "학생 화면 갱신" }));
    await screen.findByText("현재 공개 결과로 갱신했어요.");
    expect(f.window.updatePresentation).toHaveBeenCalledWith({
      presentationHandle: "session",
      revision: 1,
      payload: changed,
    });
    fireEvent.click(screen.getByRole("button", { name: "학생 화면 갱신" }));
    await waitFor(() =>
      expect(f.window.updatePresentation).toHaveBeenLastCalledWith({
        presentationHandle: "session",
        revision: 2,
        payload: changed,
      }),
    );
  });
  it("ignores unrelated events and requires display reselection after disconnection", async () => {
    const f = fixture();
    await open(f);
    act(() => f.events.get("window.presentationClosed")?.({ presentationHandle: "another" }));
    expect(screen.getByRole("button", { name: "학생 화면 갱신" })).toHaveProperty("disabled", false);
    act(() => f.events.get("window.presentationDisconnected")?.({ presentationHandle: "session" }));
    expect(screen.getByRole("button", { name: "학생 화면 갱신" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "선택한 화면으로 다시 열기" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "화면 목록 다시 읽기" }));
    await screen.findByText(/보조 화면을 우선/);
    fireEvent.click(screen.getByRole("button", { name: "선택한 화면으로 다시 열기" }));
    await waitFor(() => expect(f.window.openPresentation).toHaveBeenCalledTimes(2));
    expect(f.window.closePresentation).toHaveBeenCalledWith({ presentationHandle: "session" });
    act(() => f.events.get("window.presentationClosed")?.({ presentationHandle: "session" }));
    expect(screen.getByRole("button", { name: "확장 화면 열기" })).toBeTruthy();
  });
  it("does not resurrect a closed window when an earlier update resolves", async () => {
    const f = fixture();
    await open(f);
    const pending = deferred<PresentationSession>();
    f.window.updatePresentation.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "학생 화면 갱신" }));
    act(() => f.events.get("window.presentationClosed")?.({ presentationHandle: "session" }));
    await act(async () => pending.resolve({ presentationHandle: "session", revision: 1 }));
    expect(screen.getByRole("button", { name: "확장 화면 열기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "확장 화면 닫기" })).toHaveProperty("disabled", true);
  });
  it("prevents duplicate opens and closes an open result that arrives after unmount", async () => {
    const f = fixture();
    const pending = deferred<PresentationSession>();
    f.window.openPresentation.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "화면 목록 다시 읽기" }));
    await screen.findByText(/보조 화면을 우선/);
    const button = screen.getByRole("button", { name: "확장 화면 열기" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(f.window.openPresentation).toHaveBeenCalledTimes(1);
    f.view.unmount();
    await act(async () => pending.resolve({ presentationHandle: "late", revision: 0 }));
    expect(f.window.closePresentation).toHaveBeenCalledWith({ presentationHandle: "late" });
    expect(f.events.size).toBe(0);
  });
  it("honors a close event that arrives before its open response", async () => {
    const f = fixture(),
      pending = deferred<PresentationSession>();
    f.window.openPresentation.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "화면 목록 다시 읽기" }));
    await screen.findByText(/보조 화면을 우선/);
    fireEvent.click(screen.getByRole("button", { name: "확장 화면 열기" }));
    act(() => f.events.get("window.presentationClosed")?.({ presentationHandle: "early" }));
    act(() => f.events.get("window.presentationDisconnected")?.({ presentationHandle: "early" }));
    await act(async () => pending.resolve({ presentationHandle: "early", revision: 0 }));
    expect(screen.getByRole("button", { name: "확장 화면 닫기" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "확장 화면 열기" })).toBeTruthy();
  });
  it("preserves the existing session after a failed update and permits retry", async () => {
    const f = fixture();
    await open(f);
    f.window.updatePresentation.mockRejectedValueOnce(new Error("synthetic"));
    fireEvent.click(screen.getByRole("button", { name: "학생 화면 갱신" }));
    await screen.findByText(/이전 공개 결과는 유지/);
    expect(screen.getByRole("button", { name: "확장 화면 닫기" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "학생 화면 갱신" }));
    await screen.findByText("현재 공개 결과로 갱신했어요.");
    expect(f.window.updatePresentation).toHaveBeenLastCalledWith({
      presentationHandle: "session",
      revision: 1,
      payload,
    });
  });
  it("retains the public session while teacher results are absent or the controls are hidden", async () => {
    const f = fixture();
    await open(f);
    f.view.rerender(
      <DeckProvider mica={false}>
        <PresentationControls deck={f.deck} payload={null} hidden />
      </DeckProvider>,
    );
    expect(screen.queryByRole("button", { name: "학생 화면 갱신" })).toBeNull();
    expect(f.window.closePresentation).not.toHaveBeenCalled();
    f.view.rerender(
      <DeckProvider mica={false}>
        <PresentationControls deck={f.deck} payload={null} disabled />
      </DeckProvider>,
    );
    expect(screen.getByRole("button", { name: "학생 화면 갱신" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "확장 화면 닫기" }));
    await screen.findByText("확장 학생 화면을 닫았어요.");
    expect(f.window.closePresentation).toHaveBeenCalledWith({ presentationHandle: "session" });
  });
});
