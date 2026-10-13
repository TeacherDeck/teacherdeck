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
  NumberBox,
  ProgressBar,
  SettingsExpander,
  TextBox,
  ToolLayout,
  makeStyles,
  deckTokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { OutputSession } from "./output-session.ts";
import {
  DEFAULT_NAME_PATTERN,
  planPhotos,
  readExtraction,
  savePhotos,
  validNamePattern,
  type Extraction,
} from "./batch.ts";
import { DEFAULT_INSETS, type Insets } from "./pdf-boxes.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  row: { display: "flex", alignItems: "center", gap: deckTokens.inlineGap },
  detail: { display: "flex", flexDirection: "column", gap: deckTokens.cardGap, minWidth: 0, flexGrow: 1 },
  previews: { maxHeight: "45vh", overflowY: "auto" },
  caption: { overflowWrap: "anywhere" },
});
type SaveStatus = { id: string; filename: string; state: "saved" | "failed" | "pending"; folder?: FolderHandleInfo };
const supported = (file: FileHandleInfo) => /\.(xlsx|xls|pdf)$/i.test(file.name);
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [extractions, setExtractions] = useState<Extraction[]>([]);
  const alive = useRef(true);
  const extractionsRef = useRef(extractions);
  extractionsRef.current = extractions;
  const queued = useRef(new Map<string, FileHandleInfo>());
  const admitted = useRef(new Set<string>());
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [pattern, setPattern] = useState(DEFAULT_NAME_PATTERN);
  const [insets, setInsets] = useState<Insets>({ ...DEFAULT_INSETS });
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [failedFiles, setFailedFiles] = useState<FileHandleInfo[]>([]);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const destination = useRef<OutputSession | null>(null);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [pendingFiles, setPendingFiles] = useState<FileHandleInfo[]>([]);
  const [saveStatuses, setSaveStatuses] = useState<Record<string, SaveStatus>>({});
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const plans = useMemo(() => planPhotos(extractions, renamed, pattern), [extractions, renamed, pattern]);
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
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      queued.current.clear();
      controller.current?.abort();
      void destination.current?.close().catch(() => undefined);
    };
  }, []);
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
    [deck, extractions, insets],
  );
  function flushQueued(cancelled = false) {
    const next = [...queued.current.values()];
    queued.current.clear();
    for (const file of next) admitted.current.delete(file.handle);
    if (!next.length || !alive.current) return;
    if (cancelled) {
      setFailedFiles((current) => [...new Map([...current, ...next].map((file) => [file.handle, file])).values()]);
      setPendingFiles((current) =>
        current.filter((file) => !next.some((queuedFile) => queuedFile.handle === file.handle)),
      );
    } else void addFiles(next);
  }
  async function addFiles(files: FileHandleInfo[], replace = false) {
    if (!files.length || !alive.current) return;
    const accepted = [...new Map(files.filter(supported).map((file) => [file.handle, file])).values()].filter(
      (file) =>
        replace ||
        (!admitted.current.has(file.handle) && !extractionsRef.current.some((e) => e.file.handle === file.handle)),
    );
    if (!accepted.length) {
      setMessage(
        files.every(supported)
          ? "이미 추가한 문서예요. 입력 목록에서 확인해 주세요."
          : "사진명렬표 .xlsx, ZIP 형식의 .xls 또는 사진 출석부 .pdf 파일을 선택해 주세요.",
      );
      return;
    }
    if (!replace && accepted.length + admitted.current.size + extractionsRef.current.length > 16) {
      setMessage("한 번에 파일 16개까지 확인해요. 현재 사진을 저장한 뒤 목록을 비워 주세요.");
      return;
    }
    for (const file of accepted) admitted.current.add(file.handle);
    setPendingFiles((current) => [...new Map([...current, ...accepted].map((file) => [file.handle, file])).values()]);
    if (locked.current) {
      for (const file of accepted) queued.current.set(file.handle, file);
      setMessage(`${accepted.length}개 파일을 입력했어요. 앞선 작업이 끝나면 읽어요.`);
      return;
    }
    locked.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(accepted.length);
    setProgress(0);
    setMessage(`${accepted.length}개 파일을 입력했어요. 사진과 학생 정보를 읽는 중이에요.`);
    let added = 0;
    let failed = 0;
    let invalidCrop = false;
    let cumulative = extractions.reduce((sum, e) => sum + e.photos.reduce((n, p) => n + p.bytes.length, 0), 0);
    try {
      for (const [i, file] of accepted.entries()) {
        if (abort.signal.aborted) break;
        try {
          const result = await readExtraction(deck, file, abort.signal, undefined, undefined, insets);
          const retained = result.photos.reduce((n, p) => n + p.bytes.length, 0);
          const previous = replace
            ? (extractions.find((e) => e.file.handle === file.handle)?.photos.reduce((n, p) => n + p.bytes.length, 0) ??
              0)
            : 0;
          if (cumulative - previous + retained > 128 * 1024 * 1024) throw new Error("INPUT_LIMIT");
          if (abort.signal.aborted) break;
          cumulative += retained - previous;
          extractionsRef.current = [...extractionsRef.current.filter((e) => e.file.handle !== file.handle), result];
          setExtractions(extractionsRef.current);
          setFailedFiles((current) => current.filter((input) => input.handle !== file.handle));
          added++;
        } catch (error) {
          if (!abort.signal.aborted) {
            if (error instanceof Error && error.message === "EMPTY_CROP") invalidCrop = true;
            failed++;
            setFailedFiles((current) => [
              ...new Map([...current, file].map((input) => [input.handle, input])).values(),
            ]);
          }
        }
        admitted.current.delete(file.handle);
        setPendingFiles((current) => current.filter((input) => input.handle !== file.handle));
        setProgress(i + 1);
      }
      setMessage(
        abort.signal.aborted
          ? "읽기를 취소했어요. 이미 확인한 사진은 목록에 유지해요."
          : `${added}개 파일을 확인했어요.${failed ? ` ${failed}개 파일은 읽지 못했어요. ${invalidCrop ? "PDF 여백이 너무 커 사진이 남지 않아요. 여백을 줄이고 다시 적용해 주세요." : "암호 없이 열리는 PDF 또는 ZIP 형식 .xlsx/.xls인지, 32MiB 이하인지 확인해 주세요. PDF는 100쪽·쪽과 원본 이미지당 2,400만 화소까지 읽어요."} 이전 미리보기와 이름 수정은 유지해요.` : ""}`,
      );
    } finally {
      locked.current = false;
      setBusy(false);
      controller.current = null;
      if (abort.signal.aborted) {
        const unread = accepted.filter((file) => !extractionsRef.current.some((e) => e.file.handle === file.handle));
        setFailedFiles((current) => [...new Map([...current, ...unread].map((file) => [file.handle, file])).values()]);
      }
      for (const file of accepted) admitted.current.delete(file.handle);
      setPendingFiles((current) => current.filter((input) => !accepted.some((file) => file.handle === input.handle)));
      flushQueued(abort.signal.aborted);
    }
  }
  async function pick() {
    try {
      await addFiles(
        await deck.fs.pickFiles({
          multiple: true,
          filters: [{ name: "사진명렬표·사진 출석부", extensions: ["xlsx", "xls", "pdf"] }],
        }),
      );
    } catch {
      setMessage("파일을 선택하지 못했어요. 다시 선택해 주세요.");
    }
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
      flushQueued();
    }
  }
  async function save(retry = false) {
    if (locked.current || !plans.length || !validNamePattern(pattern)) return;
    locked.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const selected = retry
      ? plans.filter((photo) => saveStatuses[photo.id] && saveStatuses[photo.id]?.state !== "saved")
      : plans;
    if (!selected.length) {
      locked.current = false;
      setBusy(false);
      return;
    }
    destination.current ??= new OutputSession(deck, parent?.handle);
    setTotal(selected.length);
    setProgress(0);
    try {
      const result = await savePhotos(deck, selected, abort.signal, setProgress, destination.current);
      if (result) {
        setFolder(result.folder);
        setSaveStatuses((previous) => {
          const next = { ...previous };
          const saved = new Set(result.saved);
          const failed = new Set(result.failed);
          for (const photo of selected) {
            if (!saved.has(photo.id) && !failed.has(photo.id) && previous[photo.id]) continue;
            const savedFolder = result.folders?.[photo.id];
            next[photo.id] = {
              id: photo.id,
              filename: result.outputs?.[photo.id] ?? photo.filename,
              state: saved.has(photo.id) ? "saved" : failed.has(photo.id) ? "failed" : "pending",
              ...(savedFolder ? { folder: savedFolder } : {}),
            };
          }
          return next;
        });
        setMessage(
          `${result.saved.length}장 저장${result.failed.length ? ` · ${result.failed.length}장 실패` : ""}${result.cancelled ? " · 취소했어요. 저장된 사진은 결과 폴더에 유지해요." : "했어요. 원본 문서는 그대로 유지해요."}`,
        );
        if (result.destinationExpired) {
          resetDestination();
          setMessage(
            "저장 작업이 만료됐거나 결과 폴더를 사용할 수 없어요. 저장하지 못한 사진 재시도를 누르고 폴더를 다시 선택해 주세요. 이전 결과는 유지해요.",
          );
        }
      }
    } catch {
      setSaveStatuses((previous) => {
        const next = { ...previous };
        for (const photo of selected) next[photo.id] = { id: photo.id, filename: photo.filename, state: "failed" };
        return next;
      });
      setMessage("사진을 저장하지 못했어요. 미리보기는 유지해요. 폴더 권한과 저장 공간을 확인해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
      controller.current = null;
      flushQueued(abort.signal.aborted);
    }
  }
  const students = extractions.flatMap((e) =>
    e.students.map((student, i) => ({ ...student, id: `${e.file.handle}:${student.sheet}:${i}` })),
  );
  return (
    <ToolLayout
      title="명렬표 사진 꺼내기"
      description="나이스 XLSX 사진명렬표와 PDF 사진 출석부에서 사진을 꺼내 학번·이름으로 저장해요."
    >
      <ToolLayout.Section step="input" title="사진명렬표 추가">
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
            disabled={busy || !plans.length || !validNamePattern(pattern)}
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
              resetDestination();
              setSaveStatuses({});
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
        {extractions.length > 0 && (
          <ListView
            header="입력한 문서"
            items={extractions}
            getKey={(item) => item.file.handle}
            renderItem={(item) => (
              <Body>
                {item.file.name} · 사진 {item.photos.length}장 · 입력 완료
              </Body>
            )}
          />
        )}
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
            description=".xlsx, 나이스에서 받은 ZIP 형식 .xls, 사진 출석부 .pdf 파일을 끌어 놓아도 돼요."
          />
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="파일 이름과 PDF 여백">
        <SettingsExpander header="이름·여백 조정" description="기본은 학번_이름 · PDF 사진 테두리는 자동으로 잘라내요">
          <TextBox
            header="파일 이름 형식"
            value={pattern}
            disabled={busy}
            onChange={setPattern}
            description="{학번} {학년} {반} {번호} {이름}을 조합해요. 예: {학년}_{반}_{번호}_{이름}"
          />
          {!validNamePattern(pattern) && (
            <InfoBar
              severity="error"
              message="안내한 이름 재료를 하나 이상 넣어 주세요. 중괄호와 재료 이름을 확인해 주세요."
            />
          )}
          <Caption>
            PDF 사진의 안쪽을 더 자를 픽셀 수예요. 이미 읽은 PDF에는 ‘PDF 여백 다시 적용’을 눌러요. XLSX 원본에는
            적용하지 않아요.
          </Caption>
          <div className={s.actions}>
            {(
              [
                ["top", "위"],
                ["bottom", "아래"],
                ["left", "왼쪽"],
                ["right", "오른쪽"],
              ] as const
            ).map(([key, label]) => (
              <NumberBox
                key={key}
                header={`${label} 여백`}
                value={insets[key]}
                min={0}
                max={500}
                step={1}
                disabled={busy}
                onChange={(value) => setInsets((current) => ({ ...current, [key]: Math.round(value) }))}
              />
            ))}
          </div>
          <Button
            disabled={busy || !extractions.some((e) => /\.pdf$/i.test(e.file.name))}
            onClick={() => {
              void addFiles(
                extractions.filter((e) => /\.pdf$/i.test(e.file.name)).map((e) => e.file),
                true,
              );
            }}
          >
            PDF 여백 다시 적용
          </Button>
        </SettingsExpander>
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="사진과 예정 파일명">
        <Caption secondary>
          학생의 학년·반과 사진 위치가 모두 확인된 사진만 학번·이름을 붙여요. 추측·미확인 사진은 모두 별도로 저장하고
          이름을 직접 고칠 수 있어요.
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
                    {photo.confirmed ? "학생·사진 확인" : "미확인"} · {(photo.bytes.length / 1024).toFixed(1)} KiB
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
            description={`학생 ${students.length}명 · 정보 또는 사진 미확인 ${students.filter((student) => !student.photoKey || student.identityConfirmed === false).length}명`}
          >
            <ListView
              header="읽은 학생"
              items={students}
              getKey={(student) => student.id}
              renderItem={(student) => (
                <Body>
                  {student.sheet} · {student.grade}학년 {student.classNumber}반 {student.number}번 {student.name} ·{" "}
                  {student.photoKey
                    ? student.identityConfirmed === false
                      ? "학생 신원 미확인"
                      : "사진 확인"
                    : student.suggestionKey
                      ? "사진 추측, 확인 필요"
                      : "사진 없음"}
                  {student.identityWarning ? ` · ${student.identityWarning}` : ""}
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
          각 원본 문서와 같은 폴더에 저장해요. 다른 저장 폴더를 선택하면 그 폴더에 직접 저장하고, 이미 저장한 사진은 새
          이름으로 저장해요.
        </Caption>

        {busy && <ProgressBar header="처리 진행" value={total ? (progress / total) * 100 : 0} />}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="처리 결과">
        {message && <InfoBar severity="informational" message={message} />}
        {Object.keys(saveStatuses).length > 0 && (
          <ListView
            header="사진별 저장 결과"
            items={Object.values(saveStatuses)}
            getKey={(result) => result.id}
            renderItem={(result) => (
              <div className={s.actions}>
                <Body>
                  {result.filename} ·{" "}
                  {result.state === "saved"
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
          disabled={busy || !Object.values(saveStatuses).some((result) => result.state !== "saved")}
          onClick={() => {
            void save(true);
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
    </ToolLayout>
  );
}
