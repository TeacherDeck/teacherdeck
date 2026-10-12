// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
// Shell-level handshake: opening a tool from the deck must answer its `hello` with `init`
// (BRG-003). Without init the module shows "도구를 시작하지 못했어요" after its timeout. Kept-alive
// tools must keep their iframe window: a moved iframe reloads as a window the bridge never saw.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => window.localStorage.setItem("deck.shell.motion", "off"));
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
