// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { emptyMeeting } from "./meeting.ts";
afterEach(cleanup);
describe("meeting keyboard input", () => {
  it("flushes a pending draft on component unmount and offers a private backup", async () => {
    const stored: unknown[] = [];
    const host = createMockHost({
      module: { id: "meeting-note", version: "0.1.0" },
      granted: ["storage"],
      handlers: {
        "storage.get": () => emptyMeeting(),
        "storage.set": (args) => {
          stored.push((args as { value: unknown }).value);
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
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.change(input, { target: { value: "// 개인 메모" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "작성 중 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "전체 보관용 텍스트 보기" }));
    const backup = screen.getByRole("textbox", { name: "전체 보관용 텍스트" }) as HTMLTextAreaElement;
    expect(backup.value).toContain("개인 메모");
    expect(backup.value).toContain("작성 중 초안");
    view.unmount();
    await waitFor(() =>
      expect(stored.at(-1)).toMatchObject({ draft: "작성 중 초안", entries: [{ private: true, text: "개인 메모" }] }),
    );
    deck.dispose();
  });
  it("records complete Korean composition once, keeps speaker, and accepts consecutive Enter", async () => {
    const host = createMockHost({
      module: { id: "meeting-note", version: "0.1.0" },
      granted: ["storage"],
      handlers: {
        "storage.get": () => ({ ...emptyMeeting(), speakers: ["가상 화자 A", "가상 화자 B"], selected: "가상 화자 A" }),
        "storage.set": () => null,
      },
    });
    const deck = await connect({ window: host.window });
    render(
      <DeckProvider>
        <App deck={deck} />
      </DeckProvider>,
    );
    const input = await screen.findByRole("textbox", { name: "발언 입력" });
    fireEvent.focus(input);
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
    fireEvent.change(input, { target: { value: "두 번째 발언" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getByText("두 번째 발언")).toBeTruthy();
    expect(screen.getAllByText("발언 · 가상 화자 B")).toHaveLength(2);
    fireEvent.change(input, { target: { value: "줄바꿈 유지" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText(/전체 2건/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "기록 되돌리기" }));
    expect(screen.queryByText("두 번째 발언")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 적용" }));
    expect(screen.getByText("두 번째 발언")).toBeTruthy();
    await waitFor(() => expect(host.requests.some((r) => r.method === "set")).toBe(true));
    deck.dispose();
  });
  it("never writes empty state after a load failure", async () => {
    const host = createMockHost({
      module: { id: "meeting-note", version: "0.1.0" },
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
