// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Start here. UI only from @deck/ui, icons from @fluentui/react-icons (MOD-010); batch file tools use ToolLayout (MOD-011);
// host features only through `deck` (MOD-006). See modules/timer for a complete example.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { DeckCallError } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  CanvasSurface,
  Caption,
  CheckBox,
  ColorPicker,
  ComboBox,
  ContentDialog,
  InfoBar,
  ListView,
  NumberBox,
  ProgressRing,
  TextBox,
  ToggleButton,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import type { CanvasGesture, ContentDialogResult } from "@deck/ui";
import {
  addLayer,
  assertMemoryBudget,
  cloneDocumentMetadata,
  createDocument,
  createPixelLayer,
  createRaster,
  createShapeLayer,
  createTextLayer,
  documentToLocal,
  duplicateLayer,
  EditorError,
  EditorHistory,
  layerBounds,
  localToDocument,
  rectangleSelection,
  managedDocumentBytes,
  setSelection,
} from "./core/index.ts";
import type {
  Adjustments,
  Color,
  EditorDocument,
  Layer,
  Point,
  StrokeTransaction,
  SelectionMode,
} from "./core/index.ts";
import type { Rect } from "./core/geometry.ts";
import { PreviewRenderer, runEditorOperation } from "./core/preview.ts";
import type { EditorOperation } from "./core/preview.ts";
import {
  exportDocument,
  exportName,
  exportTarget,
  FileOperationError,
  importDocument,
  OutputSession,
  projectSaveHeadroom,
  readInput,
} from "./files/index.ts";
import type { ExportSelection, ImportedDocument, ImportOptions } from "./files/index.ts";
import { ColorInspector } from "./ColorInspector.tsx";
import { LayerInspector } from "./LayerInspector.tsx";
import { ToolSettings } from "./ToolSettings.tsx";
import { EditorAction } from "./EditorAction.tsx";
import { EditorIcon } from "./EditorIcon.tsx";
import type { EditorIconName } from "./EditorIcon.tsx";
import {
  colorHex,
  parseColor,
  DEFAULT_FONT,
  dragRectangle,
  FONT_OPTIONS,
  fontAvailable,
  TOOL_OPTIONS,
} from "./editor-ui.ts";
import type { Tool } from "./editor-ui.ts";
import notices from "../public/THIRD-PARTY-NOTICES.txt?raw";
const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: "100vh", minWidth: 0 },
  toolbar: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXXS, alignItems: "center" },
  commands: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: deckTokens.layer,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  brand: { marginRight: tokens.spacingHorizontalM },
  options: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    minHeight: "48px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  optionInput: { width: "108px", minWidth: 0 },
  format: { width: "180px", minWidth: 0 },
  workspace: {
    display: "grid",
    gridTemplateColumns: "44px minmax(0, 1fr) minmax(248px, 300px)",
    flexGrow: 1,
    minHeight: "72vh",
    alignItems: "stretch",
    "@media (max-width: 720px)": { gridTemplateColumns: "44px minmax(0, 1fr)" },
  },
  rail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  railGroup: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
  divider: {
    width: "70%",
    borderTop: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    marginBlock: tokens.spacingVerticalXS,
  },
  canvas: { minWidth: 0, display: "flex", flexDirection: "column", backgroundColor: tokens.colorNeutralBackground5 },
  documentTab: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  surface: {
    flexGrow: 1,
    minWidth: 0,
    padding: tokens.spacingHorizontalM,
    "& > div > div": { borderRadius: tokens.borderRadiusNone, backgroundColor: tokens.colorNeutralBackground5 },
  },
  status: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  inspector: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: deckTokens.layer,
    borderLeft: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    "@media (max-width: 720px)": {
      gridColumn: "1 / -1",
      borderTop: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    },
  },
  panelTabs: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXXS,
    padding: tokens.spacingHorizontalXS,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  panel: { order: 1, padding: tokens.spacingHorizontalS, maxHeight: "48vh", overflowY: "auto", minHeight: "180px" },
  layers: {
    order: 2,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    borderTop: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  layerList: { maxHeight: "25vh", overflowY: "auto", paddingInline: tokens.spacingHorizontalXS },
  layerRow: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, minWidth: 0 },
  documentName: { minWidth: 0, overflowWrap: "anywhere" },
  layerName: { minWidth: 0, overflowWrap: "anywhere" },
  layerActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: tokens.spacingHorizontalXXS,
    padding: tokens.spacingHorizontalXS,
  },
  panelHeading: { padding: tokens.spacingHorizontalS, backgroundColor: tokens.colorNeutralBackground2 },
  notices: { whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: "50vh" },
  row: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: deckTokens.inlineGap },
});
const TOOL_ICONS = new Map<Tool, EditorIconName>([
  ["move", "move"],
  ["crop", "crop"],
  ["rectangle", "rectselect"],
  ["polygon", "polygon"],
  ["color", "colorselect"],
  ["brush", "brush"],
  ["eraser", "eraser"],
  ["mask-hide", "maskhide"],
  ["mask-restore", "maskrestore"],
  ["perspective", "perspective"],
  ["eyedropper", "eyedropper"],
  ["hand", "hand"],
]);
const TOOL_KEYS = new Map<Tool, string>([
  ["move", "V"],
  ["crop", "C"],
  ["rectangle", "M"],
  ["polygon", "L"],
  ["color", "W"],
  ["brush", "B"],
  ["eraser", "E"],
  ["eyedropper", "I"],
  ["hand", "H"],
]);
function textTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
      !!target.closest("[contenteditable='true'], [role='combobox']"))
  );
}
interface Prompt {
  title: string;
  description: string;
  primary: string;
  secondary?: string;
}
interface Drag {
  tool: Tool;
  start: Point;
  transform?: Layer["transform"];
  points: Point[];
  stroke?: StrokeTransaction;
  pending: Promise<void>;
  cancelled: boolean;
  corner: number;
}
const DEFAULT_COLOR: Color = [0, 0, 0, 255];
export function errorText(error: unknown): string {
  if (error instanceof EditorError) return error.message;
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof FileOperationError && error.code === "CANCELLED")
  )
    return "작업을 취소했어요.";
  if (error instanceof FileOperationError && ["INPUT_LIMIT", "IMAGE_LIMIT", "MEMORY_LIMIT"].includes(error.code))
    return "지원하는 크기를 넘어요. 이미지 크기나 레이어 수를 줄여주세요.";
  if (error instanceof FileOperationError && error.code === "UNSUPPORTED_EXPORT")
    return "이 PC에서 선택한 이미지 형식으로 저장할 수 없어요. 다른 내보내기 형식을 선택하세요.";
  return "작업을 마치지 못했어요. 파일 상태를 확인하고 다시 시도하세요.";
}
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const documentRef = useRef<EditorDocument>(createDocument());
  const history = useRef(new EditorHistory(undefined, projectSaveHeadroom));
  const output = useRef(new OutputSession(deck));
  const sourceHandle = useRef<string | undefined>(undefined);
  const parentRef = useRef<FolderHandleInfo | null>(null);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [inputName, setInputName] = useState("");
  const inputNameRef = useRef("");
  const sourceFormat = useRef<ImportedDocument["rasterFormat"]>(undefined);
  const [pendingInputName, setPendingInputName] = useState("");
  const mounted = useRef(true);
  const handle = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const saving = useRef(false);
  const savedRevision = useRef(0);
  const flow = useRef(false);
  const modal = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const job = useRef<AbortController | null>(null);
  const drag = useRef<Drag | null>(null);
  const renderer = useRef<PreviewRenderer | null>(null);
  const bitmap = useRef<ImageBitmap | null>(null);
  const serial = useRef(0);
  const tone = useRef<{ id: string; value: Adjustments } | null>(null);
  const drafts = useRef(new Map<string, { content?: string; adjustments?: Adjustments }>());
  const resolvePrompt = useRef<((r: ContentDialogResult) => void) | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [flowBusy, setFlowBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [source, setSource] = useState<ImageBitmap | null>(null);
  const [tool, setTool] = useState<Tool>("move");
  const [panel, setPanel] = useState<"properties" | "adjustments" | "tools">("properties");
  const [textFocusRequest, setTextFocusRequest] = useState(0);
  const [zoom, setZoom] = useState(0.5);
  const [compare, setCompare] = useState(false);
  const compareRef = useRef(compare);
  compareRef.current = compare;
  const [name, setName] = useState("편집한 이미지");
  const nameRef = useRef(name);
  nameRef.current = name;
  const [format, setFormat] = useState<ExportSelection>("source");
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, width: 600, height: 400 });
  const [polygon, setPolygon] = useState<Point[]>([]);
  const [corners, setCorners] = useState<Point[]>([]);
  const [corner, setCorner] = useState("0");
  const [perspectiveSize, setPerspectiveSize] = useState({ width: 800, height: 600 });
  const [selectionMode, setSelectionMode] = useState<SelectionMode>("replace");
  const [tolerance, setTolerance] = useState(24);
  const [contiguous, setContiguous] = useState(true);
  const [brush, setBrush] = useState({ size: 32, hardness: 0.8, opacity: 1, color: DEFAULT_COLOR });
  const [stroke, setStroke] = useState<{ points: Point[]; color: string; width: number; opacity: number } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [newSize, setNewSize] = useState({ width: 1200, height: 800 });
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [fonts, setFonts] = useState<{
    imported: ImportedDocument;
    names: string[];
    add: boolean;
    name: string;
    sourceHandle: string;
  } | null>(null);
  const [replacement, setReplacement] = useState(DEFAULT_FONT);
  modal.current = !!prompt || !!fonts || newOpen || noticesOpen;
  const doc = documentRef.current;
  useEffect(() => {
    setRect({ x: 0, y: 0, width: doc.width, height: doc.height });
  }, [doc.width, doc.height]);
  const layer = doc.layers.find((l) => l.id === selected) ?? null;
  const interactionDisabled = !ready || !!busy || flowBusy;
  const disabled = interactionDisabled || !!stroke;
  const refresh = useCallback(() => {
    if (mounted.current) setGeneration((n) => n + 1);
  }, []);
  const mark = useCallback(
    async (value: boolean, isSaving = saving.current) => {
      if (!handle.current) throw new Error("DOCUMENT_NOT_REGISTERED");
      await deck.window.setDocumentState({ documentHandle: handle.current, dirty: value, saving: isSaving });
      dirtyRef.current = value;
      saving.current = isSaving;
      if (mounted.current) setDirty(value);
    },
    [deck],
  );
  const protect = useCallback(async () => {
    if (!dirtyRef.current) await mark(true);
  }, [mark]);
  const hasChanges = useCallback(
    () => documentRef.current.revision !== savedRevision.current || drafts.current.size > 0,
    [],
  );
  const ask = useCallback(
    (p: Prompt) =>
      new Promise<ContentDialogResult>((resolve) => {
        resolvePrompt.current?.("none");
        resolvePrompt.current = resolve;
        setPrompt(p);
      }),
    [],
  );
  const preview = useCallback(async () => {
    if (!renderer.current || !mounted.current) return;
    const number = ++serial.current;
    let current = documentRef.current;
    if (tone.current) {
      current = cloneDocumentMetadata(current);
      const item = current.layers.find((l) => l.id === tone.current?.id);
      if (item?.kind === "pixel") item.adjustments = tone.current.value;
    }
    try {
      const next = await renderer.current.render(current, {
        maxDimension: 1400,
        compareOriginal: compareRef.current,
        historyBytes: history.current.memoryBytes,
      });
      if (!mounted.current || number !== serial.current) {
        next.close();
        return;
      }
      bitmap.current?.close();
      bitmap.current = next;
      setSource(next);
    } catch (e) {
      if (mounted.current && number === serial.current && !(e instanceof DOMException && e.name === "AbortError"))
        setMessage(errorText(e));
    }
  }, []);
  useEffect(() => {
    void preview();
  }, [generation, compare, preview]);
  const suspendPreview = useCallback(() => {
    renderer.current?.dispose();
    renderer.current = null;
  }, []);
  const resumePreview = useCallback(() => {
    if (mounted.current) {
      renderer.current ??= new PreviewRenderer();
      refresh();
    }
  }, [refresh]);
  const flushDrafts = useCallback(async () => {
    if (!drafts.current.size) return false;
    await protect();
    documentRef.current = history.current.perform(documentRef.current, "글자·색보정 적용", (draft) => {
      for (const item of draft.layers) {
        const value = drafts.current.get(item.id);
        if (item.kind === "text" && value?.content !== undefined) item.text.content = value.content;
        if (item.kind === "pixel" && value?.adjustments) item.adjustments = structuredClone(value.adjustments);
      }
    });
    drafts.current.clear();
    tone.current = null;
    return true;
  }, [protect]);
  const edit = useCallback(
    (label: string, mutation: (draft: EditorDocument) => void, draftOnly = false) => {
      queue.current = queue.current
        .then(async () => {
          if (!mounted.current || !handle.current || job.current || drag.current) return;
          await protect();
          await flushDrafts();
          if (!draftOnly) documentRef.current = history.current.perform(documentRef.current, label, mutation);
          await mark(hasChanges());
          setMessage("");
          refresh();
        })
        .catch(async (e: unknown) => {
          if (mounted.current) {
            try {
              await mark(hasChanges());
            } catch {
              /* Retain protection if the host no longer answers. */
            }
            setMessage(errorText(e));
          }
        });
    },
    [mark, protect, refresh, flushDrafts, hasChanges],
  );
  const previewTone = useCallback(
    (id: string, value: Adjustments | null) => {
      tone.current = value ? { id, value } : null;
      void preview();
    },
    [preview],
  );
  const stageDraft = useCallback(
    (id: string, value: { content?: string; adjustments?: Adjustments }): Promise<boolean> => {
      let accepted = false;
      const staged = queue.current
        .then(async () => {
          if (!mounted.current) return false;
          await protect();
          if (!mounted.current) return false;
          const current = documentRef.current.layers.find((l) => l.id === id);
          if (!current || current.locked) return false;
          const next = { ...drafts.current.get(id), ...value };
          if (current.kind === "text" && next.content === current.text.content) delete next.content;
          if (current.kind === "pixel" && JSON.stringify(next.adjustments) === JSON.stringify(current.adjustments))
            delete next.adjustments;
          if (next.content === undefined && !next.adjustments) drafts.current.delete(id);
          else drafts.current.set(id, next);
          accepted = true;
          if (value.adjustments && selectedRef.current === id) previewTone(id, value.adjustments);
          refresh();
          await mark(hasChanges());
          return true;
        })
        .catch((e: unknown) => {
          if (mounted.current) setMessage(errorText(e));
          return accepted;
        });
      queue.current = staged.then(() => undefined);
      return staged;
    },
    [mark, hasChanges, previewTone, refresh, protect],
  );
  const applyDrafts = useCallback(() => edit("글자·색보정 적용", () => undefined, true), [edit]);
  const save = useCallback(
    async (selection: ExportSelection): Promise<boolean> => {
      await queue.current;
      if (!handle.current || job.current || drag.current) return false;
      const target = exportTarget(selection, inputNameRef.current, sourceFormat.current ?? "png");
      const controller = new AbortController();
      job.current = controller;
      setBusy(target.format === "deckimage" ? "작업 파일 저장 중" : "이미지 내보내는 중");
      setMessage("");
      let revision: number;
      try {
        await flushDrafts();
        revision = documentRef.current.revision;
        suspendPreview();
        const visibleBytes = bitmap.current ? bitmap.current.width * bitmap.current.height * 12 : 0;
        await mark(dirtyRef.current, true);
        const result = await exportDocument(documentRef.current, target.format, controller.signal, {
          reservedBytes: history.current.memoryBytes + visibleBytes,
        });
        const written = await output.current.save(
          result.blob,
          exportName(nameRef.current, target),
          controller.signal,
          sourceHandle.current,
        );
        if (!written) return false;
        if (target.format === "deckimage") savedRevision.current = revision;
        await mark(hasChanges(), false);
        setMessage(
          target.format === "deckimage"
            ? "작업 파일을 저장했어요. 다시 열어 편집할 수 있어요."
            : "새 파일로 내보냈어요. 편집 상태는 작업 파일로 저장하세요.",
        );
        return target.format === "deckimage" && !dirtyRef.current;
      } catch (e) {
        setMessage(errorText(e));
        return false;
      } finally {
        const session = output.current;
        const chosen = session.selectedFolder;
        if (chosen) {
          parentRef.current = chosen;
          setParent(chosen);
        }
        try {
          await session.close();
        } catch {
          setMessage("저장한 결과는 유지해요. 저장 작업을 정리하지 못했어요.");
        }
        output.current = new OutputSession(deck, parentRef.current?.handle);
        job.current = null;
        setBusy("");
        resumePreview();
        try {
          await mark(hasChanges(), false);
        } catch {
          setMessage("저장 상태를 확인하지 못했어요. 닫기 전에 다시 저장하세요.");
        }
      }
    },
    [mark, suspendPreview, resumePreview, flushDrafts, hasChanges],
  );
  saveRef.current = () => save("deckimage");
  useEffect(() => {
    let alive = true;
    mounted.current = true;
    output.current = new OutputSession(deck);
    renderer.current = new PreviewRenderer();
    void deck.window
      .registerDocument()
      .then(async (result) => {
        if (!alive) return;
        handle.current = result.documentHandle;
        await mark(false, false);
        if (mounted.current) {
          setReady(true);
          refresh();
        }
      })
      .catch(() => setMessage("작업 보호를 준비하지 못했어요. 앱을 업데이트한 뒤 다시 열어주세요."));
    const off = deck.on("window.documentSaveRequested", (request) => {
      if (request.documentHandle !== handle.current) return;
      void (async () => {
        const saved = await saveRef.current();
        await deck.window.completeDocumentSave({ ...request, saved });
      })().catch((e: unknown) => {
        // A cancelled shell transition expires its request; the file save can still finish normally.
        if (e instanceof DeckCallError && e.code === "NOT_FOUND") return;
        if (mounted.current) setMessage("저장 요청을 마치지 못했어요. 작업을 직접 저장하세요.");
      });
    });
    return () => {
      alive = false;
      mounted.current = false;
      off();
      job.current?.abort();
      if (drag.current) {
        drag.current.cancelled = true;
        drag.current.stroke?.cancel();
      }
      renderer.current?.dispose();
      bitmap.current?.close();
      resolvePrompt.current?.("none");
      void output.current.close();
    };
  }, [deck, mark, refresh]);
  const canReplace = async () => {
    await queue.current;
    if (!dirtyRef.current) return true;
    const r = await ask({
      title: "현재 작업을 저장할까요?",
      description: "새 작업을 열면 현재 편집 내용을 잃어요.",
      primary: "작업 저장",
      secondary: "버리기",
    });
    return r === "primary" ? saveRef.current() : r === "secondary";
  };
  const install = async (imported: ImportedDocument, add: boolean, filename: string, originalHandle?: string) => {
    // A new document must retain a safe editable-save path before replacing the current one.
    if (!add) assertMemoryBudget(imported.document, projectSaveHeadroom(imported.document));
    if (add)
      edit("이미지 레이어 추가", (draft) => {
        for (const copy of cloneDocumentMetadata(imported.document).layers) {
          copy.id = crypto.randomUUID();
          addLayer(draft, copy);
          setSelected(copy.id);
        }
      });
    else {
      await output.current.close();
      output.current = new OutputSession(deck, parentRef.current?.handle);
      const converted = imported.warnings.length > 0;
      if (converted) await protect();
      sourceHandle.current = originalHandle;
      sourceFormat.current = imported.rasterFormat;
      inputNameRef.current = originalHandle ? filename : "";
      setInputName(inputNameRef.current);
      documentRef.current = imported.document;
      drafts.current.clear();
      history.current.clear();
      savedRevision.current = converted ? -1 : imported.document.revision;
      await mark(converted, false);
      setSelected(imported.document.layers.at(-1)?.id ?? null);
      setPanel("properties");
      setName(filename.replace(/\.[^.]+$/, "") || "편집한 이미지");
      setZoom(Math.min(1, 1000 / imported.document.width, 600 / imported.document.height));
      setRect({ x: 0, y: 0, width: imported.document.width, height: imported.document.height });
      tone.current = null;
      refresh();
    }
    setTool("move");
    setPolygon([]);
    setCorners([]);
    setWarning(imported.warnings.join(" · "));
  };
  const openFile = async (add = false, dropped?: FileHandleInfo) => {
    if (!ready || job.current || flow.current || modal.current) {
      if (dropped) setMessage("현재 작업 중이라 파일을 추가하지 못했어요. 작업이 끝나면 다시 놓아주세요.");
      return;
    }
    flow.current = true;
    setFlowBusy(true);
    let awaitingFont = false;
    try {
      const picked = dropped
        ? [dropped]
        : await deck.fs.pickFiles({
            filters: [{ name: "이미지와 작업 파일", extensions: ["jpg", "jpeg", "png", "webp", "psd", "deckimage"] }],
            multiple: false,
          });
      const file = picked[0];
      if (!file) return;
      setPendingInputName(file.name);
      setMessage(`${file.name} 파일을 입력했어요.`);
      if (!add && !(await canReplace())) return;
      const controller = new AbortController();
      job.current = controller;
      setBusy(`${file.name} 파일 여는 중`);
      suspendPreview();
      const options: ImportOptions = {
        reservedBytes:
          managedDocumentBytes(documentRef.current) +
          history.current.memoryBytes +
          (bitmap.current ? bitmap.current.width * bitmap.current.height * 12 : 0),
      };
      const bytes = await readInput(deck, file, controller.signal, options.reservedBytes);
      let imported: ImportedDocument;
      for (;;) {
        try {
          imported = await importDocument(bytes, controller.signal, options);
          break;
        } catch (e) {
          if (!(e instanceof FileOperationError) || !["PSD_UNSUPPORTED", "PSD_COMPLEX_TEXT"].includes(e.code)) throw e;
          const simple = e.code === "PSD_COMPLEX_TEXT";
          if ((simple && options.complexText) || (!simple && options.unsupported)) throw e;
          const answer = await ask({
            title: simple ? "글자 서식을 단순하게 바꿀까요?" : "PSD를 한 이미지로 열까요?",
            description: `${e.reasons.join(" · ")} ${simple ? "내용을 수정할 수 있지만 복잡한 서식은 바뀌어요." : "기존 글자·레이어는 개별 수정할 수 없어요."}`,
            primary: simple ? "단순 글자로 열기" : "한 이미지로 열기",
          });
          if (answer !== "primary") return;
          if (simple) options.complexText = "simplify";
          else options.unsupported = "composite";
        }
      }
      const absent = imported.fonts.filter((font) => !fontAvailable(font));
      if (absent.length) {
        awaitingFont = true;
        setFonts({ imported, names: absent, add, name: file.name, sourceHandle: file.handle });
        return;
      }
      job.current = null;
      setBusy("");
      await install(imported, add, file.name, file.handle);
      setMessage(`${file.name} 파일을 열었어요.${add ? " 이미지 레이어로 추가했어요." : ""}`);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      job.current = null;
      setBusy("");
      if (!awaitingFont) {
        setPendingInputName("");
        flow.current = false;
        setFlowBusy(false);
        resumePreview();
      }
    }
  };
  const chooseDestination = async () => {
    if (job.current || flow.current || !ready) return;
    flow.current = true;
    setFlowBusy(true);
    try {
      const picked = await deck.fs.pickFolder();
      if (picked) {
        await output.current.close();
        parentRef.current = picked;
        setParent(picked);
        output.current = new OutputSession(deck, picked.handle);
      }
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      flow.current = false;
      setFlowBusy(false);
    }
  };
  const resetDestination = async () => {
    if (job.current || flow.current) return;
    await output.current.close();
    parentRef.current = null;
    setParent(null);
    output.current = new OutputSession(deck);
  };
  const openRef = useRef(openFile);
  openRef.current = openFile;
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        const file = files[0];
        if (!file) {
          setMessage("폴더나 읽을 수 없는 파일은 추가하지 않았어요. 지원하는 파일을 놓아주세요.");
          return;
        }
        if (!/\.(jpe?g|png|webp|psd|deckimage)$/i.test(file.name)) {
          setMessage("JPG·PNG·WebP·PSD·작업 파일을 놓아주세요.");
          return;
        }
        void openRef.current(false, file);
      }),
    [deck],
  );
  const workerEdit = async (label: string, task: EditorOperation, mode: SelectionMode = selectionMode) => {
    if (job.current || !ready || drag.current) return;
    await queue.current;
    if (job.current || drag.current) return;
    const controller = new AbortController();
    job.current = controller;
    setBusy(label);
    // UI callbacks can wait behind queued edits. Always send the latest document to the Worker.
    let revision: number;
    try {
      await protect();
      await flushDrafts();
      if ("doc" in task) task = { ...task, doc: documentRef.current };
      if (task.kind === "polygon")
        task = { ...task, width: documentRef.current.width, height: documentRef.current.height };
      revision = documentRef.current.revision;
      suspendPreview();
      const result = await runEditorOperation(task, controller.signal, history.current.memoryBytes);
      if (controller.signal.aborted || documentRef.current.revision !== revision) return;
      job.current = null;
      edit(label, (draft) => {
        if (result.kind === "selection") setSelection(draft, result.selection, mode);
        else {
          draft.width = result.doc.width;
          draft.height = result.doc.height;
          draft.layers = result.doc.layers;
          draft.selection = result.doc.selection;
          if (task.kind === "perspective") {
            const perspectiveId = task.id;
            const updated = result.doc.layers.find((l) => l.id === perspectiveId);
            if (updated?.kind === "pixel") {
              const { width, height } = updated.pixels;
              setCorners([
                { x: 0, y: 0 },
                { x: width, y: 0 },
                { x: width, y: height },
                { x: 0, y: height },
              ]);
              setPerspectiveSize({ width, height });
            }
          }
        }
      });
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      job.current = null;
      setBusy("");
      resumePreview();
      try {
        await mark(hasChanges());
      } catch (e) {
        if (mounted.current) setMessage(errorText(e));
      }
    }
  };
  const undo = async (redo = false) => {
    if (disabled || drag.current) return;
    if (redo ? !history.current.canRedo || drafts.current.size > 0 : !history.current.canUndo && !drafts.current.size)
      return;
    try {
      await queue.current;
      await protect();
      await flushDrafts();
      documentRef.current = redo
        ? history.current.redo(documentRef.current)
        : history.current.undo(documentRef.current);
      tone.current = null;
      await mark(hasChanges());
      refresh();
    } catch (e) {
      if (mounted.current) {
        setMessage(errorText(e));
        refresh();
      }
    }
  };
  const changeTool = (next: Tool) => {
    setTool(next);
    if (["crop", "rectangle", "polygon", "perspective", "mask-hide", "mask-restore"].includes(next)) setPanel("tools");
    setPolygon([]);
    if (next === "perspective" && layer?.kind === "pixel") {
      const { width, height } = layer.pixels;
      setCorners([
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ]);
      setPerspectiveSize({ width, height });
      setCorner("0");
    }
  };
  const addObject = (kind: "pixel" | "text" | "rectangle" | "arrow") =>
    edit("레이어 추가", (draft) => {
      assertMemoryBudget(draft, kind === "pixel" ? draft.width * draft.height * 4 : 0, history.current.memoryBytes);
      const item =
        kind === "pixel"
          ? createPixelLayer(createRaster(draft.width, draft.height), "투명 레이어")
          : kind === "text"
            ? createTextLayer({
                fontFamily: DEFAULT_FONT,
                width: Math.min(600, draft.width),
                height: Math.min(180, draft.height),
              })
            : createShapeLayer(
                { type: kind, width: Math.min(300, draft.width), height: Math.min(180, draft.height) },
                kind === "arrow" ? "화살표" : "사각형",
              );
      if (kind !== "pixel") {
        item.transform.x = Math.min(40, draft.width / 10);
        item.transform.y = Math.min(40, draft.height / 10);
      }
      addLayer(draft, item);
      setSelected(item.id);
      setTool("move");
    });
  const cancelDrag = (current: Drag) => {
    if (current.cancelled) return;
    current.cancelled = true;
    documentRef.current = current.stroke?.cancel() ?? documentRef.current;
    if (drag.current === current) {
      drag.current = null;
      setStroke(null);
    }
    queue.current = queue.current
      .then(async () => {
        await current.pending;
        if (!mounted.current) return;
        await mark(hasChanges());
        refresh();
      })
      .catch((e: unknown) => {
        if (mounted.current) setMessage(errorText(e));
      });
  };
  const gesture = (event: CanvasGesture) => {
    if (interactionDisabled) return;
    if (event.phase === "start") {
      if (drag.current) return;
      const item = documentRef.current.layers.find((l) => l.id === selected);
      const current: Drag = {
        tool,
        start: event.point,
        points: [event.point],
        pending: Promise.resolve(),
        cancelled: false,
        corner: Number(corner),
      };
      drag.current = current;
      if (["brush", "eraser", "mask-hide", "mask-restore"].includes(tool)) {
        if (!item || item.kind !== "pixel" || item.locked) {
          drag.current = null;
          setMessage("잠기지 않은 이미지 레이어를 선택하세요. 글자·도형은 픽셀화 후 그릴 수 있어요.");
          return;
        }
        current.pending = queue.current
          .then(async () => {
            await protect();
            if (current.cancelled) return;
            await flushDrafts();
            if (current.cancelled || !mounted.current) return;
            current.stroke = history.current.beginStroke(documentRef.current, item.id, {
              ...brush,
              mode:
                tool === "brush"
                  ? "paint"
                  : tool === "eraser"
                    ? "erase"
                    : tool === "mask-hide"
                      ? "mask-hide"
                      : "mask-restore",
            });
            for (const p of current.points.splice(0)) await current.stroke.addPointAsync(p);
          })
          .catch((e: unknown) => {
            cancelDrag(current);
            setMessage(errorText(e));
          });
        setStroke({
          points: [event.point, { x: event.point.x + 0.01, y: event.point.y }],
          color: colorHex(brush.color),
          width: brush.size,
          opacity: tool === "brush" ? brush.opacity : 0.3,
        });
      } else if (tool === "move" && item && !item.locked) current.transform = { ...item.transform };
      else if (tool === "color" && item?.kind === "pixel") {
        drag.current = null;
        void workerEdit("색상 선택", {
          kind: "select-color",
          doc: documentRef.current,
          id: item.id,
          point: event.point,
          tolerance,
          contiguous,
        });
      } else if (tool === "polygon") setPolygon((pts) => (pts.length < 256 ? [...pts, event.point] : pts));
      else if (tool === "perspective" && item?.kind === "pixel") {
        const p = documentToLocal(event.point, item.transform);
        const index = corners.reduce(
          (best, q, i) =>
            Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot((corners[best]?.x ?? 0) - p.x, (corners[best]?.y ?? 0) - p.y)
              ? i
              : best,
          0,
        );
        current.corner = index;
        setCorner(String(index));
        setCorners((pts) =>
          pts.map((q, i) =>
            i === index
              ? { x: Math.max(0, Math.min(item.pixels.width, p.x)), y: Math.max(0, Math.min(item.pixels.height, p.y)) }
              : q,
          ),
        );
      } else if (tool === "eyedropper" && bitmap.current) {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.current.width;
        canvas.height = bitmap.current.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap.current, 0, 0);
          const p = ctx.getImageData(
            Math.min(canvas.width - 1, Math.floor((event.point.x / doc.width) * canvas.width)),
            Math.min(canvas.height - 1, Math.floor((event.point.y / doc.height) * canvas.height)),
            1,
            1,
          ).data;
          setBrush((b) => ({ ...b, color: [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, 255] }));
        }
        canvas.width = 1;
      }
    } else {
      const current = drag.current;
      if (!current) return;
      if (event.phase === "cancel") {
        cancelDrag(current);
        return;
      }
      if (event.phase === "move") {
        if (current.stroke) {
          current.pending = current.pending
            .then(async () => {
              if (!current.cancelled) await current.stroke?.addPointAsync(event.point);
            })
            .catch((e: unknown) => {
              cancelDrag(current);
              setMessage(errorText(e));
              refresh();
            });
        } else current.points.push(event.point);
        if (["brush", "eraser", "mask-hide", "mask-restore"].includes(current.tool))
          setStroke((value) => (value ? { ...value, points: [...value.points.slice(-1024), event.point] } : null));
        if (current.tool === "crop" || current.tool === "rectangle")
          setRect(dragRectangle(current.start, event.point, doc.width, doc.height));
        if (current.tool === "perspective" && layer?.kind === "pixel") {
          const p = documentToLocal(event.point, layer.transform);
          setCorners((pts) =>
            pts.map((q, i) =>
              i === current.corner
                ? {
                    x: Math.max(0, Math.min(layer.pixels.width, p.x)),
                    y: Math.max(0, Math.min(layer.pixels.height, p.y)),
                  }
                : q,
            ),
          );
        }
      } else if (event.phase === "end") {
        if (["brush", "eraser", "mask-hide", "mask-restore"].includes(current.tool))
          void current.pending
            .then(async () => {
              if (!current.stroke || current.cancelled) return;
              await current.stroke.addPointAsync(event.point);
              if (current.cancelled) return;
              documentRef.current = current.stroke.commit();
              await mark(hasChanges());
              if (!mounted.current) return;
              if (drag.current === current) {
                drag.current = null;
                setStroke(null);
              }
              refresh();
            })
            .catch((e: unknown) => {
              cancelDrag(current);
              if (mounted.current) {
                setMessage(errorText(e));
                refresh();
              }
            });
        else {
          drag.current = null;
          const starting = current.transform;
          if (current.tool === "move" && starting && selected)
            edit("레이어 이동", (draft) => {
              const l = draft.layers.find((q) => q.id === selected);
              if (l && !l.locked) {
                l.transform.x = starting.x + event.point.x - current.start.x;
                l.transform.y = starting.y + event.point.y - current.start.y;
              }
            });
          if (current.tool === "rectangle")
            edit("사각형 선택", (draft) =>
              setSelection(
                draft,
                rectangleSelection(
                  draft.width,
                  draft.height,
                  dragRectangle(current.start, event.point, draft.width, draft.height),
                ),
                selectionMode,
              ),
            );
        }
      }
    }
  };
  const key = (value: string, shift: boolean): boolean => {
    if (value === "Escape") {
      if (drag.current) {
        cancelDrag(drag.current);
      }
      drag.current = null;
      setStroke(null);
      setPolygon([]);
      refresh();
      return true;
    }
    if (value === "Enter" && tool === "polygon" && polygon.length >= 3) {
      void workerEdit("다각형 선택", { kind: "polygon", width: doc.width, height: doc.height, points: polygon });
      setPolygon([]);
      return true;
    }
    if (tool === "move" && selected && value.startsWith("Arrow")) {
      const n = shift ? 10 : 1;
      edit("레이어 이동", (draft) => {
        const l = draft.layers.find((q) => q.id === selected);
        if (l && !l.locked) {
          l.transform.x += value === "ArrowRight" ? n : value === "ArrowLeft" ? -n : 0;
          l.transform.y += value === "ArrowDown" ? n : value === "ArrowUp" ? -n : 0;
        }
      });
      return true;
    }
    return false;
  };
  const worker = (label: string, task: EditorOperation) => {
    void workerEdit(label, task);
  };
  const fit = () => {
    const area = document.querySelector<HTMLElement>("[data-editor-viewport] > div > div");
    setZoom(
      Math.max(0.02, Math.min(1, (area?.clientWidth || 1000) / doc.width, (area?.clientHeight || 600) / doc.height)),
    );
  };
  return (
    <main
      className={s.root}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.nativeEvent.isComposing || e.repeat || modal.current || disabled || drag.current)
          return;
        const value = e.key.toLowerCase();
        const command = e.ctrlKey || e.metaKey;
        if (command && value === "s") {
          e.preventDefault();
          void save("deckimage");
          return;
        }
        if (textTarget(e.target)) return;
        if (command && value === "z") {
          e.preventDefault();
          void undo(e.shiftKey);
        } else if (command && value === "n") {
          e.preventDefault();
          setNewOpen(true);
        } else if (command && value === "o") {
          e.preventDefault();
          void openFile();
        } else if (command && value === "0") {
          e.preventDefault();
          fit();
        } else if (command && value === "1") {
          e.preventDefault();
          setZoom(1);
        } else if (!command && !e.altKey) {
          const option = TOOL_OPTIONS.find((o) => TOOL_KEYS.get(o.value)?.toLowerCase() === value);
          if (option) {
            e.preventDefault();
            changeTool(option.value);
          } else if (value === "t") {
            e.preventDefault();
            setPanel("properties");
            if (layer?.kind === "text") {
              setTextFocusRequest((request) => request + 1);
            } else addObject("text");
          }
        }
      }}
    >
      <header className={s.commands}>
        <BodyStrong className={s.brand}>고급 이미지 편집</BodyStrong>
        <div className={s.toolbar} role="toolbar" aria-label="파일 작업">
          <EditorAction
            icon="new"
            label="새 작업"
            shortcut="Ctrl+N"
            size="small"
            disabled={disabled}
            onClick={() => setNewOpen(true)}
          />
          <EditorAction
            icon="open"
            label="파일 열기"
            shortcut="Ctrl+O"
            size="small"
            disabled={disabled}
            onClick={() => void openFile()}
          />
          <EditorAction
            icon="addimage"
            label="이미지 추가"
            size="small"
            disabled={disabled}
            onClick={() => void openFile(true)}
          />
          <EditorAction
            icon="save"
            label="작업 저장"
            shortcut="Ctrl+S"
            size="small"
            disabled={disabled}
            appearance="primary"
            onClick={() => void save("deckimage")}
          />
          <EditorAction
            icon="undo"
            label="실행 취소"
            shortcut="Ctrl+Z"
            size="small"
            disabled={disabled || (!history.current.canUndo && !drafts.current.size)}
            onClick={() => void undo()}
          />
          <EditorAction
            icon="redo"
            label="다시 실행"
            shortcut="Ctrl+Shift+Z"
            size="small"
            disabled={disabled || !history.current.canRedo || drafts.current.size > 0}
            onClick={() => void undo(true)}
          />
        </div>
        <div className={s.format}>
          <ComboBox
            header="내보내기 형식"
            showHeader={false}
            value={format}
            options={[
              {
                value: "source",
                label: sourceFormat.current
                  ? `원본 형식 · ${exportTarget("source", inputName, sourceFormat.current).extension.toUpperCase()}`
                  : "기본 형식 · PNG",
              },
              { value: "png", label: "PNG · 투명 배경" },
              { value: "jpeg", label: "JPG · 흰 배경" },
              { value: "webp", label: "WebP · 투명 배경" },
              { value: "psd", label: "PSD · 기본 레이어" },
            ]}
            onChange={setFormat}
            disabled={disabled}
          />
        </div>
        <EditorAction
          icon="export"
          label="내보내기"
          labelVisible
          size="small"
          disabled={disabled}
          onClick={() => void save(format)}
        />
        <EditorAction
          icon="notice"
          label="사용한 오픈소스"
          size="small"
          appearance="subtle"
          onClick={() => setNoticesOpen(true)}
        />
      </header>
      <section className={s.options} aria-label="현재 도구 옵션">
        <EditorIcon name={TOOL_ICONS.get(tool) ?? "move"} />
        <BodyStrong>{TOOL_OPTIONS.find((o) => o.value === tool)?.label}</BodyStrong>
        {["brush", "eraser", "mask-hide", "mask-restore"].includes(tool) && (
          <>
            <div className={s.optionInput}>
              <NumberBox
                header="빠른 브러시 크기"
                value={brush.size}
                min={1}
                max={2048}
                disabled={disabled}
                onChange={(size) => setBrush((b) => ({ ...b, size }))}
              />
            </div>
            <div className={s.optionInput}>
              <NumberBox
                header="빠른 획 불투명도 · %"
                value={Math.round(brush.opacity * 100)}
                min={0}
                max={100}
                disabled={disabled}
                onChange={(opacity) => setBrush((b) => ({ ...b, opacity: opacity / 100 }))}
              />
            </div>
          </>
        )}
        {["rectangle", "polygon", "color"].includes(tool) && (
          <div className={s.format}>
            <ComboBox
              header="빠른 선택 방식"
              showHeader={false}
              value={selectionMode}
              options={[
                { value: "replace", label: "새 선택" },
                { value: "add", label: "선택에 추가" },
                { value: "subtract", label: "선택에서 빼기" },
              ]}
              onChange={setSelectionMode}
              disabled={disabled}
            />
          </div>
        )}
        {tool === "color" && (
          <>
            <div className={s.optionInput}>
              <NumberBox
                header="빠른 색상 허용 오차"
                value={tolerance}
                min={0}
                max={255}
                onChange={setTolerance}
                disabled={disabled}
              />
            </div>
            <CheckBox content="연결된 영역만 선택" checked={contiguous} onChange={setContiguous} disabled={disabled} />
          </>
        )}
        <EditorAction
          icon="settings"
          label="도구 옵션 열기"
          labelVisible
          size="small"
          selected={panel === "tools"}
          onClick={() => setPanel("tools")}
        />
        <CheckBox content="보정 전 비교" checked={compare} onChange={setCompare} />
      </section>
      <div className={s.options} aria-label="파일 입력과 저장 위치">
        {!!inputName && <Caption aria-live="polite">입력 파일: {inputName}</Caption>}
        {!!pendingInputName && <Caption aria-live="polite">입력 파일 확인 중: {pendingInputName}</Caption>}
        <EditorAction
          icon="open"
          label="저장 폴더 선택"
          labelVisible
          size="small"
          disabled={disabled}
          onClick={() => void chooseDestination()}
        />
        <EditorAction
          icon="reset"
          label="원본 폴더에 저장"
          size="small"
          disabled={disabled || !parent}
          onClick={() => void resetDestination()}
        />
        <Caption>
          {parent
            ? `저장 위치: ${parent.name}`
            : sourceHandle.current
              ? "원본 파일과 같은 폴더에 저장해요."
              : "새 작업은 처음 저장할 때 폴더를 선택해요."}
        </Caption>
      </div>
      {!!message && <InfoBar severity="informational" onClose={() => setMessage("")} message={message} />}
      {!!warning && <InfoBar severity="warning" onClose={() => setWarning("")} message={warning} />}
      {!!busy && (
        <div className={s.toolbar}>
          <ProgressRing label={busy} />
          <Body>{busy}</Body>
          <Button onClick={() => job.current?.abort()}>취소</Button>
        </div>
      )}
      <div className={s.workspace}>
        <nav className={s.rail} aria-label="편집 도구">
          <div className={s.railGroup}>
            {TOOL_OPTIONS.map((o) => {
              const shortcut = TOOL_KEYS.get(o.value);
              return (
                <EditorAction
                  key={o.value}
                  icon={TOOL_ICONS.get(o.value) ?? "move"}
                  label={o.label}
                  {...(shortcut === undefined ? {} : { shortcut })}
                  selected={tool === o.value}
                  size="small"
                  disabled={disabled}
                  onClick={() => changeTool(o.value)}
                />
              );
            })}
          </div>
          <div className={s.divider} />
          <div className={s.railGroup}>
            <EditorAction
              icon="text"
              label="글자 추가"
              shortcut="T"
              size="small"
              disabled={disabled}
              onClick={() => {
                setPanel("properties");
                addObject("text");
              }}
            />
            <EditorAction
              icon="arrow"
              label="화살표 추가"
              size="small"
              disabled={disabled}
              onClick={() => {
                setPanel("properties");
                addObject("arrow");
              }}
            />
            <EditorAction
              icon="rectangle"
              label="사각형 추가"
              size="small"
              disabled={disabled}
              onClick={() => {
                setPanel("properties");
                addObject("rectangle");
              }}
            />
          </div>
          <div className={s.divider} />
          <ColorPicker
            header="전경색"
            showHeader={false}
            value={colorHex(brush.color)}
            disabled={disabled}
            onChange={(value) => setBrush((b) => ({ ...b, color: parseColor(value) }))}
          />
        </nav>
        <section className={s.canvas} aria-label="문서 작업 영역">
          <div className={s.documentTab}>
            <EditorIcon name="rasterize" />
            <BodyStrong className={s.documentName}>
              {name}
              {dirty ? " *" : ""}
            </BodyStrong>
            <Caption>
              {doc.width} × {doc.height} · RGB / 8
            </Caption>
          </div>
          <div className={s.surface} data-editor-viewport>
            <CanvasSurface
              header={`캔버스 · ${Math.round(zoom * 100)}%`}
              alt="이미지 편집 캔버스"
              source={source}
              width={doc.width}
              height={doc.height}
              zoom={zoom}
              disabled={interactionDisabled}
              cursor={tool === "hand" ? "grab" : tool === "move" ? "default" : "crosshair"}
              rectangle={
                tool === "crop" || tool === "rectangle" ? rect : tool === "move" && layer ? layerBounds(layer) : null
              }
              points={
                tool === "polygon"
                  ? polygon
                  : tool === "perspective" && layer
                    ? corners.map((p) => localToDocument(p, layer.transform))
                    : []
              }
              selection={doc.selection ? { width: doc.width, height: doc.height, data: doc.selection } : null}
              stroke={stroke}
              onGesture={gesture}
              onKey={key}
            />
          </div>
          <div className={s.status}>
            <Caption>
              {dirty ? "미저장 작업" : "변경 없음"} · {layer?.name ?? "레이어를 추가하세요"} ·{" "}
              {tool.startsWith("mask") ? "마스크" : "이미지"}
            </Caption>
            <div className={s.toolbar} role="toolbar" aria-label="캔버스 보기">
              <EditorAction
                icon="zoomout"
                label="축소"
                size="small"
                disabled={zoom <= 0.02}
                onClick={() => setZoom(Math.max(0.02, zoom / 1.25))}
              />
              <Caption>{Math.round(zoom * 100)}%</Caption>
              <EditorAction
                icon="zoomin"
                label="확대"
                size="small"
                disabled={zoom >= 8}
                onClick={() => setZoom(Math.min(8, zoom * 1.25))}
              />
              <EditorAction icon="fit" label="화면 맞춤" shortcut="Ctrl+0" size="small" onClick={fit} />
              <EditorAction
                icon="actualsize"
                label="100% 보기"
                shortcut="Ctrl+1"
                size="small"
                onClick={() => setZoom(1)}
              />
            </div>
          </div>
        </section>
        <aside className={s.inspector} aria-label="편집 설정">
          <div className={s.panelTabs} aria-label="설정 패널 선택">
            <ToggleButton
              size="small"
              appearance="subtle"
              checked={panel === "properties"}
              onClick={() => setPanel("properties")}
            >
              속성
            </ToggleButton>
            <ToggleButton
              size="small"
              appearance="subtle"
              checked={panel === "adjustments"}
              onClick={() => setPanel("adjustments")}
            >
              색 보정
            </ToggleButton>
            <ToggleButton
              size="small"
              appearance="subtle"
              checked={panel === "tools"}
              onClick={() => setPanel("tools")}
            >
              도구 설정
            </ToggleButton>
          </div>
          <div className={s.layers}>
            <BodyStrong className={s.panelHeading}>레이어 {doc.layers.length}/16</BodyStrong>
            <div className={s.layerList}>
              <ListView
                header="레이어 목록 · 위에서 아래"
                items={[...doc.layers].reverse()}
                getKey={(l) => l.id}
                renderItem={(l) => (
                  <div className={s.layerRow}>
                    <EditorIcon name={l.kind === "text" ? "text" : l.kind === "shape" ? "rectangle" : "rasterize"} />
                    <Body className={s.layerName}>
                      {l.visible ? "" : "숨김 · "}
                      {l.locked ? "잠김 · " : ""}
                      {l.name} ·{" "}
                      {l.kind === "text" ? "글자" : l.kind === "shape" ? "도형" : l.mask ? "이미지+마스크" : "이미지"}
                    </Body>
                  </div>
                )}
                selectionMode="single"
                selectedKeys={selected ? [selected] : []}
                onSelectionChange={(keys) => {
                  if (disabled || drag.current) return;
                  setSelected(keys[0] ?? null);
                  tone.current = null;
                  setTool("move");
                  setPanel("properties");
                }}
                emptyText="이미지를 열거나 레이어를 추가하세요."
              />
            </div>
            <div className={s.layerActions} role="toolbar" aria-label="레이어 작업">
              <EditorAction
                icon="layeradd"
                label="투명 레이어"
                size="small"
                disabled={disabled}
                onClick={() => {
                  setPanel("properties");
                  addObject("pixel");
                }}
              />
              <EditorAction
                icon="duplicate"
                label="복제"
                size="small"
                disabled={disabled || !layer}
                onClick={() =>
                  edit("레이어 복제", (draft) => {
                    if (layer) setSelected(duplicateLayer(draft, layer.id).id);
                  })
                }
              />
              <EditorAction
                icon="delete"
                label="레이어 삭제"
                size="small"
                disabled={disabled || !layer || layer.locked}
                onClick={() =>
                  edit("레이어 삭제", (draft) => {
                    const i = draft.layers.findIndex((l) => l.id === selected);
                    if (i >= 0) draft.layers.splice(i, 1);
                    setSelected(draft.layers[Math.max(0, i - 1)]?.id ?? null);
                  })
                }
              />
              <EditorAction
                icon="merge"
                label="아래와 병합"
                size="small"
                disabled={disabled || !layer || layer.locked}
                onClick={() =>
                  void (async () => {
                    if (
                      (await ask({
                        title: "아래 레이어와 병합할까요?",
                        description: "글자·도형·마스크가 픽셀로 합쳐져요. 실행 취소로 되돌릴 수 있어요.",
                        primary: "병합",
                      })) === "primary"
                    )
                      if (layer) worker("레이어 병합", { kind: "merge", doc: documentRef.current, id: layer.id });
                  })()
                }
              />
              {([1, -1] as const).map((delta) => (
                <EditorAction
                  key={delta}
                  icon={delta === 1 ? "up" : "down"}
                  label={delta === 1 ? "위로" : "아래로"}
                  size="small"
                  disabled={disabled || !layer}
                  onClick={() =>
                    edit("레이어 순서", (draft) => {
                      const i = draft.layers.findIndex((l) => l.id === selected);
                      if (i >= 0 && i + delta >= 0 && i + delta < draft.layers.length) {
                        const [item] = draft.layers.splice(i, 1);
                        if (item) draft.layers.splice(i + delta, 0, item);
                      }
                    })
                  }
                />
              ))}
            </div>
          </div>
          <section className={s.panel} hidden={panel !== "properties"} aria-label="레이어 속성 패널">
            <TextBox header="출력 이름 (확장자 제외)" value={name} onChange={setName} disabled={disabled} />
            {layer && (
              <LayerInspector
                layer={layer}
                edit={edit}
                disabled={disabled}
                draftContent={drafts.current.get(layer.id)?.content}
                onDraft={(id, content) => stageDraft(id, { content })}
                onApply={applyDrafts}
                textFocusRequest={textFocusRequest}
              />
            )}
            {layer && layer.kind !== "pixel" && (
              <EditorAction
                icon="rasterize"
                label="픽셀화"
                labelVisible
                size="small"
                disabled={disabled || layer.locked}
                onClick={() =>
                  void (async () => {
                    if (
                      (await ask({
                        title: "이미지 레이어로 바꿀까요?",
                        description: "브러시·누끼를 쓸 수 있어요. 글자·도형 속성은 실행 취소로 복원할 수 있어요.",
                        primary: "픽셀화",
                      })) === "primary"
                    )
                      worker("레이어 픽셀화", { kind: "rasterize", doc: documentRef.current, id: layer.id });
                  })()
                }
              />
            )}
            {!layer && <Caption>이미지를 열거나 왼쪽에서 글자·도형을 추가하세요.</Caption>}
          </section>
          <section className={s.panel} hidden={panel !== "adjustments"} aria-label="색 보정 패널">
            {layer?.kind === "pixel" && (
              <ColorInspector
                layer={layer}
                pending={drafts.current.get(layer.id)?.adjustments}
                disabled={disabled}
                onPreview={previewTone}
                onDraft={(id, adjustments) => stageDraft(id, { adjustments })}
                onApply={applyDrafts}
              />
            )}
            {layer?.kind !== "pixel" && <Caption>색을 보정할 이미지 레이어를 선택하세요.</Caption>}
          </section>
          <section className={s.panel} hidden={panel !== "tools"} aria-label="도구 설정 패널">
            <ToolSettings
              doc={doc}
              layer={layer}
              tool={tool}
              edit={edit}
              worker={worker}
              disabled={disabled}
              rect={rect}
              setRect={setRect}
              polygon={polygon}
              setPolygon={setPolygon}
              corners={corners}
              setCorners={setCorners}
              corner={corner}
              setCorner={setCorner}
              perspectiveSize={perspectiveSize}
              setPerspectiveSize={setPerspectiveSize}
              selectionMode={selectionMode}
              setSelectionMode={setSelectionMode}
              tolerance={tolerance}
              setTolerance={setTolerance}
              contiguous={contiguous}
              setContiguous={setContiguous}
              brush={brush}
              setBrush={setBrush}
            />
          </section>
        </aside>
      </div>
      <ContentDialog
        open={noticesOpen}
        title="사용한 오픈소스"
        closeButtonText="닫기"
        onClose={() => setNoticesOpen(false)}
      >
        <Body className={s.notices}>{notices}</Body>
      </ContentDialog>
      <ContentDialog
        open={!!prompt}
        title={prompt?.title ?? "확인"}
        primaryButtonText={prompt?.primary ?? "확인"}
        {...(prompt?.secondary ? { secondaryButtonText: prompt.secondary } : {})}
        closeButtonText="취소"
        defaultButton="close"
        onClose={(r) => {
          setPrompt(null);
          const resolve = resolvePrompt.current;
          resolvePrompt.current = null;
          resolve?.(r);
        }}
      >
        {prompt?.description}
      </ContentDialog>
      <ContentDialog
        open={newOpen}
        title="새 투명 작업"
        primaryButtonText="만들기"
        closeButtonText="취소"
        onClose={(r) => {
          setNewOpen(false);
          if (r === "primary")
            void (async () => {
              if (flow.current) return;
              flow.current = true;
              setFlowBusy(true);
              try {
                if (!(await canReplace())) return;
                const next = createDocument(newSize.width, newSize.height);
                await install({ document: next, warnings: [], fonts: [], flattened: false }, false, "새 작업");
                addObject("pixel");
              } catch (e) {
                setMessage(errorText(e));
              } finally {
                flow.current = false;
                setFlowBusy(false);
              }
            })();
        }}
      >
        <div className={s.row}>
          <NumberBox
            header="새 작업 너비"
            value={newSize.width}
            min={1}
            max={10000}
            onChange={(width) => setNewSize((v) => ({ ...v, width }))}
          />
          <NumberBox
            header="새 작업 높이"
            value={newSize.height}
            min={1}
            max={10000}
            onChange={(height) => setNewSize((v) => ({ ...v, height }))}
          />
        </div>
      </ContentDialog>
      <ContentDialog
        open={!!fonts}
        title="이 PC에 없는 글꼴을 바꿔주세요"
        primaryButtonText="대체 글꼴로 열기"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(r) => {
          const pending = fonts;
          setFonts(null);
          const release = () => {
            setPendingInputName("");
            flow.current = false;
            setFlowBusy(false);
            resumePreview();
          };
          if (r !== "primary" || !pending) {
            release();
            return;
          }
          for (const item of pending.imported.document.layers)
            if (item.kind === "text" && pending.names.includes(item.text.fontFamily))
              item.text.fontFamily = replacement;
          pending.imported.warnings.push("글꼴을 바꿔 글자 배치가 달라질 수 있어요.");
          void install(pending.imported, pending.add, pending.name, pending.sourceHandle)
            .catch((e: unknown) => setMessage(errorText(e)))
            .finally(release);
        }}
      >
        <Body>없는 글꼴: {fonts?.names.join(", ")}</Body>
        <ComboBox header="대체 글꼴" value={replacement} options={FONT_OPTIONS} onChange={setReplacement} />
        <Caption>글자 내용은 수정할 수 있어요. 새 글꼴로 배치가 달라질 수 있어요.</Caption>
      </ContentDialog>
    </main>
  );
}
