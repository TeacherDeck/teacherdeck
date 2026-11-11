// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { StrictMode } from "react";
import { emptyDocument, STATE_KEY, type Item } from "./logic.ts";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const imported = {
  ...emptyDocument(),
  items: [
    {
      id: "one",
      title: "합성 메모",
      body: "기억할 내용",
      pinned: false,
      tone: "neutral",
      archived: false,
      updatedAt: "2026-10-11T00:00:00Z",
    } as Item,
  ],
};
async function open(saved: unknown = null, savedDraft: unknown = null) {
  const store = new Map<string, unknown>([
      [STATE_KEY, saved],
      ["draft.v1", savedDraft],
    ]),
    bytes = new TextEncoder().encode(JSON.stringify(imported));
  let failure = "";
  const origin = "http://deckmod.quick-note.modules.localhost";
  const host = createMockHost({
    module: { id: "quick-note", version: "0.1.0" },
    granted: ["storage", "fs", "window"],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "document" }),
      "window.setDocumentState": () => null,
      "window.completeDocumentSave": () => null,
      "storage.get": (a) => store.get((a as { key: string }).key) ?? null,
      "storage.keys": () => [...store.keys()],
      "storage.set": (a) => {
        const args = a as { key: string; value: unknown };
        if (args.key === failure || (failure === "recovery" && args.key.startsWith("recovery.")))
          throw new DeckCallError("INTERNAL", "합성 오류");
        store.set(args.key, args.value);
        return null;
      },
      "fs.pickFiles": () => [{ handle: "input", size: bytes.length }],
      "fs.openRead": () => ({
        readId: "read",
        size: bytes.length,
        chunkBytes: 64,
        url: origin + "/_resources/" + "a".repeat(32),
      }),
      "fs.closeRead": () => null,
    },
  });
  host.window.location = { origin };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const q = new URL(url).searchParams;
      const offset = Number(q.get("offset"));
      return new Response(bytes.slice(offset, offset + Number(q.get("length"))));
    }),
  );
  const deck = await connect({ window: host.window });
  const view = render(
    <StrictMode>
      <DeckProvider>
        <App deck={deck} />
      </DeckProvider>
    </StrictMode>,
  );
  await screen.findByRole("heading", { name: "빠른 메모" });
  if (saved && "broken" in (saved as object)) {
    await screen.findByText(/저장 자료를 읽지 못했어요/);
  } else {
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(false),
    );
  }
  return {
    deck,
    host,
    view,
    store,
    fail: (value: string) => {
      failure = value;
    },
  };
}
async function fill(title: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "제목 (선택)" }), { target: { value: title } });
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), { target: { value: "입력한 합성 내용" } });
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe(title),
  );
}
async function preview() {
  const trigger = screen.getByRole("button", { name: "JSON 백업 가져오기" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "메모 백업 확인" });
  await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
  (dialog.querySelector("button") as HTMLButtonElement).focus();
  await within(dialog).findByRole("button", { name: "취소" });
  return dialog;
}
it("preserves unsaved input on failed save and persists archive/search edits after explicit retry", async () => {
  const f = await open();
  await fill("합성 새 항목");
  f.fail(STATE_KEY);
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await screen.findByText(/작업하지 못했어요/);
  expect((screen.getByRole("textbox", { name: "메모 내용" }) as HTMLInputElement).value).toBe("입력한 합성 내용");
  expect(f.store.get(STATE_KEY)).toBeNull();
  f.fail("");
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await screen.findByText("이 PC에 저장했어요.");
  expect((f.store.get(STATE_KEY) as { items: Item[] }).items).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "보관" }));
  await waitFor(() => expect((f.store.get(STATE_KEY) as { items: Item[] }).items[0]?.archived).toBe(true));
  fireEvent.click(screen.getByLabelText("보관함 보기"));
  expect(within(screen.getByLabelText("저장한 메모")).getByText("합성 새 항목")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "메모 검색" }), { target: { value: "없는검색" } });
  expect(screen.queryByText("합성 새 항목")).toBeNull();
  f.view.unmount();
  f.deck.dispose();
  const reopened = await open(f.store.get(STATE_KEY));
  fireEvent.click(screen.getByLabelText("보관함 보기"));
  expect(within(screen.getByLabelText("저장한 메모")).getByText("합성 새 항목")).toBeTruthy();
  reopened.view.unmount();
  reopened.deck.dispose();
});
it("cancels a verified import without replacing storage or losing an input draft", async () => {
  const f = await open();
  await fill("보존할 초안");
  fireEvent.click(screen.getByText("백업 · 가져오기"));
  const dialog = await preview();
  expect(within(dialog).getByText("합성 메모")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull());
  expect(f.store.get(STATE_KEY)).toBeNull();
  expect(((await screen.findByRole("textbox", { name: "제목 (선택)" })) as HTMLInputElement).value).toBe("보존할 초안");
  f.view.unmount();
  f.deck.dispose();
});

it("offers twenty compact entries with one set of actions, full selected text and protected drafts", async () => {
  const items = Array.from({ length: 20 }, (_, index): Item => ({
    ...(imported.items[0] as Item),
    id: `note-${index}`,
    title: `합성 메모 ${index}`,
    body: `긴 본문 ${index}\n` + "합성 내용 ".repeat(120),
    tone: index === 4 ? "blue" : "neutral",
  }));
  const f = await open({ ...emptyDocument(), items });
  const list = screen.getByLabelText("저장한 메모");
  expect(within(list).getAllByText(/^합성 메모 \d+$/)).toHaveLength(20);
  for (const name of ["수정", "항목 백업 저장", "고정", "보관"])
    expect(screen.getAllByRole("button", { name })).toHaveLength(1);
  expect(within(list).queryByRole("button")).toBeNull();
  const row = within(list)
    .getByText("합성 메모 4")
    .closest<HTMLElement>("[role='option'],[role='listitem']") as HTMLElement;
  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "선택한 메모 전문" }) as HTMLTextAreaElement).value).toBe(
      items[4]?.body,
    ),
  );
  expect((screen.getByRole("textbox", { name: "선택한 메모 전문" }) as HTMLTextAreaElement).readOnly).toBe(true);
  await fill("보존할 새 초안");
  fireEvent.click(within(list).getByText("합성 메모 5"));
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("보존할 새 초안");
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByText("입력 중인 내용을 먼저 저장하거나 입력 취소를 눌러 주세요.");
  expect(f.store.get(STATE_KEY)).toEqual({ ...emptyDocument(), items });
  f.view.unmount();
  f.deck.dispose();
});

it("returns focus to the same list after Ctrl+Enter edits and the adjacent note after archiving", async () => {
  const items = [0, 1, 2].map((index): Item => ({
    ...(imported.items[0] as Item),
    id: `note-${index}`,
    title: `위치 ${index}`,
  }));
  const f = await open({ ...emptyDocument(), items });
  const list = screen.getByLabelText("저장한 메모");
  fireEvent.click(within(list).getByText("위치 1"));
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByRole("button", { name: "수정 저장" });
  const input = screen.getByRole("textbox", { name: "메모 내용" });
  expect(globalThis.document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "수정한 합성 내용" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true });
  expect((f.store.get(STATE_KEY) as { items: Item[] }).items[1]?.body).toBe("기억할 내용");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  await waitFor(() =>
    expect((f.store.get(STATE_KEY) as { items: Item[] }).items.find((item) => item.id === "note-1")?.body).toBe(
      "수정한 합성 내용",
    ),
  );
  await waitFor(() => expect(globalThis.document.activeElement?.textContent).toContain("위치 1"));
  expect(list.contains(globalThis.document.activeElement)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "보관" }));
  await waitFor(() =>
    expect((f.store.get(STATE_KEY) as { items: Item[] }).items.find((item) => item.id === "note-1")?.archived).toBe(
      true,
    ),
  );
  await waitFor(() => expect(globalThis.document.activeElement?.textContent).toContain("위치 0"));
  expect(list.contains(globalThis.document.activeElement)).toBe(true);
  fireEvent.click(screen.getByLabelText("보관함 보기"));
  expect(within(screen.getByRole("region", { name: "선택한 메모" })).getByText("위치 1")).toBeTruthy();
  f.view.unmount();
  f.deck.dispose();
});

it("reveals and focuses notes moved from a later page by editing or pinning", async () => {
  const items = Array.from({ length: 21 }, (_, index): Item => ({
    ...(imported.items[0] as Item),
    id: `page-${index}`,
    title: `페이지 메모 ${index}`,
  }));
  const f = await open({ ...emptyDocument(), items });
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByRole("button", { name: "수정 저장" });
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), { target: { value: "마지막 쪽의 수정 내용" } });
  fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
  await waitFor(() => expect(globalThis.document.activeElement?.textContent).toContain("페이지 메모 20"));
  expect((screen.getByRole("button", { name: "이전" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", { name: "선택한 메모 전문" }) as HTMLTextAreaElement).value).toBe(
    "마지막 쪽의 수정 내용",
  );
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "고정" }));
  await waitFor(() => expect(globalThis.document.activeElement?.textContent).toContain("페이지 메모 19"));
  expect((screen.getByRole("button", { name: "이전" }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(screen.getByRole("region", { name: "선택한 메모" })).getByText("페이지 메모 19")).toBeTruthy();
  f.view.unmount();
  f.deck.dispose();
});

it("returns focus to the composer after archiving the final visible note", async () => {
  const f = await open(imported);
  fireEvent.click(screen.getByRole("button", { name: "보관" }));
  await waitFor(() => expect((f.store.get(STATE_KEY) as { items: Item[] }).items[0]?.archived).toBe(true));
  await waitFor(() =>
    expect(globalThis.document.activeElement).toBe(screen.getByRole("textbox", { name: "메모 내용" })),
  );
  expect(screen.queryByRole("region", { name: "선택한 메모" })).toBeNull();
  fireEvent.click(screen.getByLabelText("보관함 보기"));
  expect(within(screen.getByLabelText("저장한 메모")).getByText("합성 메모")).toBeTruthy();
  f.view.unmount();
  f.deck.dispose();
});
it("keeps corrupt data locked if preservation fails and recovers only after explicit confirmation", async () => {
  const damaged = { broken: true },
    f = await open(damaged);
  expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("백업 · 가져오기"));
  let dialog = await preview();
  f.fail("recovery");
  fireEvent.click(within(dialog).getByRole("button", { name: "확인하고 복원" }));
  await screen.findByText(/작업하지 못했어요/);
  await waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull());
  expect(f.store.get(STATE_KEY)).toBe(damaged);
  // Fluent restores the background's accessibility a moment after the dialog leaves the DOM
  // (Tabster Modalizer); wait for it instead of racing it.
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(true),
  );
  f.fail("");
  dialog = await preview();
  fireEvent.click(within(dialog).getByRole("button", { name: "확인하고 복원" }));
  await screen.findByText("백업을 복원했어요. 이전 저장값은 별도 복구 키에 보존했어요.");
  await waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull());
  expect(f.store.get(STATE_KEY)).toEqual(imported);
  expect([...f.store.entries()].some(([key, value]) => key.startsWith("recovery.") && value === damaged)).toBe(true);
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(false),
  );
  f.view.unmount();
  f.deck.dispose();
});

it("adds an individual backup while preserving existing records and reminting a colliding identity", async () => {
  const f = await open(imported);
  fireEvent.click(screen.getByText("백업 · 가져오기"));
  const dialog = await preview();
  expect((within(dialog).getByLabelText("현재 목록에 추가") as HTMLInputElement).checked).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "확인하고 복원" }));
  await screen.findByText("백업을 복원했어요. 이전 저장값은 별도 복구 키에 보존했어요.");
  await waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull());
  const restored = f.store.get(STATE_KEY) as { items: Item[] };
  expect(restored.items).toHaveLength(2);
  expect(restored.items[0]).toEqual(imported.items[0]);
  expect(restored.items[1]?.id).not.toBe(imported.items[0]?.id);
  f.view.unmount();
  f.deck.dispose();
});

it("preserves a new unsaved draft before switching records and offers an explicit cancellation exit", async () => {
  const f = await open(imported);
  await fill("보존할 초안");
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByText("입력 중인 내용을 먼저 저장하거나 입력 취소를 눌러 주세요.");
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("보존할 초안");
  fireEvent.click(screen.getByRole("button", { name: "입력 취소" }));
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByRole("button", { name: "수정 저장" });
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("합성 메모");
  f.view.unmount();
  f.deck.dispose();
});

it("flushes an unfinished draft before leaving and restores it without adding a saved item", async () => {
  const f = await open();
  await fill("남겨 둘 초안");
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), { target: { value: "이어서 쓸 합성 초안" } });
  await waitFor(() =>
    expect((screen.getByRole("textbox", { name: "메모 내용" }) as HTMLInputElement).value).toBe("이어서 쓸 합성 초안"),
  );
  f.host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "leave" });
  await waitFor(() =>
    expect(f.host.requests.find((request) => request.method === "completeDocumentSave")?.args).toEqual({
      documentHandle: "document",
      requestId: "leave",
      saved: true,
    }),
  );
  const draft = f.store.get("draft.v1");
  expect(draft).toMatchObject({ title: "남겨 둘 초안", body: "이어서 쓸 합성 초안" });
  expect(f.store.get(STATE_KEY)).toBeNull();
  f.view.unmount();
  f.deck.dispose();
  const reopened = await open(null, draft);
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("남겨 둘 초안");
  reopened.view.unmount();
  reopened.deck.dispose();
});
it("keeps failed automatic draft writes protected and retries the exact input on exit", async () => {
  const f = await open();
  f.fail("draft.v1");
  await fill("실패해도 유지할 초안");
  await screen.findByText("초안을 저장하지 못했어요. 입력을 유지했으니 다시 저장해 주세요.");
  expect(f.host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toEqual({
    documentHandle: "document",
    dirty: true,
    saving: false,
  });
  f.fail("");
  f.host.emit("window.documentSaveRequested", { documentHandle: "document", requestId: "retry" });
  await waitFor(() =>
    expect(f.host.requests.find((request) => request.method === "completeDocumentSave")?.args).toEqual({
      documentHandle: "document",
      requestId: "retry",
      saved: true,
    }),
  );
  expect(f.store.get("draft.v1")).toMatchObject({ title: "실패해도 유지할 초안" });
  f.view.unmount();
  f.deck.dispose();
});
