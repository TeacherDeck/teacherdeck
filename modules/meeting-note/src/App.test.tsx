// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { type Meeting, emptyMeeting } from "./meeting.ts";
import { MEETING_KEY } from "./storage.ts";
afterEach(cleanup);
async function setup(
  state: Meeting = emptyMeeting(),
  intercept?: (key: string, value: unknown) => Promise<void>,
  clipboard = false,
) {
  const store = new Map<string, unknown>([[MEETING_KEY, state]]);
  const host = createMockHost({
    module: { id: "meeting-note", version: "0.4.0" },
    granted: ["storage", "fs", ...(clipboard ? ["clipboard"] : [])],
    handlers: {
      "clipboard.writeText": (args) => {
        store.set("copiedText", args);
        return null;
      },
      "clipboard.writeRichText": (args) => {
        store.set("copiedRich", args);
        return null;
      },
      "storage.get": (args) => store.get((args as { key: string }).key) ?? null,
      "storage.set": async (args) => {
        const { key, value } = args as { key: string; value: unknown };
        if (intercept) await intercept(key, value);
        store.set(key, value);
        return null;
      },
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  return { deck, host, view, store };
}
const seeded = () => ({ ...emptyMeeting(), speakers: ["가상 화자 A", "가상 화자 B"], selected: "가상 화자 A" });
describe("original meeting interaction flow", () => {
  it("copies public rich content only after a click and keeps file export on older hosts", async () => {
    const { deck, view, store } = await setup(seeded(), undefined, true);
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    for (const text of ["공개 발언", "// 비공개 발언"]) {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
    fireEvent.keyDown(input, { code: "F8" });
    expect(store.has("copiedRich")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "서식을 유지해 복사" }));
    await screen.findByText("클립보드에 복사했어요. 한글·Word에서 붙여넣어 주세요.");
    expect(JSON.stringify(store.get("copiedRich"))).toContain("공개 발언");
    expect(JSON.stringify(store.get("copiedRich"))).not.toContain("비공개 발언");
    view.unmount();
    deck.dispose();
    const older = await setup(seeded());
    const oldInput = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.keyDown(oldInput, { code: "F8" });
    expect(screen.queryByRole("button", { name: "서식을 유지해 복사" })).toBeNull();
    expect(screen.getByRole("button", { name: "공개용 파일 저장" })).toBeTruthy();
    older.view.unmount();
    older.deck.dispose();
  });
  it("does not count an agenda heading as the selected speaker's statement", async () => {
    const { deck, view } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.click(screen.getByRole("button", { name: "안건" }));
    fireEvent.change(input, { target: { value: "새 안건" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "가상 화자 A · Alt+1" }).textContent).toContain("0건");
    view.unmount();
    deck.dispose();
  });
  it("keeps existing records out of the typing and speaker-selection render path", async () => {
    const state = seeded();
    const meeting: Meeting = {
      ...state,
      entries: Array.from({ length: 40 }, (_, i) => ({
        id: `entry-${i}`,
        kind: "발언",
        text: `합성 기록 ${i}`,
        speaker: state.speakers[0] ?? "",
        private: false,
        owner: "",
        due: "",
        timestamp: "2026-10-10T00:00:00.000Z",
      })),
    };
    const formatted = vi.spyOn(Date.prototype, "toLocaleTimeString");
    const { deck, view } = await setup(meeting);
    try {
      const input = await screen.findByRole("textbox", { name: "발언 입력" });
      const before = formatted.mock.calls.length;
      expect(before).toBeGreaterThanOrEqual(40);
      for (const value of ["빠", "빠르", "빠르게", "빠르게 입력"]) {
        fireEvent.change(input, { target: { value } });
      }
      fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
      expect((input as HTMLTextAreaElement).value).toBe("빠르게 입력");
      expect(formatted.mock.calls.length).toBe(before);
    } finally {
      view.unmount();
      deck.dispose();
      formatted.mockRestore();
    }
  });
  it("shows registration immediately, starts a meeting, and selects visible persistent speaker chips", async () => {
    const { deck } = await setup();
    const people = await screen.findByRole("textbox", { name: "참석자" });
    expect(screen.queryByRole("textbox", { name: "발언 입력" })).toBeNull();
    fireEvent.change(people, { target: { value: "가상 화자 A\n가상 화자 B" } });
    fireEvent.change(screen.getByRole("textbox", { name: "결석자 (선택)" }), { target: { value: "가상 결석자" } });
    fireEvent.keyDown(people, { code: "Enter", key: "Enter", ctrlKey: true });
    const input = screen.getByRole("textbox", { name: "발언 입력" });
    fireEvent.click(screen.getByRole("button", { name: "가상 화자 B · Alt+2" }));
    fireEvent.change(input, { target: { value: "첫 발언" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "두 번째 발언" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByText("발언 · 가상 화자 B")).toHaveLength(2);
    const log = screen.getByRole("list", { name: "회의 기록" });
    expect(
      within(log)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("첫 발언"), expect.stringContaining("두 번째 발언")]);
    deck.dispose();
  });
  it("records complete Korean composition once and supports speaker stepping, retagging, edit/delete and undo", async () => {
    const { deck } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "한글 조합" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
    expect(screen.getByText(/전체 0건/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "한글 조합 완료" } });
    await act(async () => {
      fireEvent.compositionEnd(input);
      await Promise.resolve();
    });
    expect(screen.getAllByText("한글 조합 완료")).toHaveLength(1);
    fireEvent.keyDown(input, { code: "Digit1", key: "1", ctrlKey: true, altKey: true });
    expect(screen.getByText("발언 · 가상 화자 A")).toBeTruthy();
    fireEvent.keyDown(input, { code: "ArrowDown", key: "ArrowDown", altKey: true });
    fireEvent.change(input, { target: { value: "두 번째 발언" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("발언 · 가상 화자 B")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "두 번째 발언 수정" }));
    fireEvent.change(input, { target: { value: "수정한 발언" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByText("두 번째 발언")).toBeNull();
    expect(screen.getByText("수정한 발언")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "수정한 발언 삭제" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "기록 삭제" })).getByRole("button", { name: "삭제" }));
    expect(screen.queryByText("수정한 발언")).toBeNull();
    fireEvent.keyDown(input, { code: "KeyZ", key: "z", ctrlKey: true });
    expect(screen.getByText("수정한 발언")).toBeTruthy();
    deck.dispose();
  });
  it("offers kind/private controls, F4/F8/F9 dialogs and excludes private records from readable export", async () => {
    const { deck, view, store } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.click(screen.getByRole("button", { name: "결정" }));
    fireEvent.change(input, { target: { value: "공개 가결" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("checkbox", { name: "비공개 메모" }));
    fireEvent.change(input, { target: { value: "개인 메모" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "작성 중 초안" } });
    fireEvent.keyDown(input, { code: "F8" });
    const output = screen.getByRole("textbox", { name: "내보낼 회의록 본문" }) as HTMLTextAreaElement;
    expect(output.value).toContain("공개 가결");
    expect(output.value).not.toContain("개인 메모");
    expect(screen.queryByRole("textbox", { name: "전체 보관용 텍스트" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(input, { code: "F9" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.keyDown(input, { code: "F4" });
    expect(screen.getByText(/Ctrl\+Alt\+숫자:/)).toBeTruthy();
    view.unmount();
    await waitFor(() =>
      expect(store.get(MEETING_KEY)).toMatchObject({
        draft: "작성 중 초안",
        entries: [
          { kind: "결정", private: false },
          { private: true, text: "개인 메모" },
        ],
      }),
    );
    deck.dispose();
  });
  it("archives the current meeting before returning to setup and can reopen it", async () => {
    const { deck } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.change(input, { target: { value: "보관할 기록" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "새 회의" }));
    fireEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));
    await screen.findByRole("textbox", { name: "참석자" });
    fireEvent.click(screen.getByRole("button", { name: "회의 열기" }));
    await screen.findByText("보관할 기록");
    deck.dispose();
  });
  it("freezes recording and speaker changes until archive transition completes", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deck, store } = await setup(seeded(), async (key) => {
      if (key === "library.v1") await gate;
    });
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.change(input, { target: { value: "전환 전 기록" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "새 회의" }));
    fireEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(true));
    fireEvent.change(input, { target: { value: "차단할 입력" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
    expect(screen.getByText(/전체 1건/)).toBeTruthy();
    release?.();
    await screen.findByRole("textbox", { name: "참석자" });
    const archive = [...store.entries()].find(([key]) => key.startsWith("archive."))?.[1];
    expect(archive).toMatchObject({ selected: "가상 화자 A", draft: "", entries: [{ text: "전환 전 기록" }] });
    deck.dispose();
  });
  it("never writes empty state after a load failure", async () => {
    const host = createMockHost({
      granted: ["storage"],
      handlers: {
        "storage.get": () => {
          throw new Error("INTERNAL");
        },
        "storage.set": () => null,
      },
    });
    const deck = await connect({ window: host.window });
    render(
      <DeckProvider>
        <App deck={deck} />
      </DeckProvider>,
    );
    await screen.findByText("회의록을 불러오지 못했어요. 도구를 다시 열어 주세요.");
    expect(host.requests.filter((r) => r.method === "set")).toHaveLength(0);
    deck.dispose();
  });
});
it("separates same-name people in the live UI and retags a specific record", async () => {
  const { deck, store } = await setup({
    ...emptyMeeting(),
    speakers: ["가상 동명", "가상 동명"],
    selected: "가상 동명",
  });
  const input = await screen.findByRole("textbox", { name: "발언 입력" });
  fireEvent.click(screen.getByRole("button", { name: "가상 동명 (2번) · Alt+2" }));
  fireEvent.change(input, { target: { value: "둘째 발언" } });
  fireEvent.keyDown(input, { key: "Enter" });
  const picker = screen.getByRole("combobox", { name: "이 기록의 화자" });
  fireEvent.click(picker);
  fireEvent.click(screen.getByRole("option", { name: "1. 가상 동명" }));
  await waitFor(() => {
    const saved = store.get(MEETING_KEY) as Meeting;
    expect(saved.entries[0]?.speakerId).toBe(saved.speakerIds?.[0]);
  });
  deck.dispose();
});
