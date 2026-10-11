// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
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
async function open(saved: unknown = null) {
  const store = new Map<string, unknown>([[STATE_KEY, saved]]),
    bytes = new TextEncoder().encode(JSON.stringify(imported));
  let failure = "";
  const origin = "http://deckmod.quick-note.modules.localhost";
  const host = createMockHost({
    module: { id: "quick-note", version: "0.1.0" },
    granted: ["storage", "fs"],
    handlers: {
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
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
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
    view,
    store,
    fail: (value: string) => {
      failure = value;
    },
  };
}
function fill(title: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "제목 (선택)" }), { target: { value: title } });
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), { target: { value: "입력한 합성 내용" } });
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
  fill("합성 새 항목");
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
  expect(screen.getByText("합성 새 항목")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "메모 검색" }), { target: { value: "없는검색" } });
  expect(screen.queryByText("합성 새 항목")).toBeNull();
  f.view.unmount();
  f.deck.dispose();
  const reopened = await open(f.store.get(STATE_KEY));
  fireEvent.click(screen.getByLabelText("보관함 보기"));
  expect(screen.getByText("합성 새 항목")).toBeTruthy();
  reopened.view.unmount();
  reopened.deck.dispose();
});
it("cancels a verified import without replacing storage or losing an input draft", async () => {
  const f = await open();
  fill("보존할 초안");
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
  expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(true);
  f.fail("");
  dialog = await preview();
  fireEvent.click(within(dialog).getByRole("button", { name: "확인하고 복원" }));
  await screen.findByText("백업을 복원했어요. 이전 저장값은 별도 복구 키에 보존했어요.");
  await waitFor(() => expect(globalThis.document.querySelector('[role="dialog"]')).toBeNull());
  expect(f.store.get(STATE_KEY)).toEqual(imported);
  expect([...f.store.entries()].some(([key, value]) => key.startsWith("recovery.") && value === damaged)).toBe(true);
  expect((screen.getByRole("button", { name: "메모 저장" }) as HTMLButtonElement).disabled).toBe(false);
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
  fill("보존할 초안");
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await screen.findByText("입력 중인 내용을 먼저 저장하거나 입력 취소를 눌러 주세요.");
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("보존할 초안");
  fireEvent.click(screen.getByRole("button", { name: "입력 취소" }));
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  expect((screen.getByRole("textbox", { name: "제목 (선택)" }) as HTMLInputElement).value).toBe("합성 메모");
  f.view.unmount();
  f.deck.dispose();
});
