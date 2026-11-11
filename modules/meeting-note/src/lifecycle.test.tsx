// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { emptyMeeting, type Meeting } from "./meeting.ts";
import { MEETING_KEY } from "./storage.ts";

afterEach(cleanup);

const seed = (): Meeting => ({ ...emptyMeeting(), speakers: ["합성 화자"], selected: "합성 화자" });
const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = () => done();
  });
  return { promise, resolve };
};

async function open(
  state = seed(),
  hooks: { state?: (dirty: boolean) => Promise<void>; write?: () => Promise<void> } = {},
) {
  const values = new Map<string, unknown>([[MEETING_KEY, state]]);
  const host = createMockHost({
    module: { id: "meeting-note", version: "0.7.0" },
    granted: ["storage", "window", "fs"],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "meeting-document" }),
      "window.setDocumentState": async (args) => {
        await hooks.state?.((args as { dirty: boolean }).dirty);
        return null;
      },
      "window.completeDocumentSave": () => null,
      "storage.get": (args) => values.get((args as { key: string }).key) ?? null,
      "storage.set": async (args) => {
        const { key, value } = args as { key: string; value: unknown };
        await hooks.write?.();
        values.set(key, value);
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
  await screen.findByRole("textbox", { name: "발언 입력" });
  const requestSave = async (requestId: string) => {
    await act(async () => host.emit("window.documentSaveRequested", { documentHandle: "meeting-document", requestId }));
    await waitFor(() =>
      expect(
        host.requests.some(
          (request) =>
            request.method === "completeDocumentSave" &&
            (request.args as { requestId: string }).requestId === requestId,
        ),
      ).toBe(true),
    );
    return host.requests.find(
      (request) =>
        request.method === "completeDocumentSave" && (request.args as { requestId: string }).requestId === requestId,
    )?.args;
  };
  return {
    host,
    deck,
    view,
    values,
    requestSave,
    close: () => {
      view.unmount();
      deck.dispose();
    },
  };
}

describe("meeting document lifetime", () => {
  it("waits for the first dirty acknowledgement and the actual write before completing a close save", async () => {
    const dirty = deferred();
    const write = deferred();
    const f = await open(seed(), {
      state: (value) => (value ? dirty.promise : Promise.resolve()),
      write: () => write.promise,
    });
    const input = screen.getByRole("textbox", { name: "발언 입력" }) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "응답 대기 중 합성 초안" } });
      f.host.emit("window.documentSaveRequested", { documentHandle: "meeting-document", requestId: "leave" });
    });
    expect(input.value).toBe("");
    expect(f.host.requests.some((request) => request.method === "set")).toBe(false);
    await act(async () => dirty.resolve());
    await waitFor(() => expect(f.host.requests.some((request) => request.method === "set")).toBe(true));
    expect(f.host.requests.some((request) => request.method === "completeDocumentSave")).toBe(false);
    expect(input.value).toBe("응답 대기 중 합성 초안");
    await act(async () => write.resolve());
    await waitFor(() =>
      expect(f.host.requests.find((request) => request.method === "completeDocumentSave")?.args).toEqual({
        documentHandle: "meeting-document",
        requestId: "leave",
        saved: true,
      }),
    );
    expect(f.values.get(MEETING_KEY)).toMatchObject({ draft: "응답 대기 중 합성 초안" });
    f.close();
  });

  it("keeps a failed write dirty, preserves the input and completes a later retry", async () => {
    let fail = true;
    const f = await open(seed(), {
      write: async () => {
        if (fail) throw new Error("SYNTHETIC_QUOTA");
      },
    });
    const input = screen.getByRole("textbox", { name: "발언 입력" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(input, { target: { value: "다시 저장할 합성 초안" } }));
    expect(await f.requestSave("failed")).toMatchObject({ saved: false });
    expect(input.value).toBe("다시 저장할 합성 초안");
    expect(f.host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: true,
      saving: false,
    });
    fail = false;
    expect(await f.requestSave("retry")).toMatchObject({ saved: true });
    expect(f.values.get(MEETING_KEY)).toMatchObject({ draft: "다시 저장할 합성 초안" });
    f.close();
  });

  it("does not lose an unfinished record edit or overwrite the separate new-statement draft", async () => {
    const state: Meeting = {
      ...seed(),
      draft: "다음 발언 초안",
      entries: [
        {
          id: "synthetic-entry",
          kind: "발언",
          text: "합성 기존 기록",
          speaker: "합성 화자",
          private: false,
          owner: "",
          due: "",
        },
      ],
    };
    const f = await open(state);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "합성 기존 기록 수정" })));
    await act(async () =>
      fireEvent.change(screen.getByRole("textbox", { name: "발언 입력" }), {
        target: { value: "아직 적용하지 않은 수정" },
      }),
    );
    expect(await f.requestSave("editing")).toMatchObject({ saved: false });
    expect((screen.getByRole("textbox", { name: "발언 입력" }) as HTMLTextAreaElement).value).toBe(
      "아직 적용하지 않은 수정",
    );
    expect(f.values.get(MEETING_KEY)).toMatchObject({ draft: "다음 발언 초안", entries: [{ text: "합성 기존 기록" }] });
    expect(
      screen.getByText("기록을 수정하고 있어요. 수정 저장 또는 수정 취소를 누른 뒤 다시 저장해 주세요."),
    ).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "수정 저장" })));
    expect(await f.requestSave("applied")).toMatchObject({ saved: true });
    expect(f.values.get(MEETING_KEY)).toMatchObject({
      draft: "다음 발언 초안",
      entries: [{ text: "아직 적용하지 않은 수정" }],
    });
    f.close();
  });

  it("keeps an unfinished attendee form when reopening it and blocks closing until it is applied", async () => {
    const f = await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "참석자 (F9)" })));
    await act(async () =>
      fireEvent.change(screen.getByRole("textbox", { name: "참석자" }), {
        target: { value: "합성 화자\n추가 합성 화자" },
      }),
    );
    await act(async () => fireEvent.keyDown(window, { code: "Escape" }));
    expect(await f.requestSave("people")).toMatchObject({ saved: false });
    await act(async () => fireEvent.keyDown(window, { code: "F9" }));
    const people = await screen.findByRole("textbox", { name: "참석자" });
    expect((people as HTMLTextAreaElement).value).toBe("합성 화자\n추가 합성 화자");
    await act(async () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" })));
    expect(await f.requestSave("people-applied")).toMatchObject({ saved: true });
    expect(f.values.get(MEETING_KEY)).toMatchObject({ speakers: ["합성 화자", "추가 합성 화자"] });
    f.close();
  });

  it("keeps draft kind and privacy through hide/show and requires recording them before a close save", async () => {
    const f = await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "종류 · 비공개 선택" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "결정" })));
    await act(async () => fireEvent.click(screen.getByRole("checkbox", { name: "비공개 메모" })));
    await act(async () =>
      fireEvent.change(screen.getByRole("textbox", { name: "발언 입력" }), { target: { value: "합성 비공개 결정" } }),
    );
    await act(async () => {
      f.host.emit("module.visibility", { visible: false });
      f.host.emit("module.visibility", { visible: true });
    });
    expect(await f.requestSave("composer")).toMatchObject({ saved: false });
    expect((screen.getByRole("textbox", { name: "발언 입력" }) as HTMLTextAreaElement).value).toBe("합성 비공개 결정");
    expect(screen.getByRole("button", { name: "결정" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("checkbox", { name: "비공개 메모" }) as HTMLInputElement).checked).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "기록" })));
    expect(await f.requestSave("recorded")).toMatchObject({ saved: true });
    expect(f.values.get(MEETING_KEY)).toMatchObject({
      entries: [{ text: "합성 비공개 결정", kind: "결정", private: true }],
    });
    f.close();
  });

  it("does not apply the first edit if document protection cannot be acknowledged", async () => {
    const f = await open(seed(), {
      state: async () => {
        throw new Error("SYNTHETIC_PROTECTION_FAILURE");
      },
    });
    const input = screen.getByRole("textbox", { name: "발언 입력" }) as HTMLTextAreaElement;
    await act(async () => fireEvent.change(input, { target: { value: "승인되지 않은 합성 편집" } }));
    expect(input.value).toBe("");
    expect(f.values.get(MEETING_KEY)).toMatchObject({ draft: "" });
    expect(f.host.requests.some((request) => request.method === "set")).toBe(false);
    f.close();
  });
});
