// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError } from "@deck/sdk";
import { createMockHost, type MockHandler } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { createDocument, createPixelLayer, createRaster, createTextLayer } from "./core/model.ts";
import { FileOperationError } from "./files/index.ts";
import type { EditorDocument } from "./core/model.ts";
import type { ImportedDocument } from "./files/index.ts";
const files = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn(), read: vi.fn(), import: vi.fn(), export: vi.fn() }));
const previews = vi.hoisted(() => ({ dispose: vi.fn(), close: vi.fn() }));
const fonts = vi.hoisted(() => ({ available: vi.fn() }));
vi.mock("./files/index.ts", async (original) => ({
  ...(await original<typeof import("./files/index.ts")>()),
  readInput: files.read,
  importDocument: files.import,
  exportDocument: files.export,
  OutputSession: class {
    save = files.save;
    close = files.close;
  },
}));
vi.mock("./core/preview.ts", async (original) => ({
  ...(await original<typeof import("./core/preview.ts")>()),
  PreviewRenderer: class {
    dispose = previews.dispose;
    async render() {
      return { width: 8, height: 6, close: previews.close };
    }
  },
}));
vi.mock("./editor-ui.ts", async (original) => ({
  ...(await original<typeof import("./editor-ui.ts")>()),
  fontAvailable: fonts.available,
}));
// Canvas is verified in the browser; this suite exercises real controls and bridge lifecycle with a fake preview.
vi.mock("@deck/ui", async (original) => ({
  ...(await original<typeof import("@deck/ui")>()),
  CanvasSurface: ({
    alt,
    disabled,
    onGesture,
  }: {
    alt: string;
    disabled: boolean;
    onGesture: (event: {
      phase: "start" | "end";
      point: { x: number; y: number };
      shift: boolean;
      alt: boolean;
      ctrl: boolean;
    }) => void;
  }) => (
    <div
      role="img"
      aria-label={alt}
      onPointerDown={() => {
        if (!disabled) onGesture({ phase: "start", point: { x: 2, y: 2 }, shift: false, alt: false, ctrl: false });
      }}
      onPointerUp={() => onGesture({ phase: "end", point: { x: 3, y: 2 }, shift: false, alt: false, ctrl: false })}
    />
  ),
}));
const syntheticFile = { handle: "synthetic-input", name: "합성.psd", ext: "psd", size: 4, modifiedAt: 0 };
const syntheticFontSize = 2;
const syntheticFontFamily = "Arial";
const button = (name: string) =>
  screen.queryByLabelText(name, { selector: "button" }) ?? screen.getByRole("button", { name });
function importedText(fontFamily = "Arial"): ImportedDocument {
  const document = createDocument(8, 6);
  document.layers.push(
    createTextLayer({ content: "합성 원문", fontFamily, fontSize: syntheticFontSize, width: 4, height: 3 }),
  );
  return { document, fonts: [fontFamily], warnings: [], flattened: false };
}
async function setup(handlers: Record<string, MockHandler> = {}) {
  const host = createMockHost({
    module: { id: "advanced-image-editor", version: "0.1.0" },
    caps: { fs: "1.4.0", window: "1.2.0" },
    granted: ["fs", "window"],
    handlers: {
      "window.registerDocument": () => ({ documentHandle: "synthetic-document" }),
      "window.setDocumentState": () => null,
      "window.completeDocumentSave": () => null,
      "fs.pickFiles": () => [syntheticFile],
      ...handlers,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() => expect(button("파일 열기").hasAttribute("disabled")).toBe(false));
  return { host, deck, view };
}
async function openText() {
  fireEvent.click(button("파일 열기"));
  await screen.findByDisplayValue("합성 원문");
  await waitFor(() => expect(button("작업 저장").hasAttribute("disabled")).toBe(false));
}
async function changeText(content: string) {
  fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: content } });
  fireEvent.click(button("글자 적용"));
  await screen.findByText(/미저장 작업/);
}
beforeEach(() => {
  files.read.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
  files.import.mockImplementation(async () => importedText());
  files.export.mockImplementation(async (document: EditorDocument, format: string) => ({
    blob: new Blob(["synthetic"]),
    revision: document.revision,
    format,
  }));
  files.save.mockResolvedValue({
    handle: "synthetic-result",
    name: "합성.deckimage",
    ext: "deckimage",
    size: 9,
    modifiedAt: 0,
  });
  files.close.mockResolvedValue(undefined);
  fonts.available.mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("dropped editor inputs", () => {
  it("keeps the current document's input name after another dropped file fails to read", async () => {
    const { deck, host } = await setup();
    await openText();
    files.read.mockRejectedValueOnce(new FileOperationError("INVALID_FILE"));
    await act(async () => {
      host.emit("fs.dropped", { files: [{ ...syntheticFile, handle: "source-b", name: "합성 B.psd" }] });
    });
    await screen.findByText("작업을 마치지 못했어요. 파일 상태를 확인하고 다시 시도하세요.");
    expect(screen.getByText("입력 파일: 합성.psd")).toBeTruthy();
    expect(screen.queryByText("입력 파일: 합성 B.psd")).toBeNull();
    expect(screen.queryByText("입력 파일 확인 중: 합성 B.psd")).toBeNull();
    expect(screen.getByDisplayValue("합성 원문")).toBeTruthy();
    deck.dispose();
  });
  it("acknowledges a dropped file before reading without opening any picker", async () => {
    const { deck, host } = await setup();
    let finish: ((bytes: Uint8Array) => void) | undefined;
    files.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    files.import.mockResolvedValueOnce(importedText());
    await act(async () => {
      host.emit("fs.dropped", { files: [syntheticFile] });
    });
    expect(await screen.findByText("입력 파일 확인 중: 합성.psd")).toBeTruthy();
    expect(screen.getAllByText("합성.psd 파일 여는 중").length).toBeGreaterThan(0);
    expect(host.requests.some((r) => ["pickFiles", "pickFolder"].includes(r.method))).toBe(false);
    await act(async () => {
      finish?.(new Uint8Array([1, 2, 3, 4]));
    });
    await screen.findByDisplayValue("합성 원문");
    expect(files.read.mock.calls[0]?.[1]).toEqual(syntheticFile);
    deck.dispose();
  });
});
describe("advanced editor document lifecycle", () => {
  it("exposes named icon actions and switches tools by shortcut without consuming text or composition keys", async () => {
    const { deck, view } = await setup();
    await openText();
    const workspace = screen.getByRole("main");
    expect(screen.getByRole("navigation", { name: "편집 도구" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "문서 작업 영역" })).toBeTruthy();
    expect(button("작업 저장").querySelector("svg[aria-hidden='true']")).toBeTruthy();
    fireEvent.keyDown(workspace, { key: "b" });
    expect(button("브러시").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("빠른 브러시 크기")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("글자 내용"), { key: "e" });
    fireEvent.keyDown(workspace, { key: "c", isComposing: true });
    expect(button("브러시").getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(workspace, { key: "c" });
    expect(button("자르기").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("region", { name: "도구 설정 패널" })).toBeTruthy();
    expect(button("자르기 적용")).toBeTruthy();
    fireEvent.keyDown(workspace, { key: "v" });
    expect(button("이동").getAttribute("aria-pressed")).toBe("true");
    view.unmount();
    deck.dispose();
  });
  it("keeps an unapplied text draft across panel changes and saves it with Ctrl+S from the text field", async () => {
    const { deck, view } = await setup();
    await openText();
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "합성 패널 편집" } });
    await screen.findByText(/미저장 작업/);
    fireEvent.click(button("도구 설정"));
    expect(screen.queryByRole("region", { name: "레이어 속성 패널" })).toBeNull();
    fireEvent.click(button("속성"));
    await screen.findByDisplayValue("합성 패널 편집");
    fireEvent.keyDown(screen.getByLabelText("글자 내용"), { key: "s", ctrlKey: true });
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].text.content).toBe("합성 패널 편집");
    await screen.findByText(/변경 없음/);
    view.unmount();
    deck.dispose();
  });
  it("uses T to edit an existing text layer without adding another layer and ignores held shortcut repeats", async () => {
    const { deck, view } = await setup();
    await openText();
    const workspace = screen.getByRole("main");
    fireEvent.click(button("글자"));
    expect(screen.queryByLabelText("글자 내용")).toBeNull();
    fireEvent.keyDown(workspace, { key: "t" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("글자 내용")));
    fireEvent.keyDown(workspace, { key: "t", repeat: true });
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers).toHaveLength(1);
    view.unmount();
    deck.dispose();
  });
  it("does not commit an unapplied draft when the disabled redo shortcut is pressed", async () => {
    const { deck, view } = await setup();
    await openText();
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "합성 다시 실행 보호" } });
    await screen.findByText(/미저장 작업/);
    expect(button("다시 실행").hasAttribute("disabled")).toBe(true);
    expect(button("글자 적용").hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.keyDown(screen.getByRole("main"), { key: "z", ctrlKey: true, shiftKey: true }));
    expect(button("글자 적용").hasAttribute("disabled")).toBe(false);
    expect(screen.getByDisplayValue("합성 다시 실행 보호")).toBeTruthy();
    expect(files.export).not.toHaveBeenCalled();
    view.unmount();
    deck.dispose();
  });
  it("disables mutation controls during a protected brush stroke while allowing its pointer-up to finish", async () => {
    const document = createDocument(8, 6);
    document.layers.push(createPixelLayer(createRaster(8, 6), "합성 브러시 레이어"));
    files.import.mockResolvedValue({ document, fonts: [], warnings: [], flattened: false });
    let holding = false;
    let release: (() => void) | null = null;
    const { deck, view } = await setup({
      "window.setDocumentState": (args) =>
        holding && (args as { dirty: boolean }).dirty
          ? new Promise<null>((resolve) => {
              release = () => resolve(null);
            })
          : null,
    });
    fireEvent.click(button("파일 열기"));
    await screen.findByDisplayValue("합성 브러시 레이어");
    await waitFor(() => expect(button("작업 저장").hasAttribute("disabled")).toBe(false));
    fireEvent.click(button("브러시"));
    holding = true;
    fireEvent.pointerDown(screen.getByRole("img", { name: "이미지 편집 캔버스" }));
    await waitFor(() => expect(release).not.toBeNull());
    expect(button("레이어 삭제").hasAttribute("disabled")).toBe(true);
    expect(button("작업 저장").hasAttribute("disabled")).toBe(true);
    fireEvent.pointerUp(screen.getByRole("img", { name: "이미지 편집 캔버스" }));
    holding = false;
    await act(async () => (release as (() => void) | null)?.());
    await waitFor(() => expect(button("레이어 삭제").hasAttribute("disabled")).toBe(false));
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(
      files.export.mock.calls
        .at(-1)?.[0]
        .layers[0].pixels.data.some((value: number, index: number) => index % 4 === 3 && value > 0),
    ).toBe(true);
    view.unmount();
    deck.dispose();
  });
  it("restores a delayed accepted text draft after its response completes on another selected layer", async () => {
    const imported = importedText();
    const layerA = imported.document.layers[0];
    if (layerA) layerA.name = "합성 A 레이어";
    imported.document.layers.unshift(
      createTextLayer(
        { content: "합성 B 원문", fontFamily: syntheticFontFamily, fontSize: syntheticFontSize, width: 4, height: 3 },
        "합성 B 레이어",
      ),
    );
    files.import.mockResolvedValue(imported);
    let holding = false;
    const releases: (() => void)[] = [];
    const { deck, view } = await setup({
      "window.setDocumentState": (args) => {
        if (holding && (args as { dirty: boolean }).dirty) {
          return new Promise<null>((resolve) => releases.push(() => resolve(null)));
        }
        return null;
      },
    });
    await openText();
    holding = true;
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "합성 A 지연 편집" } });
    await waitFor(() => expect(releases).toHaveLength(1));
    fireEvent.click(screen.getByText("합성 B 레이어 · 글자"));
    await screen.findByDisplayValue("합성 B 원문");
    await act(async () => releases[0]?.());
    await waitFor(() => expect(releases).toHaveLength(2));
    holding = false;
    await act(async () => releases[1]?.());
    fireEvent.click(screen.getByText("합성 A 레이어 · 글자"));
    await screen.findByDisplayValue("합성 A 지연 편집");
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[1].text.content).toBe("합성 A 지연 편집");
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].text.content).toBe("합성 B 원문");
    await screen.findByText(/변경 없음/);
    view.unmount();
    deck.dispose();
  });
  it("keeps the newest rapid text input visible while an older draft completes a delayed host update", async () => {
    let holding = false;
    const releases: (() => void)[] = [];
    const { deck, view } = await setup({
      "window.setDocumentState": (args) => {
        if (holding && (args as { dirty: boolean }).dirty) {
          return new Promise<null>((resolve) => releases.push(() => resolve(null)));
        }
        return null;
      },
    });
    await openText();
    holding = true;
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "이전 합성 입력" } });
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "최신 합성 입력" } });
    await waitFor(() => expect(releases).toHaveLength(1));
    await act(async () => releases[0]?.());
    await waitFor(() => expect(releases).toHaveLength(2));
    expect((screen.getByLabelText("글자 내용") as HTMLTextAreaElement).value).toBe("최신 합성 입력");
    await act(async () => releases[1]?.());
    await waitFor(() => expect(releases).toHaveLength(3));
    expect((screen.getByLabelText("글자 내용") as HTMLTextAreaElement).value).toBe("최신 합성 입력");
    holding = false;
    await act(async () => releases[2]?.());
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].text.content).toBe("최신 합성 입력");
    await screen.findByText(/변경 없음/);
    view.unmount();
    deck.dispose();
  });
  it("keeps both rapid color changes while an older adjustment completes a delayed host update", async () => {
    const document = createDocument(8, 6);
    document.layers.push(createPixelLayer(createRaster(8, 6), "합성 이미지"));
    files.import.mockResolvedValue({ document, fonts: [], warnings: [], flattened: false });
    let holding = false;
    const releases: (() => void)[] = [];
    const { deck, view } = await setup({
      "window.setDocumentState": (args) => {
        if (holding && (args as { dirty: boolean }).dirty) {
          return new Promise<null>((resolve) => releases.push(() => resolve(null)));
        }
        return null;
      },
    });
    fireEvent.click(button("파일 열기"));
    await screen.findByDisplayValue("합성 이미지");
    fireEvent.click(button("색 보정"));
    await waitFor(() => expect(button("작업 저장").hasAttribute("disabled")).toBe(false));
    holding = true;
    fireEvent.change(screen.getByRole("slider", { name: "명도" }), { target: { value: "40" } });
    fireEvent.change(screen.getByRole("slider", { name: "대비" }), { target: { value: "25" } });
    await waitFor(() => expect(releases).toHaveLength(1));
    await act(async () => releases[0]?.());
    await waitFor(() => expect(releases).toHaveLength(2));
    expect((screen.getByRole("slider", { name: "대비" }) as HTMLInputElement).value).toBe("25");
    await act(async () => releases[1]?.());
    await waitFor(() => expect(releases).toHaveLength(3));
    expect((screen.getByRole("slider", { name: "명도" }) as HTMLInputElement).value).toBe("40");
    expect((screen.getByRole("slider", { name: "대비" }) as HTMLInputElement).value).toBe("25");
    holding = false;
    await act(async () => releases[2]?.());
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].adjustments).toMatchObject({
      brightness: 0.4,
      contrast: 0.25,
    });
    await screen.findByText(/변경 없음/);
    view.unmount();
    deck.dispose();
  });
  it("preserves saved text when undo protection fails and allows the same undo to succeed on retry", async () => {
    let rejectNext = false;
    let rejected = false;
    let acceptedDirty = false;
    const { host, deck, view } = await setup({
      "window.setDocumentState": (args) => {
        const state = args as { dirty: boolean };
        if (rejectNext && state.dirty) {
          rejectNext = false;
          rejected = true;
          throw new DeckCallError("INTERNAL", "synthetic protection rejection");
        }
        acceptedDirty = state.dirty;
        return null;
      },
    });
    await openText();
    await changeText("저장한 합성 편집");
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: false,
        saving: false,
      }),
    );
    expect(acceptedDirty).toBe(false);
    rejectNext = true;
    fireEvent.click(button("실행 취소"));
    await screen.findByText("작업을 마치지 못했어요. 파일 상태를 확인하고 다시 시도하세요.");
    expect(rejected).toBe(true);
    expect((screen.getByLabelText("글자 내용") as HTMLTextAreaElement).value).toBe("저장한 합성 편집");
    expect(screen.getByText(/변경 없음/)).toBeTruthy();
    expect(acceptedDirty).toBe(false);
    fireEvent.click(button("실행 취소"));
    await screen.findByDisplayValue("합성 원문");
    await screen.findByText(/미저장 작업/);
    expect(acceptedDirty).toBe(true);
    view.unmount();
    deck.dispose();
  });
  it("rolls an unprotected text draft back and exports the canonical text after the host rejects protection", async () => {
    let armed = false;
    let rejected = false;
    const { host, deck, view } = await setup({
      "window.setDocumentState": (args) => {
        if (armed && !rejected && (args as { dirty: boolean }).dirty) {
          rejected = true;
          throw new DeckCallError("INTERNAL", "synthetic protection rejection");
        }
        return null;
      },
    });
    await openText();
    armed = true;
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "보호되지 않은 합성 변경" } });
    await waitFor(() => expect(rejected).toBe(true));
    await screen.findByDisplayValue("합성 원문");
    expect(screen.getByText(/변경 없음/)).toBeTruthy();
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].text.content).toBe("합성 원문");
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: false,
        saving: false,
      }),
    );
    view.unmount();
    deck.dispose();
  });
  it("rolls an unprotected brightness draft back and never exports its rejected adjustment", async () => {
    const document = createDocument(8, 6);
    document.layers.push(createPixelLayer(createRaster(8, 6), "합성 이미지"));
    files.import.mockResolvedValue({ document, fonts: [], warnings: [], flattened: false });
    let armed = false;
    let rejected = false;
    const { host, deck, view } = await setup({
      "window.setDocumentState": (args) => {
        if (armed && !rejected && (args as { dirty: boolean }).dirty) {
          rejected = true;
          throw new DeckCallError("INTERNAL", "synthetic protection rejection");
        }
        return null;
      },
    });
    fireEvent.click(button("파일 열기"));
    await screen.findByDisplayValue("합성 이미지");
    fireEvent.click(button("색 보정"));
    await waitFor(() => expect(button("작업 저장").hasAttribute("disabled")).toBe(false));
    armed = true;
    fireEvent.change(screen.getByRole("slider", { name: "명도" }), { target: { value: "40" } });
    await waitFor(() => expect(rejected).toBe(true));
    await waitFor(() => expect((screen.getByRole("slider", { name: "명도" }) as HTMLInputElement).value).toBe("0"));
    expect(screen.getByText(/변경 없음/)).toBeTruthy();
    fireEvent.click(button("작업 저장"));
    await waitFor(() => expect(files.save).toHaveBeenCalledOnce());
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].adjustments.brightness).toBe(0);
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: false,
        saving: false,
      }),
    );
    view.unmount();
    deck.dispose();
  });
  it("protects unapplied text, retains the draft across layer changes and flushes it before native save", async () => {
    const imported = importedText();
    const textLayer = imported.document.layers[0];
    if (textLayer) textLayer.name = "합성 원문 레이어";
    imported.document.layers.unshift(
      createTextLayer(
        {
          content: "다른 합성 글자",
          fontFamily: syntheticFontFamily,
          fontSize: syntheticFontSize,
          width: 4,
          height: 3,
        },
        "다른 합성 레이어",
      ),
    );
    files.import.mockResolvedValue(imported);
    const { host, deck, view } = await setup();
    await openText();
    fireEvent.change(screen.getByLabelText("글자 내용"), { target: { value: "적용 전 합성 편집" } });
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: true,
      }),
    );
    expect(imported.document.layers[1]?.kind === "text" && imported.document.layers[1].text.content).toBe("합성 원문");
    fireEvent.click(screen.getByText("다른 합성 레이어 · 글자"));
    await screen.findByDisplayValue("다른 합성 글자");
    fireEvent.click(screen.getByText("합성 원문 레이어 · 글자"));
    await screen.findByDisplayValue("적용 전 합성 편집");
    fireEvent.click(button("작업 저장"));
    await screen.findByText(/변경 없음/);
    expect(files.export.mock.calls.at(-1)?.[0].layers[1].text.content).toBe("적용 전 합성 편집");
    expect(files.export.mock.calls.at(-1)?.[1]).toBe("deckimage");
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: false,
      saving: false,
    });
    fireEvent.click(button("실행 취소"));
    await screen.findByDisplayValue("합성 원문");
    await screen.findByText(/미저장 작업/);
    view.unmount();
    deck.dispose();
  });
  it("includes an unapplied brightness preview in native save and clears the protected dirty state", async () => {
    const document = createDocument(8, 6);
    document.layers.push(createPixelLayer(createRaster(8, 6), "합성 이미지"));
    files.import.mockResolvedValue({ document, fonts: [], warnings: [], flattened: false });
    const { host, deck, view } = await setup();
    fireEvent.click(button("파일 열기"));
    await screen.findByDisplayValue("합성 이미지");
    fireEvent.click(button("색 보정"));
    fireEvent.change(screen.getByRole("slider", { name: "명도" }), { target: { value: "40" } });
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: true,
      }),
    );
    expect(document.layers[0]?.kind === "pixel" && document.layers[0].adjustments.brightness).toBe(0);
    fireEvent.click(button("작업 저장"));
    await screen.findByText(/변경 없음/);
    expect(files.export.mock.calls.at(-1)?.[0].layers[0].adjustments.brightness).toBe(0.4);
    expect(files.export.mock.calls.at(-1)?.[1]).toBe("deckimage");
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: false,
      saving: false,
    });
    view.unmount();
    deck.dispose();
  });
  it("registers protection, edits existing text and keeps PNG export dirty", async () => {
    const { host, deck, view } = await setup();
    expect(host.requests.some((request) => request.method === "registerDocument")).toBe(true);
    await openText();
    await changeText("수정한 합성 글자\n두 번째 줄");
    fireEvent.click(button("내보내기"));
    await screen.findByText("새 파일로 내보냈어요. 편집 상태는 작업 파일로 저장하세요.");
    expect(files.export.mock.calls[0]?.[0].layers[0].text.content).toBe("수정한 합성 글자\n두 번째 줄");
    expect(files.export.mock.calls[0]?.[1]).toBe("png");
    expect(files.save.mock.calls[0]?.[3]).toBe(syntheticFile.handle);
    expect(files.close).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/미저장 작업/)).toBeTruthy();
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: true,
      saving: false,
    });
    view.unmount();
    deck.dispose();
  });
  it("clears dirty state after a host-requested native save and restores it on edits and undo", async () => {
    const { host, deck, view } = await setup();
    await openText();
    await changeText("수정한 합성 글자\n두 번째 줄");
    await act(async () =>
      host.emit("window.documentSaveRequested", { documentHandle: "synthetic-document", requestId: "synthetic-save" }),
    );
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "completeDocumentSave").at(-1)?.args).toMatchObject({
        saved: true,
      }),
    );
    expect(files.export.mock.calls.at(-1)?.[1]).toBe("deckimage");
    await screen.findByText(/변경 없음/);
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: false,
      saving: false,
    });
    await changeText("저장 뒤 다시 수정");
    fireEvent.click(button("실행 취소"));
    await screen.findByText(/변경 없음/);
    await waitFor(() =>
      expect((screen.getByLabelText("글자 내용") as HTMLTextAreaElement).value).toBe("수정한 합성 글자\n두 번째 줄"),
    );
    view.unmount();
    deck.dispose();
  });
  it("cancels encoding without saving or losing edits, and clears host saving state", async () => {
    const { host, deck, view } = await setup();
    await openText();
    await changeText("보존할 합성 편집");
    files.export.mockImplementationOnce(
      (_document, _format, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          if (signal.aborted) reject(new FileOperationError("CANCELLED"));
          else signal.addEventListener("abort", () => reject(new FileOperationError("CANCELLED")), { once: true });
        }),
    );
    fireEvent.click(button("작업 저장"));
    await screen.findAllByText("작업 파일 저장 중");
    await waitFor(() => expect(files.export).toHaveBeenCalledOnce());
    fireEvent.click(button("취소"));
    await screen.findByText("작업을 취소했어요.");
    expect(files.save).not.toHaveBeenCalled();
    expect(screen.getByText(/미저장 작업/)).toBeTruthy();
    expect((screen.getByLabelText("글자 내용") as HTMLTextAreaElement).value).toBe("보존할 합성 편집");
    await waitFor(() =>
      expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
        dirty: true,
        saving: false,
      }),
    );
    view.unmount();
    deck.dispose();
  });
  it("blocks drops during a missing-font choice, preserves the current document on cancel and marks replacement dirty", async () => {
    const { host, deck, view } = await setup();
    files.import.mockImplementation(async () => importedText("SyntheticMissingFont"));
    fonts.available.mockReturnValue(false);
    fireEvent.click(button("파일 열기"));
    const first = await screen.findByRole("dialog", { name: "이 PC에 없는 글꼴을 바꿔주세요" });
    await act(async () => host.emit("fs.dropped", { files: [{ ...syntheticFile, handle: "synthetic-other" }] }));
    expect(files.import).toHaveBeenCalledTimes(1);
    expect(button("글자 추가").hasAttribute("disabled")).toBe(true);
    act(() => within(first).getByText("취소", { selector: "button" }).focus());
    await waitFor(() => expect(first.getAttribute("aria-hidden")).not.toBe("true"));
    fireEvent.click(within(first).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(button("파일 열기").hasAttribute("disabled")).toBe(false));
    expect(screen.queryByLabelText("글자 내용")).toBeNull();
    fireEvent.click(button("파일 열기"));
    const second = await screen.findByRole("dialog", { name: "이 PC에 없는 글꼴을 바꿔주세요" });
    act(() => within(second).getByText("대체 글꼴로 열기", { selector: "button" }).focus());
    await waitFor(() => expect(second.getAttribute("aria-hidden")).not.toBe("true"));
    fireEvent.click(within(second).getByRole("button", { name: "대체 글꼴로 열기" }));
    await screen.findByDisplayValue("합성 원문");
    expect((screen.getByLabelText("설치된 글꼴 이름") as HTMLInputElement).value).toBe("Malgun Gothic");
    expect(screen.getByText(/미저장 작업/)).toBeTruthy();
    expect(host.requests.filter((request) => request.method === "setDocumentState").at(-1)?.args).toMatchObject({
      dirty: true,
    });
    view.unmount();
    deck.dispose();
  });
});
