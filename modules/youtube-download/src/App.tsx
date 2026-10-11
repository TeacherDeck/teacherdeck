// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { DeckCallError, type Deck } from "@deck/sdk";
import { Body, Button, Caption, InfoBar, PageHeader, ProgressBar, TextBox, deckTokens, makeStyles } from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { byteLabel, errorLabel, progress, stageLabel, terminal, videoUrl } from "./logic.ts";
type Folder = Awaited<ReturnType<Deck["fs"]["pickFolder"]>>;
type Status = Awaited<ReturnType<Deck["mediaDownload"]["status"]>>;
type File = NonNullable<Status["file"]>;
const useStyles = makeStyles({
  page: { padding: deckTokens.pagePadding, display: "flex", flexDirection: "column", gap: deckTokens.sectionGap },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  card: {
    padding: deckTokens.pagePadding,
    backgroundColor: deckTokens.cardFill,
    borderRadius: deckTokens.cardRadius,
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    overflowWrap: "anywhere",
  },
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [url, setUrl] = useState(""),
    [folder, setFolder] = useState<Folder>(null);
  const [picking, setPicking] = useState(false),
    [running, setRunning] = useState(false),
    [cancelling, setCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false),
    [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState(""),
    [pollFailed, setPollFailed] = useState(false),
    [completed, setCompleted] = useState<File | null>(null);
  const active = useRef(true),
    job = useRef<string | null>(null),
    starting = useRef(false),
    picker = useRef(false),
    cancelIntent = useRef(false),
    cancelLock = useRef(false),
    polling = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      if (job.current) void deck.mediaDownload.cancel({ jobHandle: job.current }).catch(() => undefined);
    };
  }, [deck]);
  function safeError(error: unknown): string {
    return error instanceof DeckCallError ? errorLabel(error.code, error.message) : errorLabel(undefined);
  }
  async function chooseFolder() {
    if (picker.current || running || starting.current) return;
    picker.current = true;
    setPicking(true);
    try {
      const next = await deck.fs.pickFolder();
      if (active.current && next) {
        setFolder(next);
        setMessage("");
      }
    } catch (error) {
      if (active.current) setMessage(safeError(error));
    } finally {
      picker.current = false;
      if (active.current) setPicking(false);
    }
  }
  async function poll() {
    const handle = job.current;
    if (!handle || polling.current || !active.current) return;
    clearTimeout(timer.current);
    polling.current = true;
    try {
      const next = await deck.mediaDownload.status({ jobHandle: handle });
      if (!active.current || job.current !== handle) return;
      setStatus(next);
      setPollFailed(false);
      if (terminal(next.stage)) {
        job.current = null;
        setRunning(false);
        setCancelRequested(false);
        if (next.stage === "complete" && next.file) {
          setCompleted(next.file);
          setMessage("");
        } else if (next.stage === "failed") setMessage(errorLabel(next.error?.code, next.error?.message));
        else setMessage("");
      } else timer.current = setTimeout(() => void poll(), 750);
    } catch {
      if (active.current && job.current === handle) {
        setPollFailed(true);
        setMessage("진행 상태를 확인하지 못했어요. 다시 확인하거나 취소해 주세요. 작업은 계속 진행 중일 수 있어요.");
      }
    } finally {
      polling.current = false;
    }
  }
  async function cancel() {
    if (cancelLock.current) return;
    cancelIntent.current = true;
    const handle = job.current;
    if (!handle) {
      if (starting.current) setCancelRequested(true);
      return;
    }
    cancelLock.current = true;
    setCancelling(true);
    try {
      const result = await deck.mediaDownload.cancel({ jobHandle: handle });
      if (active.current && job.current === handle) {
        setCancelRequested(result.requested);
        setMessage("");
        void poll();
      }
    } catch (error) {
      if (active.current) {
        setMessage(safeError(error));
        setCancelRequested(false);
      }
    } finally {
      cancelLock.current = false;
      if (active.current) setCancelling(false);
    }
  }
  async function start() {
    if (starting.current || job.current || picker.current) return;
    const address = videoUrl(url);
    if (!address) {
      setMessage(errorLabel("INVALID_ARGS"));
      return;
    }
    if (!folder) {
      setMessage("저장할 폴더를 먼저 선택해 주세요.");
      return;
    }
    starting.current = true;
    cancelIntent.current = false;
    setRunning(true);
    setCancelRequested(false);
    setPollFailed(false);
    setStatus(null);
    setMessage("");
    try {
      const next = await deck.mediaDownload.start({ url: address, folderHandle: folder.handle });
      if (!active.current) {
        await deck.mediaDownload.cancel(next).catch(() => undefined);
        return;
      }
      job.current = next.jobHandle;
      setStatus({ ...next, stage: "preparing-engine", downloadedBytes: 0 });
      if (cancelIntent.current) await cancel();
      void poll();
    } catch (error) {
      if (active.current) {
        setRunning(false);
        setCancelRequested(false);
        setMessage(safeError(error));
      }
    } finally {
      starting.current = false;
    }
  }
  const percent = status ? progress(status.downloadedBytes, status.totalBytes) : undefined;
  return (
    <main className={s.page}>
      <PageHeader title="영상 다운로드" description="공개 YouTube 영상 한 개를 새 MP4 파일로 저장해요." />
      <TextBox
        header="YouTube 영상 주소"
        value={url}
        placeholder="https://www.youtube.com/watch?v=…"
        disabled={running || picking}
        onChange={setUrl}
      />
      <div className={s.row}>
        <Button disabled={running || picking} onClick={() => void chooseFolder()}>
          {picking ? "폴더 선택 중" : folder ? "저장 폴더 바꾸기" : "저장 폴더 선택"}
        </Button>
        <Body>{folder ? folder.name : "저장할 폴더를 선택해 주세요."}</Body>
      </div>
      <div className={s.row}>
        <Button appearance="primary" disabled={running || picking} onClick={() => void start()}>
          다운로드
        </Button>
        {running && (
          <Button disabled={cancelling || cancelRequested} onClick={() => void cancel()}>
            {cancelling || cancelRequested ? "취소 요청 중" : "취소"}
          </Button>
        )}
        {pollFailed && <Button onClick={() => void poll()}>진행 다시 확인</Button>}
      </div>
      {message && <InfoBar severity="warning" message={message} />}
      {(running || status) && (
        <section className={s.card} aria-label="다운로드 진행">
          <Body>{status ? stageLabel(status.stage) : "다운로드 작업을 시작하고 있어요."}</Body>
          {running && <ProgressBar header="다운로드 진행" {...(percent === undefined ? {} : { value: percent })} />}
          {status && (
            <Caption>
              {byteLabel(status.downloadedBytes)}
              {status.totalBytes ? ` / ${byteLabel(status.totalBytes)}` : " · 전체 크기는 아직 확인하지 못했어요."}
            </Caption>
          )}
          {cancelRequested && (
            <Caption>취소 처리가 끝날 때까지 상태를 확인해요. 이미 저장된 파일은 삭제하지 않아요.</Caption>
          )}
        </section>
      )}
      {completed && (
        <section className={s.card} aria-label="저장한 영상">
          <Body>{completed.name}</Body>
          <Button
            onClick={() =>
              void deck.fs.reveal(completed.handle).catch(() => {
                if (active.current)
                  setMessage("저장 위치를 열지 못했어요. 선택한 저장 폴더에서 새 결과 폴더를 확인해 주세요.");
              })
            }
          >
            저장 위치 열기
          </Button>
        </section>
      )}
      <Caption secondary>
        내 영상이나 내려받을 권한이 있는 공개 영상에 사용해 주세요. 한 번에 1개, 최대 512MiB·30분이며 영상과 음성이
        합쳐진 MP4를 저장해요. 로그인·재생목록·음성만 저장은 지원하지 않아요.
      </Caption>
      <Caption secondary>
        처음에는 Deno·FFmpeg 실행 환경을 준비하며 인터넷 연결이 필요해요. 다른 도구로 이동해도 진행하고 이 모듈을
        언로드하거나 앱을 종료하면 취소해요.
      </Caption>
    </main>
  );
}
