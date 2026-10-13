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
  state: unknown = emptyMeeting(),
  intercept?: (key: string, value: unknown) => Promise<void>,
  clipboard = false,
  library?: unknown,
) {
  const store = new Map<string, unknown>([[MEETING_KEY, state]]);
  if (library !== undefined) store.set("library.v1", library);
  const host = createMockHost({
    module: { id: "meeting-note", version: "0.4.0" },
    granted: ["storage", "fs", "window", ...(clipboard ? ["clipboard"] : [])],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "meeting-document" }),
      "window.setDocumentState": () => null,
      "window.completeDocumentSave": () => null,
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
  // Finish initial mock storage replies before role queries traverse the populated UI.
  await act(async () => {
    await Promise.resolve();
  });
  return { deck, host, view, store };
}
const seeded = () => ({ ...emptyMeeting(), speakers: ["가상 화자 A", "가상 화자 B"], selected: "가상 화자 A" });
async function focusedDialog(title: string) {
  const heading = await screen.findByText(title, { selector: "h2" });
  const dialog = heading.closest<HTMLElement>("[role=dialog]");
  if (!dialog) throw new Error("SYNTHETIC_DIALOG_MISSING");
  // jsdom has no pointer focus/layout; let Tabster register the surface before focusing it.
  await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
  await act(async () => dialog.querySelector<HTMLButtonElement>("button")?.focus());
  return screen.findByRole("dialog", { name: title });
}
describe("meeting recovery", () => {
  it("keeps a valid meeting usable after preserving a damaged library", async () => {
    const state = { ...seeded(), draft: "보존할 합성 초안" };
    const broken = { archive: "invalid" };
    const { deck, view, store } = await setup(state, undefined, false, broken);
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "현재 회의 계속하기" }));
    });
    expect(((await screen.findByRole("textbox", { name: "발언 입력" })) as HTMLTextAreaElement).value).toBe(
      state.draft,
    );
    expect(store.get(MEETING_KEY)).toEqual(state);
    expect([...store.entries()].some(([key, value]) => key.startsWith("recovery.") && value === broken)).toBe(true);
    expect(store.get("library.v1")).toEqual({ rosters: [], archive: [] });
    view.unmount();
    deck.dispose();
  });
  it("never replaces damaged data when preservation fails", async () => {
    const broken = { entries: "invalid" };
    const { deck, view, store } = await setup(broken, async (key) => {
      if (key.startsWith("recovery.")) throw new Error("QUOTA");
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "자료를 보관하고 새 회의 시작" }));
    });
    await screen.findByText(/복구하지 못했어요/);
    expect(store.get(MEETING_KEY)).toBe(broken);
    expect(screen.queryByRole("button", { name: "회의 시작 (Ctrl+Enter)" })).toBeNull();
    view.unmount();
    deck.dispose();
  });
});
describe("original meeting interaction flow", () => {
  it("edits action text literally and changes owner and due only through their own fields", async () => {
    const state: Meeting = {
      ...seeded(),
      entries: [
        {
          id: "action",
          kind: "조치",
          text: "2 상자 @표시와 ~기호를 보존",
          owner: "합성 담당",
          due: "이번 금요일",
          speaker: "가상 화자 A",
          private: true,
          raw: "* 2 과거 입력",
        },
      ],
    };
    const { deck, view, store } = await setup(state);
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2 상자 @표시와 ~기호를 보존 수정" }));
    });
    expect((input as HTMLTextAreaElement).value).toBe(state.entries[0]?.text);
    await act(async () => {
      fireEvent.change(input, { target: { value: "2 상자 @표시와 ~기호를 보존하며 수정" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    });
    await waitFor(() =>
      expect((store.get(MEETING_KEY) as Meeting).entries[0]).toMatchObject({
        text: "2 상자 @표시와 ~기호를 보존하며 수정",
        owner: "합성 담당",
        due: "이번 금요일",
        kind: "조치",
        private: true,
        speaker: "가상 화자 A",
      }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "2 상자 @표시와 ~기호를 보존하며 수정 수정" }));
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "조치 담당자" }), { target: { value: "새 합성 담당" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "조치 기한" }), { target: { value: "다음 월요일" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    });
    await waitFor(() =>
      expect((store.get(MEETING_KEY) as Meeting).entries[0]).toMatchObject({
        owner: "새 합성 담당",
        due: "다음 월요일",
        text: "2 상자 @표시와 ~기호를 보존하며 수정",
      }),
    );
    view.unmount();
    deck.dispose();
  });
  it("keeps a retagged speaker when editing a statement originally entered with a number shortcut", async () => {
    const { deck, view, store } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "2 합성 발언" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "합성 발언 화자 변경" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: "이 기록의 화자" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "1. 가상 화자 A" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "합성 발언 수정" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    });
    await waitFor(() => {
      const saved = store.get(MEETING_KEY) as Meeting;
      expect(saved.entries[0]?.speakerId).toBe(saved.speakerIds?.[0]);
      expect(saved.entries[0]?.speaker).toBe("가상 화자 A");
    });
    view.unmount();
    deck.dispose();
  });
  it("copies public rich content only after a click and keeps file export on older hosts", async () => {
    const { deck, view, store } = await setup(seeded(), undefined, true);
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    input.focus();
    for (const text of ["공개 발언", "// 비공개 발언"]) {
      await act(async () => {
        fireEvent.change(input, { target: { value: text } });
      });
      await act(async () => {
        fireEvent.keyDown(input, { key: "Enter" });
      });
    }
    await act(async () => {
      fireEvent.keyDown(input, { code: "F8" });
    });
    await focusedDialog("내보내기");
    expect(store.has("copiedRich")).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "서식을 유지해 복사" }));
    });
    await screen.findByText("클립보드에 복사했어요. 한글·Word에서 붙여넣어 주세요.");
    expect(JSON.stringify(store.get("copiedRich"))).toContain("공개 발언");
    expect(JSON.stringify(store.get("copiedRich"))).not.toContain("비공개 발언");
    view.unmount();
    deck.dispose();
    const older = await setup(seeded());
    const oldInput = await screen.findByRole("textbox", { name: "발언 입력" });
    oldInput.focus();
    await act(async () => {
      fireEvent.keyDown(oldInput, { code: "F8" });
    });
    const dialog = await screen.findByRole("dialog", { name: "내보내기" });
    await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
    const action = dialog.querySelector("button");
    if (!action) throw new Error("synthetic export action missing");
    action.focus();
    expect(document.activeElement).toBe(action);
    expect(await within(dialog).findByRole("button", { name: "공개용 파일 저장" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "서식을 유지해 복사" })).toBeNull();
    older.view.unmount();
    older.deck.dispose();
  });
  it("does not count an agenda heading as the selected speaker's statement", async () => {
    const { deck, view } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "종류 · 비공개 선택" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "안건" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "새 안건" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(screen.getByRole("button", { name: "가상 화자 A · Alt+1" }).textContent).toContain("0건");
    view.unmount();
    deck.dispose();
  });
  it("keeps existing records out of the typing and speaker-selection render path", async () => {
    const state = seeded();
    const meeting: Meeting = {
      ...state,
      entries: Array.from({ length: 100 }, (_, i) => ({
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
      expect(before).toBeGreaterThanOrEqual(100);
      for (const value of ["빠", "빠르", "빠르게", "빠르게 입력"]) {
        await act(async () => {
          fireEvent.change(input, { target: { value } });
        });
      }
      await act(async () => {
        fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
      });
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
    await act(async () => {
      fireEvent.change(people, { target: { value: "가상 화자 A\n가상 화자 B" } });
    });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "결석자 (선택)" }), { target: { value: "가상 결석자" } });
    });
    await act(async () => {
      fireEvent.keyDown(people, { code: "Enter", key: "Enter", ctrlKey: true });
    });
    const input = screen.getByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "가상 화자 B · Alt+2" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "첫 발언" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "두 번째 발언" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(within(screen.getByRole("list", { name: "회의 기록" })).getAllByText("가상 화자 B")).toHaveLength(2);
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
    await act(async () => {
      fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
    });
    await act(async () => {
      fireEvent.compositionStart(input);
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "한글 조합" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
    });
    expect(screen.getByText(/전체 0건/)).toBeTruthy();
    await act(async () => {
      fireEvent.change(input, { target: { value: "한글 조합 완료" } });
    });
    await act(async () => {
      fireEvent.compositionEnd(input);
      await Promise.resolve();
    });
    expect(screen.getAllByText("한글 조합 완료")).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(input, { code: "Digit1", key: "1", ctrlKey: true, altKey: true });
    });
    expect(within(screen.getByRole("list", { name: "회의 기록" })).getByText("가상 화자 A")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(input, { code: "ArrowDown", key: "ArrowDown", altKey: true });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "두 번째 발언" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(within(screen.getByRole("list", { name: "회의 기록" })).getByText("가상 화자 B")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "두 번째 발언 수정" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "수정한 발언" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(screen.queryByText("두 번째 발언")).toBeNull();
    expect(screen.getByText("수정한 발언")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정한 발언 삭제" }));
    });
    const deletionDialog = await focusedDialog("기록 삭제");
    await act(async () => {
      fireEvent.click(within(deletionDialog).getByRole("button", { name: "삭제" }));
    });
    expect(screen.queryByText("수정한 발언")).toBeNull();
    await act(async () => {
      fireEvent.keyDown(input, { code: "KeyZ", key: "z", ctrlKey: true });
    });
    expect(screen.getByText("수정한 발언")).toBeTruthy();
    deck.dispose();
  });
  it("offers kind/private controls, F4/F8/F9 dialogs and excludes private records from readable export", async () => {
    const { deck, view, store } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "종류 · 비공개 선택" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "결정" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "공개 가결" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "비공개 메모" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "개인 메모" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "작성 중 초안" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { code: "F8" });
    });
    await focusedDialog("내보내기");
    const output = (await screen.findByRole("textbox", { name: "내보낼 회의록 본문" })) as HTMLTextAreaElement;
    expect(output.value).toContain("공개 가결");
    expect(output.value).not.toContain("개인 메모");
    expect(screen.queryByRole("textbox", { name: "전체 보관용 텍스트" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    });
    await act(async () => {
      fireEvent.keyDown(input, { code: "F9" });
    });
    expect(await focusedDialog("참석자 편집")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "취소" }));
    });
    await act(async () => {
      fireEvent.keyDown(input, { code: "F4" });
    });
    await focusedDialog("회의록 도움말");
    expect(await screen.findByText(/Ctrl\+Alt\+숫자:/)).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(window, { code: "Escape" });
    });
    const saveButton = await screen.findByRole("button", { name: "지금 저장" });
    await act(async () => fireEvent.click(saveButton));
    await waitFor(() =>
      expect(store.get(MEETING_KEY)).toMatchObject({
        draft: "작성 중 초안",
        entries: [
          { kind: "결정", private: false },
          { private: true, text: "개인 메모" },
        ],
      }),
    );
    view.unmount();
    deck.dispose();
  });
  it("archives the current meeting before returning to setup and can reopen it", async () => {
    const { deck } = await setup(seeded());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "보관할 기록" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새 회의" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));
    });
    await screen.findByRole("textbox", { name: "참석자" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "회의 열기" }));
    });
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
    await act(async () => {
      fireEvent.change(input, { target: { value: "전환 전 기록" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새 회의" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));
    });
    await waitFor(() => expect((input as HTMLTextAreaElement).disabled).toBe(true));
    await act(async () => {
      fireEvent.change(input, { target: { value: "차단할 입력" } });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { code: "Digit2", key: "2", altKey: true });
    });
    expect(screen.getByText(/전체 1건/)).toBeTruthy();
    release?.();
    await screen.findByRole("textbox", { name: "참석자" });
    const archive = [...store.entries()].find(([key]) => key.startsWith("archive."))?.[1];
    expect(archive).toMatchObject({ selected: "가상 화자 A", draft: "", entries: [{ text: "전환 전 기록" }] });
    deck.dispose();
  });
  it("never writes empty state after a load failure", async () => {
    const host = createMockHost({
      granted: ["storage", "window"],
      handlers: {
        "window.registerDocument": () => ({ documentHandle: "meeting-document" }),
        "window.setDocumentState": () => null,
        "window.completeDocumentSave": () => null,
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
    await screen.findByRole("heading", { name: "회의록 복구" });
    expect(host.requests.filter((r) => r.method === "set")).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "자료를 보관하고 새 회의 시작" }));
    });
    await screen.findByText(/복구하지 못했어요/);
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
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "가상 동명 (2번) · Alt+2" }));
  });
  await act(async () => {
    fireEvent.change(input, { target: { value: "둘째 발언" } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "둘째 발언 화자 변경" }));
  });
  const picker = screen.getByRole("combobox", { name: "이 기록의 화자" });
  await act(async () => {
    fireEvent.click(picker);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: "1. 가상 동명" }));
  });
  await waitFor(() => {
    const saved = store.get(MEETING_KEY) as Meeting;
    expect(saved.entries[0]?.speakerId).toBe(saved.speakerIds?.[0]);
  });
  deck.dispose();
});

it("keeps current agenda, colored shortcut chips and compact records visible during continuous entry", async () => {
  const { deck } = await setup(seeded());
  const input = await screen.findByRole("textbox", { name: "발언 입력" });
  expect(screen.getByRole("button", { name: "종류 · 비공개 선택" }).getAttribute("aria-expanded")).toBe("false");
  const speaker = screen.getByRole("button", { name: "가상 화자 B · Alt+2" });
  expect(within(speaker).getByText("2")).toBeTruthy();
  expect(speaker.querySelector("[aria-hidden='true']")?.getAttribute("style")).toContain("background-color");
  await act(async () => {
    fireEvent.change(input, { target: { value: "# 합성 안건" } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  expect(screen.getByText("현재 안건: 합성 안건")).toBeTruthy();
  await act(async () => {
    fireEvent.click(speaker);
  });
  await act(async () => {
    fireEvent.change(input, { target: { value: "연속 입력 발언" } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await waitFor(() => expect(document.activeElement).toBe(input));
  const rows = within(screen.getByRole("list", { name: "회의 기록" })).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(within(rows[1] as HTMLElement).getByText("가상 화자 B")).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: "이 기록의 화자" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "연속 입력 발언 화자 변경" }));
  });
  expect(screen.getByRole("combobox", { name: "이 기록의 화자" })).toBeTruthy();
  deck.dispose();
});

describe("record review preserves work in progress", () => {
  const reviewMeeting = (): Meeting => ({
    ...seeded(),
    draft: "아직 기록하지 않은 발언",
    entries: [
      {
        id: "old",
        kind: "발언",
        text: "과거 기록",
        speaker: "가상 화자 A",
        private: false,
        owner: "",
        due: "",
      },
    ],
  });
  it("keeps the new-statement draft during editing, autosave and edit commit", async () => {
    const state = reviewMeeting();
    const { deck, view, store } = await setup(state);
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "과거 기록 수정" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "수정한 과거 기록" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "지금 저장" }));
    });
    await screen.findByText("기록을 수정하고 있어요. 수정 저장 또는 수정 취소를 누른 뒤 다시 저장해 주세요.");
    expect((store.get(MEETING_KEY) as Meeting).draft).toBe(state.draft);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    });
    expect((input as HTMLTextAreaElement).value).toBe(state.draft);
    expect(screen.getByRole("button", { name: "수정한 과거 기록 수정" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "지금 저장" }));
    });
    await waitFor(() => expect((store.get(MEETING_KEY) as Meeting).entries[0]?.text).toBe("수정한 과거 기록"));
    expect((store.get(MEETING_KEY) as Meeting).draft).toBe(state.draft);
    view.unmount();
    deck.dispose();
  });
  it("retains scroll position for edit and retag, and follows only new entries", async () => {
    const { deck, view } = await setup(reviewMeeting());
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    const log = screen.getByRole("list", { name: "회의 기록" }).parentElement as HTMLDivElement;
    Object.defineProperty(log, "scrollHeight", { value: 2000, configurable: true });
    log.scrollTop = 200;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "과거 기록 수정" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "가상 화자 B · Alt+2" }));
    });
    expect(log.scrollTop).toBe(200);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    });
    expect(log.scrollTop).toBe(200);
    await act(async () => {
      fireEvent.change(input, { target: { value: "새 발언" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "기록" }));
    });
    expect(log.scrollTop).toBe(2000);
    view.unmount();
    deck.dispose();
  });
  it("restores the pending draft when changing edited records and cancelling", async () => {
    const state = reviewMeeting();
    const original = state.entries[0];
    if (!original) throw new Error("MISSING_SYNTHETIC_ENTRY");
    state.entries.push({ ...original, id: "second", text: "다른 과거 기록" });
    const { deck, view } = await setup(state);
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "과거 기록 수정" }));
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "임시 수정 내용" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "다른 과거 기록 수정" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "수정 취소 (Esc)" }));
    });
    expect((input as HTMLTextAreaElement).value).toBe(state.draft);
    view.unmount();
    deck.dispose();
  });
});

it("restores pending kind and privacy choices after reviewing an existing record", async () => {
  const { deck, view } = await setup({
    ...seeded(),
    entries: [
      { id: "old", kind: "발언", text: "과거 기록", speaker: "가상 화자 A", private: false, owner: "", due: "" },
    ],
  });
  const input = await screen.findByRole("textbox", { name: "발언 입력" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "종류 · 비공개 선택" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "결정" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "비공개 메모" }));
  });
  await act(async () => {
    fireEvent.change(input, { target: { value: "보존할 비공개 결정" } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "과거 기록 수정" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "기록" }));
  });
  const entry = within(screen.getByRole("list", { name: "회의 기록" }))
    .getByText("보존할 비공개 결정")
    .closest("[role=listitem]") as HTMLElement;
  expect(within(entry).getByText("결정")).toBeTruthy();
  expect(within(entry).getByText("비공개")).toBeTruthy();
  view.unmount();
  deck.dispose();
});

it("respects Space on a focused action button instead of moving focus into the composer", async () => {
  const { deck, view } = await setup(seeded());
  await screen.findByRole("textbox", { name: "발언 입력" });
  const button = screen.getByRole("button", { name: "내보내기 (F8)" });
  button.focus();
  await act(async () => {
    fireEvent.keyDown(button, { key: " ", code: "Space" });
  });
  expect(document.activeElement).toBe(button);
  view.unmount();
  deck.dispose();
});

it("retains all twelve speaker shortcuts and recording focus beside compact management and save groups", async () => {
  const speakers = Array.from({ length: 12 }, (_, index) => `합성 참석자 ${index + 1}`);
  const { deck, view } = await setup({
    ...emptyMeeting(),
    title: "합성 회의의 긴 한국어 제목 ".repeat(6),
    speakers,
    selected: speakers[0],
  });
  const input = await screen.findByRole("textbox", { name: "발언 입력" });
  const management = screen.getByRole("group", { name: "회의 관리" });
  expect(within(management).getAllByRole("button")).toHaveLength(2);
  const state = screen.getByRole("group", { name: "기록 되돌리기와 저장" });
  expect(within(state).getByRole("button", { name: "지금 저장" })).toBeTruthy();
  const codes = [
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Digit0",
    "Minus",
    "Equal",
  ];
  await act(async () => {
    for (const [index, code] of codes.entries()) {
      fireEvent.keyDown(input, { code, altKey: true });
      fireEvent.change(input, { target: { value: `합성 발언 ${index}` } });
      fireEvent.keyDown(input, { key: "Enter" });
    }
  });
  const rows = screen.getByRole("list", { name: "회의 기록" }).querySelectorAll("[role='listitem']");
  expect(rows).toHaveLength(12);
  for (const index of codes.keys()) {
    expect(rows[index]?.textContent).toContain(`합성 발언 ${index}`);
    expect(rows[index]?.textContent).toContain(speakers[index] ?? "");
  }
  expect(document.activeElement).toBe(input);
  await act(async () => {
    fireEvent.keyDown(input, { code: "ArrowDown", altKey: true });
  });
  expect(screen.getByRole("button", { name: "합성 참석자 1 · Alt+1" }).getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    fireEvent.keyDown(input, { code: "ArrowUp", altKey: true });
  });
  expect(screen.getByRole("button", { name: "합성 참석자 12 · Alt+=" }).getAttribute("aria-pressed")).toBe("true");
  view.unmount();
  deck.dispose();
});

it("keeps a failed management action visible next to input after autosave succeeds", async () => {
  const { deck, view } = await setup(seeded(), async (key) => {
    if (key === "library.v1") throw new Error("SYNTHETIC_QUOTA");
  });
  const input = await screen.findByRole("textbox", { name: "발언 입력" });
  await act(async () => {
    fireEvent.change(input, { target: { value: "관리 실패 전에 보관할 합성 기록" } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "새 회의" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));
  });
  const error = await screen.findByText(
    "처리하지 못했어요. 현재 회의는 그대로 두었어요. 저장 공간과 파일을 확인해 주세요.",
  );
  expect(error.closest("[role='group']")).toBeTruthy();
  await act(async () => {
    fireEvent.change(input, { target: { value: "실패 뒤에도 보존할 합성 초안" } });
  });
  await screen.findByText("저장했어요.");
  expect(
    screen.getByText("처리하지 못했어요. 현재 회의는 그대로 두었어요. 저장 공간과 파일을 확인해 주세요."),
  ).toBeTruthy();
  expect((input as HTMLTextAreaElement).value).toBe("실패 뒤에도 보존할 합성 초안");
  view.unmount();
  deck.dispose();
});
