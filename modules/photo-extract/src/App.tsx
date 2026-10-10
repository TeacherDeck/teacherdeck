// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  DropZone,
  InfoBar,
  Image,
  ListView,
  ProgressBar,
  SettingsExpander,
  TextBox,
  ToolLayout,
  makeStyles,
  deckTokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { planPhotos, readExtraction, savePhotos, type Extraction } from "./batch.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  row: { display: "flex", alignItems: "center", gap: deckTokens.inlineGap },
  detail: { display: "flex", flexDirection: "column", gap: deckTokens.cardGap, minWidth: 0, flexGrow: 1 },
  previews: { maxHeight: "45vh", overflowY: "auto" },
  caption: { overflowWrap: "anywhere" },
});
const supported = (file: FileHandleInfo) => /\.(xlsx|xls)$/i.test(file.name);
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [failedFiles, setFailedFiles] = useState<FileHandleInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const plans = useMemo(() => planPhotos(extractions, renamed), [extractions, renamed]);
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const extraction of extractions)
      for (const photo of extraction.photos)
        if (photo.preview !== false && photo.mime.startsWith("image/"))
          next[`${extraction.file.handle}:${photo.key}`] = URL.createObjectURL(
            new Blob([photo.bytes], { type: photo.mime }),
          );
    setUrls(next);
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  }, [extractions]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        void addFiles(files);
      }),
    [deck, extractions],
  );
  async function addFiles(files: FileHandleInfo[]) {
    if (locked.current) return;
    const accepted = [...new Map(files.filter(supported).map((file) => [file.handle, file])).values()].filter(
      (file) => !extractions.some((e) => e.file.handle === file.handle),
    );
    if (!accepted.length) {
      setMessage("사진명렬표 .xlsx 또는 ZIP 형식의 .xls 파일을 선택해 주세요.");
      return;
    }
    if (accepted.length + extractions.length > 16) {
      setMessage("한 번에 파일 16개까지 확인해요. 현재 사진을 저장한 뒤 목록을 비워 주세요.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setFolder(null);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(accepted.length);
    setProgress(0);
    setMessage("사진과 학생 정보를 읽는 중이에요.");
    let added = 0;
    let failed = 0;
    let cumulative = extractions.reduce((sum, e) => sum + e.photos.reduce((n, p) => n + p.bytes.length, 0), 0);
    try {
      for (const [i, file] of accepted.entries()) {
        if (abort.signal.aborted) break;
        try {
          const result = await readExtraction(deck, file, abort.signal);
          const retained = result.photos.reduce((n, p) => n + p.bytes.length, 0);
          if (cumulative + retained > 128 * 1024 * 1024) throw new Error("INPUT_LIMIT");
          if (abort.signal.aborted) break;
          cumulative += retained;
          setExtractions((current) => [...current, result]);
          setFailedFiles((current) => current.filter((input) => input.handle !== file.handle));
          added++;
        } catch {
          if (!abort.signal.aborted) {
            failed++;
            setFailedFiles((current) => [
              ...new Map([...current, file].map((input) => [input.handle, input])).values(),
            ]);
          }
        }
        setProgress(i + 1);
      }
      setMessage(
        abort.signal.aborted
          ? "읽기를 취소했어요. 이미 확인한 사진은 목록에 유지해요."
          : `${added}개 파일을 확인했어요.${failed ? ` ${failed}개 파일은 읽지 못했어요. ZIP 형식의 .xlsx/.xls인지, 32MiB 이하인지 확인해 주세요.` : ""}`,
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
        await deck.fs.pickFiles({ multiple: true, filters: [{ name: "사진명렬표", extensions: ["xlsx", "xls"] }] }),
      );
    } catch {
      setMessage("파일을 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  async function save() {
    if (locked.current || !plans.length) return;
    locked.current = true;
    setBusy(true);
    setFolder(null);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(plans.length);
    setProgress(0);
    try {
      const result = await savePhotos(deck, plans, abort.signal, setProgress);
      if (result) {
        setFolder(result.folder);
        setMessage(
          `${result.saved.length}장 저장${result.failed.length ? ` · ${result.failed.length}장 실패` : ""}${result.cancelled ? " · 취소했어요. 저장된 사진은 결과 폴더에 유지해요." : "했어요. 원본 문서는 그대로 유지해요."}`,
        );
      }
    } catch {
      setMessage("사진을 저장하지 못했어요. 미리보기는 유지해요. 폴더 권한과 저장 공간을 확인해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  const students = extractions.flatMap((e) =>
    e.students.map((student, i) => ({ ...student, id: `${e.file.handle}:${student.sheet}:${i}` })),
  );
  return (
    <ToolLayout
      title="명렬표 사진 꺼내기"
      description="나이스 사진명렬표의 사진 원본을 학번·이름으로 저장해요. 사진을 다시 압축하지 않아요."
    >
      <ToolLayout.Section step="input" title="사진명렬표 추가">
        <div className={s.actions}>
          <Button
            appearance={plans.length ? "secondary" : "primary"}
            disabled={busy}
            onClick={() => {
              void pick();
            }}
          >
            파일 추가
          </Button>
          <Button
            appearance="primary"
            disabled={busy || !plans.length}
            onClick={() => {
              void save();
            }}
          >
            사진 저장
          </Button>
          <Button disabled={!busy} onClick={() => controller.current?.abort()}>
            취소
          </Button>
          <Button
            disabled={busy || (!extractions.length && !failedFiles.length)}
            onClick={() => {
              setExtractions([]);
              setFailedFiles([]);
              setRenamed({});
              setFolder(null);
              setMessage("");
            }}
          >
            목록 비우기
          </Button>
          <Caption>
            {extractions.length}개 파일 · 사진 {plans.length}장 · 학생 {students.length}명
          </Caption>
        </div>
        {failedFiles.length > 0 && (
          <ListView
            header="읽지 못한 파일"
            items={failedFiles}
            getKey={(file) => file.handle}
            renderItem={(file) => (
              <div className={s.actions}>
                <Body>{file.name}</Body>
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
        {!extractions.length && !busy && (
          <DropZone
            onPick={() => {
              void pick();
            }}
            description=".xlsx 또는 나이스에서 받은 ZIP 형식 .xls 파일을 끌어 놓아도 돼요."
          />
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="사진과 예정 파일명">
        <Caption secondary>
          위치가 정확한 사진만 학번·이름을 붙여요. 추측·미확인 사진은 모두 별도로 저장하고 이름을 직접 고칠 수 있어요.
        </Caption>
        <div className={s.previews}>
          <ListView
            header="꺼낼 사진"
            items={plans}
            getKey={(photo) => photo.id}
            emptyText="파일을 추가하면 사진과 예정 파일명이 보여요."
            renderItem={(photo) => (
              <div className={s.row}>
                {urls[photo.id] && (
                  <Image src={urls[photo.id] ?? ""} alt={photo.label} width={64} height={88} objectFit="contain" />
                )}
                <div className={s.detail}>
                  <Body className={s.caption}>{photo.label}</Body>
                  <TextBox
                    header="저장할 이름"
                    value={renamed[photo.id] ?? photo.filename.replace(/\.[^.]+$/, "")}
                    disabled={busy}
                    onChange={(name) => setRenamed((current) => ({ ...current, [photo.id]: name }))}
                    description={`예정 파일명: ${photo.filename}`}
                  />
                  <Caption secondary>
                    {photo.confirmed ? "정확한 좌표" : "미확인"} · {(photo.bytes.length / 1024).toFixed(1)} KiB
                    {urls[photo.id] ? " · 사진 미리보기 준비됨" : " · 이 형식은 미리보기를 지원하지 않아요"}
                  </Caption>
                </div>
              </div>
            )}
          />
        </div>
        {students.length > 0 && (
          <SettingsExpander
            header="학생 명단"
            description={`학생 ${students.length}명 · 사진 미확인/없음 ${students.filter((student) => !student.photoKey).length}명`}
          >
            <ListView
              header="읽은 학생"
              items={students}
              getKey={(student) => student.id}
              renderItem={(student) => (
                <Body>
                  {student.sheet} · {student.grade}학년 {student.classNumber}반 {student.number}번 {student.name} ·{" "}
                  {student.photoKey ? "사진 확인" : student.suggestionKey ? "사진 추측, 확인 필요" : "사진 없음"}
                </Body>
              )}
            />
          </SettingsExpander>
        )}
        {extractions.flatMap((e) => e.warnings).length > 0 && (
          <InfoBar severity="warning" message={extractions.flatMap((e) => e.warnings).join(" ")} />
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="사진 저장">
        <Caption secondary>
          사진 저장을 누르면 폴더를 선택해요. 선택한 폴더 안에 새 결과 폴더를 만들고 사진을 모두 저장해요.
        </Caption>
        {busy && <ProgressBar header="처리 진행" value={total ? progress / total : 0} />}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="처리 결과">
        {message && <InfoBar severity="informational" message={message} />}
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
