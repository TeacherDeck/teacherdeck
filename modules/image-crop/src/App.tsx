// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { createDocumentSession } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ColorPicker,
  ContentDialog,
  DropZone,
  ImageCropPreview,
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  SettingsExpander,
  TextBox,
  ToolLayout,
  deckTokens,
  createDeckTheme,
  makeStyles,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RATIOS,
  DEFAULT_ANNOTATION,
  centeredRect,
  clampRect,
  orientedSize,
  outputSize,
  transferRect,
  rotateEdit,
  flipEdit,
  rotateRatio,
  type Edit,
  type Rect,
} from "./edit.ts";
import { OutputSession } from "./output-session.ts";
import { readImage, renderCrop, saveCrops, type CropItem } from "./batch.ts";
type SaveStatus = { state: "saved" | "failed" | "pending"; file: FileHandleInfo; folder?: FolderHandleInfo };
interface Item extends CropItem {
  ratio: string;
  initialPreview: Blob | undefined;
  past: { edit: Edit; ratio: string }[];
  future: { edit: Edit; ratio: string }[];
}
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  controls: {
    display: "grid",
    gridTemplateColumns: "repeat(4,minmax(0,1fr))",
    gap: deckTokens.inlineGap,
    "@media(max-width:600px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" },
  },
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.inlineGap },
});
const accepted = (file: FileHandleInfo) => /\.(jpe?g|png|webp)$/i.test(file.name);
const initialAnnotation = { ...DEFAULT_ANNOTATION, ink: createDeckTheme("light").colorNeutralForeground1 };
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const queued = useRef(new Map<string, FileHandleInfo>());
  const admitted = useRef(new Set<string>());
  const readyHandles = useRef(new Set<string>());
  const readingHandle = useRef<string | null>(null);
  const [index, setIndex] = useState(0);
  const current = items[index];
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [format, setFormat] = useState<"original" | "png" | "jpeg" | "webp">("original");
  const [advance, setAdvance] = useState(true);
  const destination = useRef<OutputSession | null>(null);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [pendingFiles, setPendingFiles] = useState<FileHandleInfo[]>([]);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const statusesRef = useRef(saveStatuses);
  statusesRef.current = saveStatuses;
  const formatRef = useRef(format);
  formatRef.current = format;
  const savedEdits = useRef(new Map<string, string>());
  const saveAction = useRef<() => Promise<void>>(async () => undefined);
  const saveChoice = useRef<{ all: boolean; retry: boolean; handle: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [clearPrompt, setClearPrompt] = useState(false);
  const signature = (item: Item) => JSON.stringify([item.edit, formatRef.current]);
  const unsaved = (item: Item) =>
    savedEdits.current.get(item.file.handle) !== signature(item) ||
    (statusesRef.current[item.file.handle] !== undefined && statusesRef.current[item.file.handle]?.state !== "saved");
  const isSaved = useRef<() => boolean>(() => true);
  isSaved.current = () => !itemsRef.current.some(unsaved);
  const session = useMemo(
    () =>
      createDocumentSession(deck, {
        save: () => saveAction.current(),
        isSaved: () => isSaved.current(),
        onError: () => setMessage("편집 내용을 보호하거나 저장하지 못했어요. 내용을 유지하고 다시 시도해 주세요."),
      }),
    [deck],
  );
  useEffect(() => {
    let active = true;
    void session.ready
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setMessage("편집 보호를 준비하지 못했어요. 이 도구를 다시 열어 주세요.");
      });
    return () => {
      active = false;
      session.dispose();
    };
  }, [session]);
  function commitItems(next: Item[]) {
    itemsRef.current = next;
    setItems(next);
  }
  function commitStatuses(next: Record<string, SaveStatus>) {
    statusesRef.current = next;
    setSaveStatuses(next);
  }
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<FileHandleInfo[]>([]);
  const size = current
    ? orientedSize(current.sourceWidth, current.sourceHeight, current.edit.turns)
    : { width: 1, height: 1 };
  const ratio = RATIOS.find((r) => r.value === current?.ratio)?.ratio ?? 0;
  useEffect(() => {
    if (!current) {
      setPreview("");
      return;
    }
    const abort = new AbortController();
    let active = true;
    let url = "";
    setPreview("");
    setPreviewing(true);
    const run = async () => {
      try {
        const blob =
          current.initialPreview &&
          current.edit.turns === 0 &&
          !current.edit.flipX &&
          !current.edit.flipY &&
          (current.edit.brightness ?? 100) === 100 &&
          (current.edit.contrast ?? 100) === 100 &&
          !current.edit.annotation
            ? current.initialPreview
            : (
                await renderCrop(
                  {
                    bytes: current.bytes ?? (await readImage(deck, current.file, abort.signal)),
                    edit: current.edit,
                    preview: true,
                    format: "png",
                  },
                  abort.signal,
                )
              ).blob;
        if (active) {
          url = URL.createObjectURL(blob);
          setPreview(url);
        }
      } catch {
        if (active && !abort.signal.aborted)
          setMessage("사진 미리보기를 만들지 못했어요. 다른 사진을 선택하거나 다시 추가해 주세요.");
      } finally {
        if (active) setPreviewing(false);
      }
    };
    void run();
    return () => {
      active = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [
    deck,
    current?.file.handle,
    current?.bytes,
    current?.edit.turns,
    current?.edit.flipX,
    current?.edit.flipY,
    current?.edit.brightness,
    current?.edit.contrast,
    current?.edit.annotation,
  ]);
  useEffect(
    () => () => {
      controller.current?.abort();
      void destination.current?.close().catch(() => undefined);
    },
    [],
  );
  function resetDestination() {
    void destination.current?.close().catch(() => setMessage("저장 작업을 정리하지 못했어요. 저장한 결과는 유지해요."));
    destination.current = null;
  }
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        if (!files.length) {
          setMessage("폴더나 읽을 수 없는 파일은 추가하지 않았어요. 지원하는 파일을 놓아주세요.");
          return;
        }
        void addFiles(files);
      }),
    [deck],
  );
  function changeCurrent(change: (item: Item) => Item) {
    if (locked.current || !current) return;
    const selectedHandle = current.file.handle;
    void session.change(() =>
      commitItems(
        itemsRef.current.map((item) =>
          item.file.handle === selectedHandle
            ? {
                ...change(item),
                past: [...item.past.slice(-19), { edit: structuredClone(item.edit), ratio: item.ratio }],
                future: [],
              }
            : item,
        ),
      ),
    );
  }
  function undo(redo = false) {
    if (locked.current || !current) return;
    const selectedHandle = current.file.handle;
    void session.change(() =>
      commitItems(
        itemsRef.current.map((item) => {
          if (item.file.handle !== selectedHandle) return item;
          const from = redo ? item.future : item.past;
          const previous = from.at(-1);
          if (!previous) return item;
          const now = { edit: structuredClone(item.edit), ratio: item.ratio };
          return {
            ...item,
            ...previous,
            past: redo ? [...item.past.slice(-19), now] : item.past.slice(0, -1),
            future: redo ? item.future.slice(0, -1) : [...item.future.slice(-19), now],
          };
        }),
      ),
    );
  }
  function replaceRect(rect: Rect) {
    if (locked.current || !current) return;
    const fixed = clampRect(rect, size.width, size.height, ratio);
    changeCurrent((item) => ({ ...item, edit: { ...item.edit, rect: fixed } }));
  }
  async function addFiles(files: FileHandleInfo[]) {
    if (!files.length) return;
    const incoming = [...new Map(files.filter(accepted).map((file) => [file.handle, file])).values()].filter(
      (file) =>
        !readyHandles.current.has(file.handle) &&
        readingHandle.current !== file.handle &&
        !queued.current.has(file.handle),
    );
    if (!incoming.length) {
      setMessage(
        files.every(accepted)
          ? "이미 추가한 사진이에요. 입력 목록에서 확인해 주세요."
          : "JPG·PNG·WebP 정지 이미지를 추가해 주세요.",
      );
      return;
    }
    if (new Set([...admitted.current, ...incoming.map((f) => f.handle)]).size > 1000) {
      setMessage("한 작업에 1,000개까지 추가해요. 현재 작업을 저장한 뒤 목록을 비워 주세요.");
      return;
    }
    for (const file of incoming) {
      queued.current.set(file.handle, file);
      admitted.current.add(file.handle);
    }
    setPendingFiles((current) => [...new Map([...current, ...incoming].map((file) => [file.handle, file])).values()]);
    setMessage(`${incoming.length}개 사진을 입력했어요. 사진을 읽는 중이에요.`);
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(incoming.length);
    setDone(0);
    let count = 0;
    let attempted = 0;
    let cumulative = itemsRef.current.reduce((sum, item) => sum + (item.bytes?.length ?? 0), 0);
    let previewBytes = itemsRef.current.reduce((sum, item) => sum + (item.initialPreview?.size ?? 0), 0);
    try {
      while (queued.current.size) {
        if (abort.signal.aborted) break;
        const file = queued.current.values().next().value;
        if (!file) break;
        queued.current.delete(file.handle);
        readingHandle.current = file.handle;
        try {
          const bytes = await readImage(deck, file, abort.signal);
          const edit = { turns: 0, flipX: false, flipY: false, rect: { x: 0, y: 0, width: 1, height: 1 } };
          const image = await renderCrop({ bytes, edit, preview: true, format: "png" }, abort.signal);
          edit.rect = centeredRect(image.sourceWidth, image.sourceHeight);
          if (abort.signal.aborted) {
            setFailed((all) => [...new Map([...all, file].map((f) => [f.handle, f])).values()]);
            break;
          }
          const cachedBytes = cumulative + bytes.length <= 128 * 1024 * 1024 ? bytes : undefined;
          cumulative += cachedBytes?.length ?? 0;
          // Bound retained preview memory separately from original encoded inputs.
          const cachedPreview = previewBytes + image.blob.size <= 32 * 1024 * 1024 ? image.blob : undefined;
          previewBytes += cachedPreview?.size ?? 0;
          readyHandles.current.add(file.handle);
          const item: Item = {
            file,
            bytes: cachedBytes,
            sourceWidth: image.sourceWidth,
            sourceHeight: image.sourceHeight,
            edit,
            ratio: "free",
            initialPreview: cachedPreview,
            past: [],
            future: [],
          };
          savedEdits.current.set(file.handle, signature(item));
          commitItems([...itemsRef.current, item]);
          setFailed((all) => all.filter((f) => f.handle !== file.handle));
          count++;
        } catch {
          setFailed((all) => [...new Map([...all, file].map((f) => [f.handle, f])).values()]);
        }
        readingHandle.current = null;
        setPendingFiles((current) => current.filter((input) => input.handle !== file.handle));
        setDone(++attempted);
        setTotal((n) => Math.max(n, attempted + queued.current.size));
      }
      setMessage(
        abort.signal.aborted ? "읽기를 취소했어요. 이미 확인한 사진은 유지해요." : `${count}개 사진을 추가했어요.`,
      );
    } finally {
      if (queued.current.size) {
        const pending = [...queued.current.values()];
        queued.current.clear();
        setFailed((all) => [...new Map([...all, ...pending].map((f) => [f.handle, f])).values()]);
      }
      locked.current = false;
      setPendingFiles([]);
      readingHandle.current = null;
      setBusy(false);
      controller.current = null;
    }
  }
  async function pick() {
    try {
      await addFiles(
        await deck.fs.pickFiles({
          multiple: true,
          filters: [{ name: "이미지", extensions: ["jpg", "jpeg", "png", "webp"] }],
        }),
      );
    } catch {
      setMessage("사진을 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  function rotate() {
    if (!current || locked.current) return;
    changeCurrent((item) => ({
      ...item,
      ratio: rotateRatio(item.ratio),
      edit: rotateEdit(item.edit, item.sourceWidth, item.sourceHeight),
    }));
  }
  function flip(axis: "flipX" | "flipY") {
    if (!current || locked.current) return;
    changeCurrent((item) => ({ ...item, edit: flipEdit(item.edit, item.sourceWidth, item.sourceHeight, axis) }));
  }
  function applyAll() {
    if (!current || locked.current) return;
    const selectedHandle = current.file.handle;
    void session.change(() => {
      const source = itemsRef.current.find((item) => item.file.handle === selectedHandle);
      if (!source) return;
      const from = orientedSize(source.sourceWidth, source.sourceHeight, source.edit.turns);
      const selectedRatio = RATIOS.find((entry) => entry.value === source.ratio)?.ratio ?? 0;
      commitItems(
        itemsRef.current.map((item) => {
          const target = orientedSize(item.sourceWidth, item.sourceHeight, source.edit.turns);
          return {
            ...item,
            past: [...item.past.slice(-19), { edit: structuredClone(item.edit), ratio: item.ratio }],
            future: [],
            ratio: source.ratio,
            edit: { ...source.edit, rect: transferRect(source.edit.rect, from, target, selectedRatio) },
          };
        }),
      );
    });
    setMessage("회전·반전·비율과 사진 안의 상대적인 자르기 범위를 모두 적용했어요. 사진을 하나씩 확인해 주세요.");
  }
  async function chooseDestination() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const picked = await deck.fs.pickFolder();
      if (picked) {
        resetDestination();
        setParent(picked);
      }
    } catch {
      setMessage("폴더를 선택하지 못했어요. 다시 선택해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
      if (queued.current.size) {
        const pending = [...queued.current.values()];
        queued.current.clear();
        void addFiles(pending);
      }
    }
  }
  async function save(all = false, retry = false) {
    if (locked.current || !current || saveChoice.current) return;
    saveChoice.current = { all, retry, handle: current.file.handle };
    try {
      await session.save();
    } finally {
      saveChoice.current = null;
    }
  }
  async function performSave() {
    if (locked.current) throw new Error("BUSY");
    const choice = saveChoice.current;
    const selected =
      choice === null
        ? itemsRef.current.filter(unsaved)
        : choice.retry
          ? itemsRef.current.filter((item) => statusesRef.current[item.file.handle] && unsaved(item))
          : choice.all
            ? itemsRef.current
            : itemsRef.current.filter((item) => item.file.handle === choice.handle);
    if (!selected.length) return;
    locked.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    destination.current ??= new OutputSession(deck, parent?.handle);
    setTotal(selected.length);
    setDone(0);
    try {
      const result = await saveCrops(
        deck,
        selected,
        formatRef.current,
        abort.signal,
        setDone,
        renderCrop,
        destination.current,
      );
      if (!result) throw new Error("SAVE_CANCELLED");
      if (result) {
        setFolder(result.folder);
        commitStatuses(
          (() => {
            const previous = statusesRef.current;
            const next = { ...previous };
            const saved = new Set(result.saved);
            const failed = new Set(result.failed);
            for (const item of selected) {
              if (saved.has(item.file.handle)) savedEdits.current.set(item.file.handle, signature(item));
              if (!saved.has(item.file.handle) && !failed.has(item.file.handle) && previous[item.file.handle]) continue;
              const savedFolder = result.folders?.[item.file.handle];
              next[item.file.handle] = {
                file: item.file,
                state: saved.has(item.file.handle) ? "saved" : failed.has(item.file.handle) ? "failed" : "pending",
                ...(savedFolder ? { folder: savedFolder } : {}),
              };
            }
            return next;
          })(),
        );
        setMessage(
          `${result.saved.length}개 저장했어요.${result.failed.length ? ` ${result.failed.length}개는 저장하지 못했어요. 현재 편집은 유지해요.` : ""}${result.formatUnavailable?.length ? " 이 PC에서 지원하지 않는 저장 형식이 있어요. 저장 형식을 직접 선택해 다시 시도해 주세요." : ""}${result.cancelled ? " 취소했어요. 저장된 결과는 각 저장 위치에 남아요." : ""}`,
        );
        if (result.destinationExpired) {
          resetDestination();
          setMessage(
            "저장 작업이 만료됐거나 결과 폴더를 사용할 수 없어요. 저장하지 못한 사진 재시도를 누르고 폴더를 다시 선택해 주세요. 이전 결과는 유지해요.",
          );
        }
        if (choice && !choice.all && !choice.retry && advance && result.saved.includes(choice.handle)) {
          const savedIndex = itemsRef.current.findIndex((item) => item.file.handle === choice.handle);
          if (savedIndex >= 0 && savedIndex < itemsRef.current.length - 1) setIndex(savedIndex + 1);
        }
      }
    } catch {
      commitStatuses(
        (() => {
          const next = { ...statusesRef.current };
          for (const item of selected) next[item.file.handle] = { file: item.file, state: "failed" };
          return next;
        })(),
      );
      setMessage("결과를 저장하지 못했어요. 편집 내용은 유지해요. 폴더와 저장 공간을 확인해 주세요.");
      throw new Error("SAVE_FAILED");
    } finally {
      locked.current = false;
      setBusy(false);
      controller.current = null;
      if (queued.current.size) {
        const pending = [...queued.current.values()];
        queued.current.clear();
        if (abort.signal.aborted)
          setFailed((all) => [...new Map([...all, ...pending].map((f) => [f.handle, f])).values()]);
        else void addFiles(pending);
      }
    }
  }
  saveAction.current = performSave;
  function clearItems() {
    commitItems([]);
    savedEdits.current.clear();
    queued.current.clear();
    admitted.current.clear();
    readyHandles.current.clear();
    setIndex(0);
    setFailed([]);
    resetDestination();
    commitStatuses({});
    setFolder(null);
    setMessage("");
    // The user explicitly discarded the edits; the now-empty workspace has no pending output.
    void session.save();
  }
  const disabled = !ready || busy || previewing;
  return (
    <ToolLayout title="이미지 자르기" description="사진 위를 끌어 영역을 고르고, 회전·반전해 새 파일로 저장해요.">
      <ToolLayout.Section step="input" title="사진 추가">
        <div className={s.actions}>
          <Button disabled={busy} onClick={() => void chooseDestination()}>
            저장 폴더 선택
          </Button>
          <Button
            disabled={busy || !parent}
            onClick={() => {
              resetDestination();
              setParent(null);
            }}
          >
            원본 폴더에 저장
          </Button>
          <Caption>{parent ? `저장 위치: ${parent.name}` : "원본 파일과 같은 폴더에 저장해요."}</Caption>
        </div>
        {pendingFiles.length > 0 && (
          <div>
            <Caption aria-live="polite">입력한 파일 {pendingFiles.length}개 · 읽는 중</Caption>
            <ListView
              header={`입력한 파일 ${pendingFiles.length}개 · 읽는 중`}
              items={pendingFiles}
              getKey={(file) => file.handle}
              renderItem={(file) => <Body>{file.name} · 파일 입력됨</Body>}
            />
          </div>
        )}
        <div className={s.actions}>
          <Button
            appearance={items.length ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => {
              void pick();
            }}
          >
            파일 추가
          </Button>
          <Button
            appearance="primary"
            disabled={disabled || !current}
            onClick={() => {
              void save();
            }}
          >
            현재 사진 저장
          </Button>
          <Button
            disabled={disabled || !items.length}
            onClick={() => {
              void save(true);
            }}
          >
            전체 사진 저장
          </Button>
          <Button disabled={!busy} onClick={() => controller.current?.abort()}>
            취소
          </Button>
          <Button
            disabled={busy || (!items.length && !failed.length)}
            onClick={() => {
              void session
                .settle()
                .then(() => {
                  if (isSaved.current()) clearItems();
                  else setClearPrompt(true);
                })
                .catch(() => setMessage("편집 보호 상태를 확인하지 못했어요. 다시 시도해 주세요."));
            }}
          >
            목록 비우기
          </Button>
        </div>
        {!items.length && !busy && (
          <DropZone
            onPick={() => {
              void pick();
            }}
            description="JPG·PNG·WebP 사진을 끌어 놓거나 선택해 주세요."
          />
        )}
        {failed.length > 0 && (
          <ListView
            header="읽지 못한 사진"
            items={failed}
            getKey={(file) => file.handle}
            renderItem={(file) => (
              <div className={s.actions}>
                <Body>{file.name}</Body>
                <Caption secondary>64MiB·2,400만 화소 이하의 정지 이미지인지 확인해 주세요.</Caption>
                <Button
                  disabled={busy}
                  onClick={() => {
                    void addFiles([file]);
                  }}
                >
                  다시 읽기
                </Button>
              </div>
            )}
          />
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="회전과 저장 형식">
        <div className={s.actions}>
          <Button disabled={disabled || !current} onClick={rotate}>
            오른쪽으로 90도 회전
          </Button>
          <Button disabled={disabled || !current} onClick={() => flip("flipX")}>
            좌우 반전
          </Button>
          <Button disabled={disabled || !current} onClick={() => flip("flipY")}>
            상하 반전
          </Button>
          <Button disabled={disabled || !current?.past.length} onClick={() => undo()}>
            편집 되돌리기
          </Button>
          <Button disabled={disabled || !current?.future.length} onClick={() => undo(true)}>
            편집 다시 적용
          </Button>
          <ComboBox
            header="저장 형식"
            value={format}
            disabled={busy}
            options={[
              { value: "original", label: "원본 형식 유지" },
              { value: "png", label: "PNG · 투명도 유지" },
              { value: "jpeg", label: "JPG · 흰 배경" },
              { value: "webp", label: "WebP · 투명도 유지" },
            ]}
            onChange={(value) => {
              const next = value === "jpeg" || value === "png" || value === "webp" ? value : "original";
              if (next === formatRef.current) return;
              void session.change(() => {
                formatRef.current = next;
                setFormat(next);
              });
            }}
          />
        </div>
        <Caption secondary>
          회전·반전해도 같은 대상을 자르도록 영역을 함께 옮겨요. 결과 파일에는 촬영 정보가 들어가지 않아요.
        </Caption>
        {items.some(unsaved) && <Caption>저장하지 않은 편집이 있어요.</Caption>}
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="자르기 영역">
        {current ? (
          <div className={s.stack}>
            <div className={s.actions}>
              <Button disabled={busy || index === 0} onClick={() => setIndex(index - 1)}>
                이전 사진
              </Button>
              <ComboBox
                header="편집할 사진"
                value={String(index)}
                disabled={busy}
                options={items.map((item, i) => ({ value: String(i), label: `${i + 1}. ${item.file.name}` }))}
                onChange={(value) => setIndex(Number(value))}
              />
              <Button disabled={busy || index === items.length - 1} onClick={() => setIndex(index + 1)}>
                다음 사진
              </Button>
              <Caption>
                {index + 1}/{items.length}
              </Caption>
            </div>
            {preview ? (
              <ImageCropPreview
                header="사진에서 자를 영역"
                alt={current.file.name}
                src={preview}
                imageWidth={size.width}
                imageHeight={size.height}
                rect={current.edit.rect}
                onRectChange={replaceRect}
                disabled={busy}
              />
            ) : (
              <Caption>사진을 준비하는 중이에요.</Caption>
            )}
            <div className={s.actions}>
              <ComboBox
                header="자르기 비율"
                value={current.ratio}
                options={RATIOS.map((r) => ({ value: r.value, label: r.label }))}
                disabled={disabled}
                onChange={(value) => {
                  const r = RATIOS.find((entry) => entry.value === value)?.ratio ?? 0;
                  changeCurrent((item) => ({
                    ...item,
                    ratio: value,
                    edit: { ...item.edit, rect: centeredRect(size.width, size.height, r) },
                  }));
                }}
              />
              <Button disabled={disabled} onClick={() => replaceRect(centeredRect(size.width, size.height, ratio))}>
                영역 초기화
              </Button>
              <Button disabled={disabled || items.length < 2} onClick={applyAll}>
                현재 설정을 모두 적용
              </Button>
            </div>
            <SettingsExpander
              header="픽셀로 정확하게 지정"
              description={`${current.edit.rect.width} × ${current.edit.rect.height}px 결과`}
            >
              <div className={s.controls}>
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <NumberBox
                    key={key}
                    header={{ x: "왼쪽 X", y: "위쪽 Y", width: "너비", height: "높이" }[key]}
                    value={current.edit.rect[key]}
                    min={key === "x" || key === "y" ? 0 : 1}
                    max={
                      key === "x"
                        ? size.width - 1
                        : key === "y"
                          ? size.height - 1
                          : key === "width"
                            ? size.width
                            : size.height
                    }
                    disabled={disabled}
                    onChange={(value) =>
                      replaceRect({
                        ...current.edit.rect,
                        [key]: value,
                        ...(ratio > 0 && key === "width"
                          ? { height: value / ratio }
                          : ratio > 0 && key === "height"
                            ? { width: value * ratio }
                            : {}),
                      })
                    }
                  />
                ))}
              </div>
            </SettingsExpander>
            <SettingsExpander header="크기·밝기·대비" description="원본은 유지하고 저장할 이미지에 적용해요">
              <div className={s.controls}>
                <NumberBox
                  header="저장 너비 (px)"
                  value={current.edit.outputWidth ?? current.edit.rect.width}
                  min={1}
                  max={Math.min(
                    10000,
                    Math.floor(Math.sqrt((24_000_000 * current.edit.rect.width) / current.edit.rect.height)),
                    Math.floor((10000 * current.edit.rect.width) / current.edit.rect.height),
                  )}
                  disabled={disabled}
                  onChange={(outputWidth) =>
                    changeCurrent((item) => ({ ...item, edit: { ...item.edit, outputWidth } }))
                  }
                />
                <NumberBox
                  header="밝기 (%)"
                  value={current.edit.brightness ?? 100}
                  min={0}
                  max={200}
                  disabled={disabled}
                  onChange={(brightness) => changeCurrent((item) => ({ ...item, edit: { ...item.edit, brightness } }))}
                />
                <NumberBox
                  header="대비 (%)"
                  value={current.edit.contrast ?? 100}
                  min={0}
                  max={200}
                  disabled={disabled}
                  onChange={(contrast) => changeCurrent((item) => ({ ...item, edit: { ...item.edit, contrast } }))}
                />
              </div>
              <Caption>저장 높이는 자르기 비율에 맞춰요. 최대 한 변 10,000px·2,400만 화소예요.</Caption>
              <Caption>
                {(() => {
                  try {
                    const out = outputSize(current.edit);
                    return `저장 크기 ${out.width} × ${out.height}px`;
                  } catch {
                    return "저장 크기가 한도를 넘어요. 너비를 줄여 주세요.";
                  }
                })()}
              </Caption>
            </SettingsExpander>
            <SettingsExpander header="텍스트·사각형 표시" description="사진 전체를 기준으로 위치를 정해요">
              <ComboBox
                header="표시 종류"
                value={current.edit.annotation?.kind ?? "none"}
                disabled={disabled}
                options={[
                  { value: "none", label: "표시 없음" },
                  { value: "text", label: "한 줄 텍스트" },
                  { value: "rectangle", label: "사각형 테두리" },
                ]}
                onChange={(kind) =>
                  changeCurrent((item) => ({
                    ...item,
                    edit: {
                      ...item.edit,
                      annotation:
                        kind === "none"
                          ? undefined
                          : {
                              ...(item.edit.annotation ?? initialAnnotation),
                              kind: kind === "text" ? "text" : "rectangle",
                            },
                    },
                  }))
                }
              />
              {current.edit.annotation && (
                <>
                  {current.edit.annotation.kind === "text" && (
                    <TextBox
                      header="사진에 넣을 텍스트"
                      value={current.edit.annotation.text}
                      disabled={disabled}
                      onChange={(text) => {
                        if (text.length <= 200 && !Array.from(text).some((c) => c.charCodeAt(0) < 32))
                          changeCurrent((item) => ({
                            ...item,
                            edit: {
                              ...item.edit,
                              annotation: { ...(item.edit.annotation ?? initialAnnotation), text },
                            },
                          }));
                      }}
                    />
                  )}
                  <ColorPicker
                    header="표시 색"
                    value={current.edit.annotation.ink}
                    disabled={disabled}
                    onChange={(color) =>
                      changeCurrent((item) => ({
                        ...item,
                        edit: {
                          ...item.edit,
                          annotation: { ...(item.edit.annotation ?? initialAnnotation), ink: color },
                        },
                      }))
                    }
                  />
                  <div className={s.controls}>
                    {(
                      [
                        "x",
                        "y",
                        ...(current.edit.annotation.kind === "rectangle" ? ["width", "height"] : ["textPixels"]),
                      ] as const
                    ).map((field) => {
                      const key = field as "x" | "y" | "width" | "height" | "textPixels";
                      return (
                        <NumberBox
                          key={key}
                          header={
                            {
                              x: "표시 왼쪽 (%)",
                              y: "표시 위쪽 (%)",
                              width: "표시 너비 (%)",
                              height: "표시 높이 (%)",
                              textPixels: "원본 글자 크기 (px)",
                            }[key]
                          }
                          value={(current.edit.annotation ?? initialAnnotation)[key]}
                          min={key === "x" || key === "y" ? 0 : 1}
                          max={key === "textPixels" ? 500 : 100}
                          disabled={disabled}
                          onChange={(value) =>
                            changeCurrent((item) => ({
                              ...item,
                              edit: {
                                ...item.edit,
                                annotation: { ...(item.edit.annotation ?? initialAnnotation), [key]: value },
                              },
                            }))
                          }
                        />
                      );
                    })}
                  </div>
                  <Caption>
                    자르기 밖의 표시는 결과에 포함되지 않아요. 사진의 한 줄 주석이며 개인정보 가리기 기능은 아니에요.
                  </Caption>
                </>
              )}
            </SettingsExpander>
            <Caption secondary>
              사진을 끌면 새 영역, 영역 안을 끌면 이동, 모서리를 끌면 크기를 바꿔요. 방향키로 이동하고 Shift+방향키로
              크기를 바꿀 수 있어요.
            </Caption>
          </div>
        ) : (
          <Caption>사진을 추가하면 자를 영역을 고를 수 있어요.</Caption>
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="순서대로 저장">
        <CheckBox
          checked={advance}
          content="현재 사진을 저장하면 다음 사진으로 이동"
          disabled={busy}
          onChange={setAdvance}
        />
        <Caption secondary>
          각 원본과 같은 폴더에 저장해요. 저장 폴더를 따로 선택하면 그 폴더에 직접 저장해요. 같은 사진을 다시 저장하면
          새 이름을 붙여요. 원본은 수정하지 않아요.
        </Caption>

        {busy && <ProgressBar header="처리 진행" value={total ? (done / total) * 100 : 0} />}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="처리 결과">
        {message && <InfoBar severity="informational" message={message} />}{" "}
        {Object.keys(saveStatuses).length > 0 && (
          <ListView
            header="사진별 저장 결과"
            items={Object.values(saveStatuses)}
            getKey={(result) => result.file.handle}
            renderItem={(result) => (
              <div className={s.actions}>
                <Body>
                  {result.file.name} ·{" "}
                  {items.some(
                    (item) =>
                      item.file.handle === result.file.handle &&
                      savedEdits.current.get(item.file.handle) !== signature(item),
                  )
                    ? "편집 변경 · 다시 저장해 주세요"
                    : result.state === "saved"
                      ? "저장했어요"
                      : result.state === "failed"
                        ? "저장 실패 · 폴더 권한과 저장 공간을 확인해 주세요"
                        : "아직 저장하지 않았어요"}
                </Body>
                {result.folder && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void deck.fs
                        .reveal(result.folder?.handle ?? "")
                        .catch(() => setMessage("결과 폴더를 열지 못했어요. 저장한 폴더에서 확인해 주세요."));
                    }}
                  >
                    저장 위치 열기
                  </Button>
                )}
              </div>
            )}
          />
        )}
        <Button
          disabled={busy || !items.some((item) => saveStatuses[item.file.handle] && unsaved(item))}
          onClick={() => {
            void save(false, true);
          }}
        >
          저장하지 못한 사진 재시도
        </Button>
        {folder && (
          <Button
            onClick={() => {
              void deck.fs
                .reveal(folder.handle)
                .catch(() => setMessage("결과 폴더를 열지 못했어요. 저장한 폴더에서 확인해 주세요."));
            }}
          >
            결과 폴더 열기
          </Button>
        )}
      </ToolLayout.Section>
      {clearPrompt && (
        <ContentDialog
          open
          title="편집 내용을 버리고 목록을 비울까요?"
          primaryButtonText="버리기"
          closeButtonText="계속 편집"
          onClose={(result) => {
            setClearPrompt(false);
            if (result === "primary") clearItems();
          }}
        >
          저장하지 않은 자르기·회전·표시 설정이 사라져요. 원본과 이미 저장한 파일은 유지해요.
        </ContentDialog>
      )}
    </ToolLayout>
  );
}
