// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
// Shell-level handshake: opening a tool from the deck must answer its `hello` with `init`
// (BRG-003). Without init the module shows "도구를 시작하지 못했어요" after its timeout. Kept-alive
// tools must keep their iframe window: a moved iframe reloads as a window the bridge never saw.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "@deck/sdk";
import type { ModuleEntry } from "./generated/ModuleEntry.ts";

const entry = (id: string, name: string, keepAlive = false, publicWindow = false): ModuleEntry => ({
  resolution: {
    id,
    state: "ready",
    picked: { version: "0.1.0", source: "bundled" },
    newest: "0.1.0",
    unmetRequires: [],
    unmetOptional: [],
  },
  manifest: {
    manifestVersion: 1,
    id,
    name,
    description: "합성 도구 설명",
    version: "0.1.0",
    category: "classroom",
    icon: "icon.svg",
    entry: "index.html",
    authors: [{ name: "합성 기여자" }],
    requires: publicWindow ? { window: "^1.0.0" } : {},
    optional: {},
    ...(keepAlive ? { ui: { keepAlive: true } } : {}),
  },
  entryUrl: `http://deckmod.${id}.modules.localhost/${id}/0.1.0/index.html`,
  iconUrl: null,
});

const noop = () => Promise.resolve(() => undefined);
vi.mock("./host.ts", () => ({
  host: {
    shellInfo: vi.fn(() =>
      Promise.resolve({
        appVersion: "0.2.2",
        mica: false,
        caps: {},
        moduleOrigin: "http://deckmod.localhost",
        dev: false,
        secProbe: false,
      }),
    ),
    listModules: vi.fn(() =>
      Promise.resolve([
        entry("sample-timer", "합성 타이머", false, true),
        entry("sample-clock", "합성 시계", true),
        entry("sample-notes", "합성 메모", true),
      ]),
    ),
    moduleActivated: vi.fn(() => Promise.resolve([])),
    moduleGranted: vi.fn(() => Promise.resolve([])),
    moduleVisibility: vi.fn(() => Promise.resolve()),
    moduleUnloaded: vi.fn(() => Promise.resolve()),
    modulesUnloaded: vi.fn(() => Promise.resolve()),
    documentAction: vi.fn(() => Promise.resolve({ state: null, requestId: null, saved: null })),
    onDocumentExit: vi.fn(noop),
    hostInvoke: vi.fn(() => Promise.resolve(null)),
    checkUpdate: vi.fn(),
    installUpdate: vi.fn(),
    restartApp: vi.fn(),
    secProbeReport: vi.fn(),
    onModuleEvent: vi.fn(noop),
    onShowModule: vi.fn(noop),
    onFsDropped: vi.fn(noop),
  },
  // Global dialogs from the school data and messaging services poll for pending requests.
  schoolDataHost: { pending: vi.fn(() => Promise.resolve([])), resolveAccess: vi.fn() },
  messagingConfirmationHost: { pending: vi.fn(() => Promise.resolve([])), resolve: vi.fn() },
  windowControls: {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    onResized: vi.fn(noop),
  },
}));

const { App } = await import("./App.tsx");
const { host } = await import("./host.ts");

beforeEach(() => {
  window.localStorage.setItem("deck.shell.motion", "off");
  vi.mocked(host.documentAction).mockReset().mockResolvedValue({ state: null, requestId: null, saved: null });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function openTool() {
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "합성 타이머 열기" }));
  const frame = (await screen.findByTitle("합성 타이머")) as HTMLIFrameElement;
  const win = frame.contentWindow;
  if (win === null) throw new Error("iframe window missing");
  return win;
}

async function documentDialog() {
  const dialog = await screen.findByRole("dialog", { name: "작업을 저장할까요?" });
  // Match the common ContentDialog fixture: jsdom needs Tabster registration
  // and explicit action focus before modal buttons become accessible.
  await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
  const action = dialog.querySelector("button");
  if (action === null) throw new Error("document dialog action missing");
  action.focus();
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "취소" })).toBeTruthy());
  return dialog;
}

function hello(win: Window, id = "sample-timer") {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { deck: PROTOCOL_VERSION, kind: "hello", sdk: "test" },
      origin: `http://deckmod.${id}.modules.localhost`,
      source: win,
    }),
  );
}

const frameWindow = (name: string) => (screen.getByTitle(name) as HTMLIFrameElement).contentWindow;

async function open(name: string) {
  const back = screen.queryByRole("button", { name: "뒤로" });
  if (back !== null && screen.queryByRole("navigation", { name: "메뉴" }) === null) fireEvent.click(back);
  fireEvent.click(await screen.findByRole("button", { name: `${name} 열기` }));
  await screen.findByTitle(name);
  await waitFor(() => expect(screen.getByTitle(name).getAttribute("aria-hidden")).toBe("false"));
}

describe("tool handshake", () => {
  it("forwards public-window lifecycle events only to the declared owning module", async () => {
    const win = await openTool();
    const post = vi.spyOn(win, "postMessage");
    act(() => hello(win));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), expect.any(String)),
    );
    post.mockClear();
    const deliver = vi.mocked(host.onModuleEvent).mock.calls.at(-1)?.[0];
    if (!deliver) throw new Error("module event subscription missing");
    act(() => {
      deliver({
        moduleId: "sample-notes",
        topic: "window.presentationClosed",
        payload: { presentationHandle: "foreign" },
      });
      deliver({
        moduleId: "sample-timer",
        topic: "window.presentationClosed",
        payload: { presentationHandle: "owned" },
      });
      deliver({
        moduleId: "sample-timer",
        topic: "window.presentationDisconnected",
        payload: { presentationHandle: "owned" },
      });
    });
    expect(post.mock.calls.map(([event]) => event)).toEqual([
      {
        deck: PROTOCOL_VERSION,
        kind: "evt",
        topic: "window.presentationClosed",
        payload: { presentationHandle: "owned" },
      },
      {
        deck: PROTOCOL_VERSION,
        kind: "evt",
        topic: "window.presentationDisconnected",
        payload: { presentationHandle: "owned" },
      },
    ]);
  });
  it("answers hello with init right after opening a tool", async () => {
    const win = await openTool();
    const post = vi.spyOn(win, "postMessage");
    act(() => hello(win));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "init" }),
        "http://deckmod.sample-timer.modules.localhost",
      ),
    );
  });

  it("still answers when the tool says hello a few seconds later", async () => {
    const win = await openTool();
    const post = vi.spyOn(win, "postMessage");
    await act(() => new Promise((r) => setTimeout(r, 1500)));
    act(() => hello(win));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), expect.any(String)),
    );
  });

  it("keeps kept-alive tool windows while switching between them", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "합성 시계 열기" });
    await open("합성 시계");
    await open("합성 메모");
    const clock = frameWindow("합성 시계");
    const notes = frameWindow("합성 메모");
    // Switching back and forth reorders the most-recently-used list; the iframes must not move.
    await open("합성 시계");
    await open("합성 메모");
    await open("합성 시계");
    expect(frameWindow("합성 시계")).toBe(clock);
    expect(frameWindow("합성 메모")).toBe(notes);
    // A reloaded tool says hello again from the same window and gets init back.
    const win = frameWindow("합성 시계");
    if (win === null) throw new Error("iframe window missing");
    const post = vi.spyOn(win, "postMessage");
    act(() => hello(win, "sample-clock"));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), expect.any(String)),
    );
  });
});
it("keeps foreground ownership when a hidden tool says hello late", async () => {
  render(<App />);
  await open("합성 시계");
  const a = frameWindow("합성 시계");
  if (a === null) throw new Error("iframe window missing");
  const postA = vi.spyOn(a, "postMessage");
  await open("합성 메모");
  const b = frameWindow("합성 메모");
  if (b === null) throw new Error("iframe window missing");
  const postB = vi.spyOn(b, "postMessage");
  act(() => hello(b, "sample-notes"));
  await waitFor(() =>
    expect(postB).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), expect.any(String)),
  );
  expect(vi.mocked(host.moduleActivated).mock.calls.at(-1)?.[0]).toBe("sample-notes");
  act(() => hello(a, "sample-clock"));
  await waitFor(() =>
    expect(postA).toHaveBeenCalledWith(expect.objectContaining({ kind: "init" }), expect.any(String)),
  );
  expect(vi.mocked(host.moduleActivated).mock.calls.at(-1)?.[0]).toBe("sample-notes");
  expect(screen.getByTitle("합성 시계").getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByTitle("합성 메모").getAttribute("aria-hidden")).toBe("false");
  const deliver = vi.mocked(host.onFsDropped).mock.calls.at(-1)?.[0];
  if (deliver === undefined) throw new Error("file drop subscription missing");
  postA.mockClear();
  postB.mockClear();
  act(() => deliver({ moduleId: "sample-clock", payload: { files: [] } }));
  expect(postA).not.toHaveBeenCalled();
  expect(postB).not.toHaveBeenCalled();
  act(() => deliver({ moduleId: "sample-notes", payload: { files: [] } }));
  expect(postB).toHaveBeenCalledWith(expect.objectContaining({ kind: "evt", topic: "fs.dropped" }), expect.any(String));
  expect(host.moduleGranted).toHaveBeenCalledWith("sample-clock");
});

it("serializes foreground IPC updates across rapid navigation", async () => {
  let releaseFirst!: (caps: string[]) => void;
  vi.mocked(host.moduleActivated).mockClear();
  vi.mocked(host.moduleActivated).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
  );
  render(<App />);
  await open("합성 시계");
  await waitFor(() => expect(host.moduleActivated).toHaveBeenCalledTimes(1));
  await open("합성 메모");
  expect(host.moduleActivated).toHaveBeenCalledTimes(1);
  await act(async () => releaseFirst([]));
  await waitFor(() => expect(vi.mocked(host.moduleActivated).mock.calls.at(-1)?.[0]).toBe("sample-notes"));
  expect(vi.mocked(host.moduleActivated).mock.calls.map(([id]) => id)).toEqual(["sample-clock", null, "sample-notes"]);
});

it("keeps an unsaved iframe and restores browser history when leaving is cancelled", async () => {
  const win = await openTool();
  vi.mocked(host.moduleUnloaded).mockClear();
  vi.mocked(host.modulesUnloaded).mockClear();
  vi.mocked(host.documentAction).mockImplementation(async (_owner, action) => ({
    state: { documentHandle: "synthetic-document", dirty: true, saving: false },
    requestId: action.kind === "prepare" ? "synthetic-leave" : null,
    saved: null,
  }));
  fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
  const dialog = await documentDialog();
  expect(frameWindow("합성 타이머")).toBe(win);
  expect(screen.getByTitle("합성 타이머").closest("[inert]")).not.toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(screen.getByTitle("합성 타이머").closest("[inert]")).toBeNull());
  await waitFor(() => expect(window.history.state).toEqual({ page: { kind: "module", id: "sample-timer" }, index: 1 }));
  expect(frameWindow("합성 타이머")).toBe(win);
  expect(host.moduleUnloaded).not.toHaveBeenCalled();
  expect(host.modulesUnloaded).not.toHaveBeenCalled();
});

it("hides protected keepAlive work without a save prompt and evicts an idle frame first", async () => {
  vi.mocked(host.listModules).mockResolvedValueOnce([
    entry("sample-running", "실행 중 타이머", true),
    entry("sample-idle-a", "대기 도구 가", true),
    entry("sample-idle-b", "대기 도구 나", true),
    entry("sample-idle-c", "대기 도구 다", true),
  ]);
  render(<App />);
  await open("실행 중 타이머");
  const running = frameWindow("실행 중 타이머");
  vi.mocked(host.documentAction).mockImplementation(async (owner, action) => ({
    state: owner === "sample-running" ? { documentHandle: "running", dirty: true, saving: false } : null,
    requestId: action.kind === "prepare" && owner === "sample-running" ? "leave" : null,
    saved: null,
  }));
  for (const name of ["대기 도구 가", "대기 도구 나", "대기 도구 다"]) await open(name);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(frameWindow("실행 중 타이머")).toBe(running);
  expect(screen.queryByTitle("대기 도구 가")).toBeNull();
  expect(screen.getByTitle("실행 중 타이머").getAttribute("aria-hidden")).toBe("true");
});

it("native exit cancellation resolves the host token without closing or unloading", async () => {
  await openTool();
  vi.mocked(host.moduleUnloaded).mockClear();
  vi.mocked(host.modulesUnloaded).mockClear();
  vi.mocked(host.documentAction).mockImplementation(async (_owner, action) => ({
    state: { documentHandle: "synthetic-document", dirty: true, saving: false },
    requestId: action.kind === "prepare" ? "synthetic-leave" : null,
    saved: null,
  }));
  const deliver = vi.mocked(host.onDocumentExit).mock.calls.at(-1)?.[0];
  if (deliver === undefined) throw new Error("native exit subscription missing");
  act(() => deliver({ requestId: "synthetic-exit", action: "exit" }));
  const dialog = await documentDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
  await waitFor(() =>
    expect(host.documentAction).toHaveBeenCalledWith("", {
      kind: "resolveExit",
      requestId: "synthetic-exit",
      proceed: false,
    }),
  );
  expect(host.moduleUnloaded).not.toHaveBeenCalled();
  expect(host.modulesUnloaded).not.toHaveBeenCalled();
});

it("blocks another edit after discard confirmation until host cleanup finishes", async () => {
  await openTool();
  let finishUnload!: () => void;
  vi.mocked(host.moduleUnloaded).mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        finishUnload = () => resolve(undefined);
      }),
  );
  vi.mocked(host.documentAction).mockImplementation(async (_owner, action) =>
    action.kind === "prepare"
      ? {
          state: { documentHandle: "synthetic-document", dirty: true, saving: false },
          requestId: "synthetic-leave",
          saved: null,
        }
      : { state: null, requestId: null, saved: null },
  );
  fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
  const dialog = await documentDialog();
  fireEvent.click(within(dialog).getByRole("button", { name: "버리기" }));
  await waitFor(() => expect(finishUnload).toBeTypeOf("function"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTitle("합성 타이머").closest("[inert]")).not.toBeNull();
  await act(async () => finishUnload());
  await waitFor(() => expect(screen.queryByTitle("합성 타이머")).toBeNull());
});
