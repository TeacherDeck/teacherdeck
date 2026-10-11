// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { DeckCallError, type Deck } from "@deck/sdk";
import {
  BodyStrong,
  Button,
  Caption,
  ComboBox,
  EmptyState,
  Image,
  InfoBar,
  PageHeader,
  ProgressRing,
  RadioButtons,
  SettingsCard,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { ArrowDownloadRegular, DismissRegular, FolderOpenRegular, QrCodeRegular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateQr, type GenerateQr } from "./generate.ts";
import { QrOutput } from "./output.ts";
import {
  prepareInput,
  svgPreview,
  toPngBlob,
  toSvgBlob,
  type InputMode,
  type OutputFormat,
  type QrImage,
} from "./qr.ts";

const useStyles = makeStyles({
  page: {
    padding: deckTokens.pagePadding,
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.sectionGap,
    minWidth: 0,
  },
  workspace: { display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: deckTokens.sectionGap },
  input: { flex: "2 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  preview: {
    flex: "1 1 240px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: deckTokens.itemGap,
    padding: deckTokens.cardPadding,
    backgroundColor: deckTokens.layer,
    borderRadius: deckTokens.cardRadius,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
  },
  image: { width: "100%", maxWidth: "320px", height: "auto", imageRendering: "pixelated" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  actions: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
});

export function App({ deck, generate = generateQr }: { deck: Deck; generate?: GenerateQr }) {
  const s = useStyles();
  const [mode, setMode] = useState<InputMode>("link");
  const [input, setInput] = useState("");
  const [format, setFormat] = useState<OutputFormat>("png");
  const [preview, setPreview] = useState<{ text: string; image: QrImage } | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "error" | "informational" } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const saveRequest = useRef<AbortController | null>(null);
  const output = useMemo(() => new QrOutput(deck), [deck]);
  let text = "";
  let validation: string | undefined;
  try {
    if (input.length > 0) text = prepareInput(mode, input);
  } catch (error) {
    validation = error instanceof Error ? error.message : "내용을 확인해 주세요.";
  }
  const ready = text.length > 0 && preview?.text === text && !validation;

  const change = (nextInput: string, nextMode = mode) => {
    saveRequest.current?.abort();
    setInput(nextInput);
    setMode(nextMode);
    setPreview(null);
    setGenerationError(null);
    setNotice(null);
  };

  useEffect(() => {
    setGenerationError(null);
    if (!text) return;
    const request = new AbortController();
    const timer = setTimeout(() => {
      void generate(text, request.signal)
        .then((image) => {
          if (!request.signal.aborted) setPreview({ text, image });
        })
        .catch(() => {
          if (!request.signal.aborted)
            setGenerationError("QR 코드를 만들지 못했어요. 내용을 줄이거나 도구를 다시 열어 주세요.");
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [text, input, mode, generate]);

  useEffect(
    () => () => {
      saveRequest.current?.abort();
    },
    [],
  );

  const save = async () => {
    if (!ready || !preview || saving || choosing) return;
    const request = new AbortController();
    saveRequest.current = request;
    const image = preview.image;
    setSaving(true);
    setNotice(null);
    try {
      const saved = await output.save(
        format,
        () => (format === "svg" ? Promise.resolve(toSvgBlob(image)) : toPngBlob(image)),
        request.signal,
      );
      if (saved && !request.signal.aborted)
        setNotice({
          severity: "success",
          message: `${format.toUpperCase()}로 저장했어요. 같은 폴더에 계속 저장할 수 있어요.`,
        });
    } catch (error) {
      if (!request.signal.aborted && !(error instanceof DeckCallError && error.code === "CANCELLED"))
        setNotice({
          severity: "error",
          message: "파일을 저장하지 못했어요. 저장 폴더를 다시 선택한 뒤 저장해 주세요.",
        });
    } finally {
      setFolder(output.destination?.label ?? null);
      setSaving(false);
      saveRequest.current = null;
    }
  };

  const choose = async () => {
    if (saving || choosing) return;
    setChoosing(true);
    try {
      await output.select();
      setFolder(output.destination?.label ?? null);
      setNotice(null);
    } catch {
      setNotice({ severity: "error", message: "저장 폴더를 선택하지 못했어요. 다른 폴더를 선택해 주세요." });
    } finally {
      setChoosing(false);
    }
  };

  return (
    <main className={s.page}>
      <PageHeader title="QR 코드 만들기" description="링크나 글을 입력하면 QR 코드가 바로 나타나요." />
      <div className={s.workspace}>
        <section className={s.input} aria-label="QR 코드 내용">
          <RadioButtons<InputMode>
            header="넣을 내용"
            value={mode}
            options={[
              { value: "link", label: "링크" },
              { value: "text", label: "글" },
            ]}
            onChange={(next) => change(input, next)}
          />
          <TextBox
            header={mode === "link" ? "웹 주소" : "QR 코드에 넣을 글"}
            value={input}
            onChange={(next) => change(next)}
            placeholder={mode === "link" ? "https://example.org" : "전달할 글을 입력해 주세요."}
            multiline={mode === "text"}
            rows={6}
            inputRef={inputRef}
            {...(validation ? { validationMessage: validation } : {})}
          />
          <div className={s.row}>
            <Button
              icon={<DismissRegular />}
              disabled={input.length === 0}
              onClick={() => {
                change("");
                inputRef.current?.focus();
              }}
            >
              비우기
            </Button>
            <Caption secondary>
              {mode === "link" ? "주소를 입력하면 QR 코드가 바로 나타나요." : "공백과 줄바꿈도 입력한 그대로 담아요."}
            </Caption>
          </div>
          <Caption secondary>내용은 이 PC에서 처리해요. 입력한 내용은 기록으로 남기지 않아요.</Caption>
        </section>
        <section
          className={s.preview}
          aria-label="QR 코드 미리보기"
          aria-busy={Boolean(text && !ready && !generationError)}
        >
          {ready && preview ? (
            <>
              <Image
                src={svgPreview(preview.image)}
                alt="입력한 내용을 담은 QR 코드"
                width={preview.image.pixels}
                height={preview.image.pixels}
                className={s.image}
              />
              <Caption secondary>스마트폰으로 읽어 내용을 확인해 주세요.</Caption>
            </>
          ) : text && !generationError ? (
            <>
              <ProgressRing label="QR 코드를 만들고 있어요" />
              <Caption secondary>QR 코드를 만들고 있어요.</Caption>
            </>
          ) : (
            <EmptyState
              icon={<QrCodeRegular />}
              title="QR 코드 미리보기"
              description={generationError ?? "링크나 글을 입력해 주세요."}
            />
          )}
        </section>
      </div>
      <section className={s.actions} aria-label="QR 코드 저장">
        <BodyStrong>이미지로 저장</BodyStrong>
        <SettingsCard
          header="저장 폴더"
          description={folder ?? "처음 저장할 때 폴더를 선택해요."}
          action={
            <Button
              icon={<FolderOpenRegular />}
              disabled={saving || choosing}
              onClick={() => {
                void choose();
              }}
            >
              {choosing ? "선택 중" : folder ? "폴더 변경" : "폴더 선택"}
            </Button>
          }
        />
        <div className={s.row}>
          <ComboBox<OutputFormat>
            header="파일 형식"
            value={format}
            disabled={saving}
            options={[
              { value: "png", label: "PNG · 문서와 슬라이드용" },
              { value: "svg", label: "SVG · 확대와 인쇄용" },
            ]}
            onChange={setFormat}
          />
          <Button
            appearance="primary"
            icon={<ArrowDownloadRegular />}
            disabled={!ready || saving || choosing}
            onClick={() => {
              void save();
            }}
          >
            {saving ? "저장 중" : `${format.toUpperCase()} 저장`}
          </Button>
        </div>
        {ready && preview && (
          <Caption secondary>
            PNG는 {preview.image.pixels} × {preview.image.pixels} 픽셀이에요. 흰 여백을 포함해 저장해요.
          </Caption>
        )}
        <Caption secondary>같은 이름의 파일이 있으면 새 이름으로 저장해요.</Caption>
      </section>
      {notice && <InfoBar severity={notice.severity} message={notice.message} onClose={() => setNotice(null)} />}
    </main>
  );
}
