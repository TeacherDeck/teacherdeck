// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  DropZone,
  ImageCropPreview,
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  SettingsExpander,
  ToolLayout,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { RATIOS, centeredRect, clampRect, orientedSize, transferRect, type Rect } from "./edit.ts";
import { readImage, renderCrop, saveCrops, type CropItem } from "./batch.ts";
interface Item extends CropItem {
  ratio: string;
  initialPreview: Blob | undefined;
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
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const current = items[index];
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [advance, setAdvance] = useState(true);
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
          current.initialPreview && current.edit.turns === 0 && !current.edit.flipX && !current.edit.flipY
            ? current.initialPreview
            : (
                await renderCrop(
                  { bytes: current.bytes, edit: current.edit, preview: true, format: "png" },
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
  }, [current?.bytes, current?.edit.turns, current?.edit.flipX, current?.edit.flipY]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        void addFiles(files);
      }),
    [deck, items],
  );
  function replaceRect(rect: Rect) {
    if (locked.current || !current) return;
    const fixed = clampRect(rect, size.width, size.height, ratio);
    setItems((all) => all.map((item, i) => (i === index ? { ...item, edit: { ...item.edit, rect: fixed } } : item)));
  }
  async function addFiles(files: FileHandleInfo[]) {
    if (locked.current) return;
    const incoming = [...new Map(files.filter(accepted).map((file) => [file.handle, file])).values()].filter(
      (file) => !items.some((item) => item.file.handle === file.handle),
    );
    if (!incoming.length) {
      setMessage("JPG·PNG·WebP 정지 이미지를 추가해 주세요.");
      return;
    }
    if (incoming.length + items.length > 100) {
      setMessage("한 번에 100개까지 확인해요. 저장 후 목록을 비워 주세요.");
      return;
    }
    locked.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(incoming.length);
    setDone(0);
    let count = 0;
    let cumulative = items.reduce((sum, item) => sum + item.bytes.length, 0);
    let previewBytes = items.reduce((sum, item) => sum + (item.initialPreview?.size ?? 0), 0);
    try {
      for (const [i, file] of incoming.entries()) {
        if (abort.signal.aborted) break;
        try {
          const bytes = await readImage(deck, file, abort.signal);
          if (cumulative + bytes.length > 128 * 1024 * 1024) throw new Error("INPUT_LIMIT");
          const edit = { turns: 0, flipX: false, flipY: false, rect: { x: 0, y: 0, width: 1, height: 1 } };
          const image = await renderCrop({ bytes, edit, preview: true, format: "png" }, abort.signal);
          edit.rect = centeredRect(image.sourceWidth, image.sourceHeight);
          if (abort.signal.aborted) break;
          cumulative += bytes.length;
          // Bound retained preview memory separately from original encoded inputs.
          const cachedPreview = previewBytes + image.blob.size <= 32 * 1024 * 1024 ? image.blob : undefined;
          previewBytes += cachedPreview?.size ?? 0;
          setItems((all) => [
            ...all,
            {
              file,
              bytes,
              sourceWidth: image.sourceWidth,
              sourceHeight: image.sourceHeight,
              edit,
              ratio: "free",
              initialPreview: cachedPreview,
            },
          ]);
          setFailed((all) => all.filter((f) => f.handle !== file.handle));
          count++;
        } catch {
          if (!abort.signal.aborted)
            setFailed((all) => [...new Map([...all, file].map((f) => [f.handle, f])).values()]);
        }
        setDone(i + 1);
      }
      setMessage(
        abort.signal.aborted ? "읽기를 취소했어요. 이미 확인한 사진은 유지해요." : `${count}개 사진을 추가했어요.`,
      );
    } finally {
      locked.current = false;
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
    const turns = (current.edit.turns + 1) % 4;
    const nextSize = orientedSize(current.sourceWidth, current.sourceHeight, turns);
    setItems((all) =>
      all.map((item, i) =>
        i === index
          ? { ...item, edit: { ...item.edit, turns, rect: centeredRect(nextSize.width, nextSize.height, ratio) } }
          : item,
      ),
    );
  }
  function flip(axis: "flipX" | "flipY") {
    if (!current || locked.current) return;
    setItems((all) =>
      all.map((item, i) => (i === index ? { ...item, edit: { ...item.edit, [axis]: !item.edit[axis] } } : item)),
    );
  }
  function applyAll() {
    if (!current || locked.current) return;
    setItems((all) =>
      all.map((item) => {
        const target = orientedSize(item.sourceWidth, item.sourceHeight, current.edit.turns);
        return {
          ...item,
          ratio: current.ratio,
          edit: { ...current.edit, rect: transferRect(current.edit.rect, size, target, ratio) },
        };
      }),
    );
    setMessage("회전·반전·비율과 사진 안의 상대적인 자르기 범위를 모두 적용했어요. 사진을 하나씩 확인해 주세요.");
  }
  async function save(all = false) {
    if (locked.current || !current) return;
    locked.current = true;
    setBusy(true);
    setFolder(null);
    const abort = new AbortController();
    controller.current = abort;
    const selected = all ? items : [current];
    setTotal(selected.length);
    setDone(0);
    try {
      const result = await saveCrops(deck, selected, format, abort.signal, setDone);
      if (result) {
        setFolder(result.folder);
        setMessage(
          `${result.saved.length}개 저장했어요.${result.failed.length ? ` ${result.failed.length}개는 저장하지 못했어요. 현재 편집은 유지해요.` : ""}${result.cancelled ? " 취소했어요. 저장된 결과는 새 폴더에 남아요." : ""}`,
        );
        if (!all && advance && result.saved.includes(current.file.handle) && index < items.length - 1)
          setIndex(index + 1);
      }
    } catch {
      setMessage("결과를 저장하지 못했어요. 편집 내용은 유지해요. 폴더와 저장 공간을 확인해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  const disabled = busy || previewing;
  return (
    <ToolLayout title="이미지 자르기" description="사진 위를 끌어 영역을 고르고, 회전·반전해 새 파일로 저장해요.">
      <ToolLayout.Section step="input" title="사진 추가">
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
              setItems([]);
              setIndex(0);
              setFailed([]);
              setFolder(null);
              setMessage("");
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
          <ComboBox
            header="저장 형식"
            value={format}
            disabled={busy}
            options={[
              { value: "png", label: "PNG · 투명도 유지" },
              { value: "jpeg", label: "JPG · 흰 배경" },
            ]}
            onChange={(value) => setFormat(value === "jpeg" ? "jpeg" : "png")}
          />
        </div>
        <Caption secondary>
          회전하면 자르기 영역을 선택한 비율로 다시 잡아요. 결과 파일에는 촬영 정보가 들어가지 않아요.
        </Caption>
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
                  setItems((all) =>
                    all.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            ratio: value,
                            edit: { ...item.edit, rect: centeredRect(size.width, size.height, r) },
                          }
                        : item,
                    ),
                  );
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
        <Caption secondary>저장할 때 폴더를 선택하고 그 안에 새 결과 폴더를 만들어요. 원본은 수정하지 않아요.</Caption>
        {busy && <ProgressBar header="처리 진행" value={total ? done / total : 0} />}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="처리 결과">
        {message && <InfoBar severity="informational" message={message} />}{" "}
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
    </ToolLayout>
  );
}
