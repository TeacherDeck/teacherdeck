// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { createDocumentSession, type Deck, type FileHandleInfo, type FolderHandleInfo } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ContentDialog,
  DropZone,
  ImageCropPreview,
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  TextBox,
  ToolLayout,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { readFile, readInput, redact, saveResult, type Input } from "./batch.ts";
import {
  boundRect,
  detect,
  mergeCandidates,
  readTerms,
  TYPES,
  MAX_CANDIDATES,
  type Candidate,
  type Kind,
  type Rect,
} from "./logic.ts";
import { renderPage } from "./pdf.ts";
import { recognizePages } from "./ocr.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalM },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  list: { maxHeight: "35vh", overflowY: "auto" },
  coordinates: { display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: tokens.spacingHorizontalS },
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [input, setInput] = useState<Input | null>(null);
  const current = useRef<Input | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [inputMessage, setInputMessage] = useState("");
  const [pendingFile, setPendingFile] = useState<FileHandleInfo | null>(null);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [enabled, setEnabled] = useState<Kind[]>([...TYPES]);
  const [terms, setTerms] = useState<string[]>([]);
  const [term, setTerm] = useState("");
  const [skipHeader, setSkipHeader] = useState(true);
  const [autoOcr, setAutoOcr] = useState(true);
  const [candidates, applyCandidates] = useState<Candidate[]>([]);
  const candidatesRef = useRef<Candidate[]>([]);
  function setCandidates(value: Candidate[] | ((previous: Candidate[]) => Candidate[])) {
    const next = typeof value === "function" ? value(candidatesRef.current) : value;
    candidatesRef.current = next;
    applyCandidates(next);
  }
  const [pageIndex, setPageIndex] = useState(0);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [rect, setRect] = useState<Rect>({ x: 20, y: 20, width: 100, height: 30 });
  const [ack, applyAck] = useState(false);
  const ackRef = useRef(false);
  function setAck(value: boolean) {
    ackRef.current = value;
    applyAck(value);
  }
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [saved, setSaved] = useState<FileHandleInfo | null>(null);
  const savedWorkspace = useRef(true);
  const saveLatest = useRef<() => Promise<void>>(async () => undefined);
  const confirmReplacement = useRef<((proceed: boolean) => void) | null>(null);
  const [replacing, setReplacing] = useState(false);
  const session = useMemo(() => createDocumentSession(deck, { save: () => saveLatest.current() }), [deck]);
  saveLatest.current = run;
  useEffect(() => {
    void session.ready.catch(() => setMessage("작업 보호를 준비하지 못했어요. 도구를 다시 열어 주세요."));
    return () => {
      confirmReplacement.current?.(false);
      confirmReplacement.current = null;
      session.dispose();
    };
  }, [session]);
  function change(apply: () => void) {
    if (!current.current) {
      apply();
      return;
    }
    void session
      .change(() => {
        savedWorkspace.current = false;
        setSaved(null);
        setAck(false);
        apply();
      })
      .then((applied) => {
        if (!applied) setMessage("작업 보호를 확인하지 못해 변경하지 않았어요. 다시 시도해 주세요.");
      });
  }
  async function canReplace(): Promise<boolean> {
    try {
      await session.settle();
    } catch {
      setMessage("작업 보호 상태를 확인하지 못했어요. 현재 문서를 유지해요.");
      return false;
    }
    if (!current.current || savedWorkspace.current) return true;
    if (confirmReplacement.current) return false;
    setReplacing(true);
    return new Promise((resolve) => {
      confirmReplacement.current = resolve;
    });
  }
  const page = input?.pages[pageIndex];
  const onPage = candidates.filter((c) => c.page === page?.number);
  const selected = candidates.filter((c) => c.selected);
  useEffect(
    () => () => {
      controller.current?.abort();
      void current.current?.doc.loadingTask.destroy();
    },
    [],
  );
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        if (!files.length) return;
        if (lock.current) {
          setInputMessage("현재 문서를 처리하고 있어요. 끝난 뒤 파일을 추가해 주세요.");
          return;
        }
        const file = files.find((f) => f.ext.toLowerCase() === "pdf");
        if (file) {
          if (current.current?.file.handle === file.handle) {
            setInputMessage("이미 입력한 PDF예요. 현재 문서를 유지해요.");
          } else
            void load(
              file,
              files.length > 1 ? "첫 번째 PDF를 입력했어요. 나머지 파일은 추가하지 않았어요." : undefined,
            );
        } else {
          const termsFile = files.find((f) => ["txt", "csv"].includes(f.ext.toLowerCase()));
          if (termsFile) void importTerms(termsFile);
          else setInputMessage("PDF 또는 검색어 목록 TXT·CSV를 추가해 주세요.");
        }
      }),
    [deck, terms, enabled, autoOcr],
  );
  useEffect(() => {
    if (!input || !page) {
      setPreview("");
      return;
    }
    let active = true;
    let url = "";
    const abort = new AbortController();
    setPreviewing(true);
    setPreview("");
    void input.doc
      .getPage(page.number)
      .then((p) =>
        renderPage(
          p,
          100,
          onPage.filter((c) => c.selected).map((c) => c.rect),
          abort.signal,
        ),
      )
      .then((blob) => {
        if (active) {
          url = URL.createObjectURL(blob);
          setPreview(url);
        }
      })
      .catch(() => {
        if (active && !abort.signal.aborted)
          setMessage("페이지를 표시하지 못했어요. 다시 선택하거나 다른 PDF를 추가해 주세요.");
      })
      .finally(() => {
        if (active) setPreviewing(false);
      });
    return () => {
      active = false;
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [input, pageIndex, candidates]);
  function setRun(value: boolean) {
    lock.current = value;
    setBusy(value);
  }
  function progress(count: number, maximum: number) {
    setDone(count);
    setTotal(maximum);
  }
  async function load(file: FileHandleInfo, notice = "PDF를 입력했어요. 문서 내용을 읽고 있어요.") {
    if (lock.current) return;
    setRun(true);
    if (!(await canReplace())) {
      setRun(false);
      return;
    }
    setPendingFile(file);
    setInputMessage(notice);
    setMessage("");
    const abort = new AbortController();
    controller.current = abort;
    let next: Input | null = null;
    try {
      next = await readInput(deck, file, abort.signal, progress);
      let scanMessage = "";
      const scans = next.pages.filter((p) => !p.boxes.length).map((p) => p.number);
      if (autoOcr && scans.length) {
        setMessage(`사진으로 된 ${scans.length}쪽의 글자를 PC에서 읽고 있어요.`);
        try {
          const result = await recognizePages(next, scans, abort.signal, progress);
          next = result.input;
          scanMessage = ` 이미지 글자 읽기 ${result.summary.read}쪽 · 빈 인식 ${result.summary.empty}쪽 · 낮은 신뢰도 ${result.summary.uncertain}쪽. 인식 결과를 확인해 주세요.`;
        } catch {
          if (abort.signal.aborted) throw new Error("CANCELLED");
          scanMessage = " 이미지 글자를 읽지 못한 쪽이 있어요. 다시 읽거나 직접 영역을 지정해 주세요.";
        }
      }
      const found = detect(next.pages, terms, enabled);
      if (abort.signal.aborted) throw new Error("CANCELLED");
      const previous = current.current;
      const loaded = next;
      if (
        !(await session.change(() => {
          savedWorkspace.current = false;
          current.current = loaded;
          setInput(loaded);
        }))
      )
        throw new Error("DOCUMENT_PROTECTION_FAILED");
      if (previous) void previous.doc.loadingTask.destroy().catch(() => undefined);
      setCandidates(found);
      setPageIndex(0);
      setFolder(null);
      setSaved(null);
      setAck(false);
      setInputMessage(
        `PDF ${file.name}을 입력했어요. ${next.pages.length}쪽을 확인할 수 있어요.${notice.includes("나머지") ? " 나머지 파일은 추가하지 않았어요." : ""}`,
      );
      setMessage(
        `${next.pages.length}쪽에서 개인정보 후보 ${found.length}건을 찾았어요. 제거할 영역을 확인해 주세요.${scanMessage}`,
      );
    } catch (error) {
      if (next && current.current !== next) await next.doc.loadingTask.destroy();
      setMessage(
        abort.signal.aborted
          ? "읽기를 취소했어요. 이전 문서는 유지해요."
          : error instanceof Error && error.message === "PDF_TIMEOUT"
            ? "PDF 검사 시간이 지나 중지했어요. 쪽 수를 줄인 PDF로 다시 시도해 주세요. 이전 문서는 유지해요."
            : "PDF를 읽지 못했어요. 비밀번호가 없는 32 MB·100쪽 이하 PDF를 선택해 주세요.",
      );
    } finally {
      controller.current = null;
      setPendingFile(null);
      setRun(false);
    }
  }
  async function pick() {
    if (lock.current) return;
    try {
      const files = await deck.fs.pickFiles({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (files[0]) await load(files[0]);
    } catch {
      setMessage("파일을 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  function refresh(nextTerms = terms, nextEnabled = enabled) {
    if (!input) return;
    try {
      const found = detect(input.pages, nextTerms, nextEnabled);
      change(() => {
        setCandidates(mergeCandidates(found, candidatesRef.current));
        setMessage(`개인정보 후보 ${found.length}건을 찾았어요. 수동 영역은 유지해요.`);
      });
    } catch {
      setMessage("검색어와 후보가 너무 많아요. 256개 이하 검색어로 나눠 주세요.");
    }
  }
  async function scan(all: boolean) {
    if (!input || !page || lock.current) return;
    setRun(true);
    setDone(0);
    setMessage("이미지 글자를 PC에서 읽고 있어요. 문서는 외부로 보내지 않아요.");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const numbers = all ? input.pages.map((p) => p.number) : [page.number];
      const result = await recognizePages(input, numbers, abort.signal, progress);
      if (abort.signal.aborted) throw new Error("CANCELLED");
      const found = detect(result.input.pages, terms, enabled);
      const merged = mergeCandidates(found, candidates);
      if (
        !(await session.change(() => {
          savedWorkspace.current = false;
          current.current = result.input;
          setInput(result.input);
          setCandidates(merged);
          setSaved(null);
          setAck(false);
        }))
      )
        throw new Error("DOCUMENT_PROTECTION_FAILED");
      setMessage(
        `이미지 글자 ${result.summary.read}쪽을 읽었어요. 빈 인식 ${result.summary.empty}쪽 · 낮은 신뢰도 ${result.summary.uncertain}쪽. 후보 ${found.length}건과 각 페이지를 확인해 주세요.`,
      );
    } catch {
      setMessage(
        abort.signal.aborted
          ? "글자 읽기를 취소했어요. 이전 후보와 직접 지정한 영역은 유지해요."
          : "글자를 읽지 못했어요. 이전 영역은 유지해요. 한 쪽씩 다시 읽거나 직접 영역을 지정해 주세요.",
      );
    } finally {
      controller.current = null;
      setRun(false);
    }
  }
  function addTerm() {
    const value = term.trim();
    if (!value) return;
    try {
      const next = readTerms([...terms, value].join("\n"), false, false);
      setTerms(next);
      setTerm("");
      refresh(next);
    } catch {
      setMessage("검색어는 256개까지, 한 항목은 200자까지 입력해 주세요.");
    }
  }
  async function importTerms(dropped?: FileHandleInfo) {
    if (lock.current) return;
    setRun(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const files = dropped
        ? [dropped]
        : await deck.fs.pickFiles({
            multiple: false,
            filters: [{ name: "목록", extensions: ["txt", "csv"] }],
          });
      const file = files[0];
      if (!file) return;
      setInputMessage(`검색어 목록 ${file.name}을 입력했어요. 내용을 읽고 있어요.`);
      const data = await readFile(deck, file, abort.signal, 128 * 1024);
      const imported = readTerms(
        new TextDecoder("utf-8", { fatal: true }).decode(data),
        file.ext.toLowerCase() === "csv",
        file.ext.toLowerCase() === "csv" && skipHeader,
      );
      const next = readTerms([...terms, ...imported].join("\n"), false, false);
      setTerms(next);
      refresh(next);
      setInputMessage(`검색어 목록 ${file.name}에서 ${imported.length}개 검색어를 입력했어요.`);
      setMessage(`${imported.length}개 검색어를 추가했어요. CSV는 첫 번째 열을 읽어요.`);
    } catch {
      setMessage("목록을 읽지 못했어요. UTF-8 TXT·CSV 128 KB 이하, 검색어 256개 이하로 저장해 주세요.");
    } finally {
      controller.current = null;
      setRun(false);
    }
  }
  async function template() {
    if (lock.current) return;
    setRun(true);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const destination = parent ?? (await deck.fs.pickFolder());
      if (!destination || abort.signal.aborted) return;
      const batch = await deck.fs.openOutputFolder({ parentHandle: destination.handle });
      try {
        await deck.fs.writeBlob(
          {
            batchId: batch.batchId,
            suggestedName: "검색어.csv",
            blob: new Blob(["\uFEFF마스킹할_텍스트,비고\r\n"], { type: "text/csv" }),
          },
          { signal: abort.signal },
        );
        setMessage("검색어 양식을 저장했어요. 첫 번째 열에 제거할 내용을 입력해 주세요.");
      } finally {
        await deck.fs.closeOutputFolder({ batchId: batch.batchId });
      }
    } catch {
      setMessage("양식을 저장하지 못했어요. 폴더를 다시 선택해 주세요.");
    } finally {
      controller.current = null;
      setRun(false);
    }
  }
  function addArea() {
    if (!page || candidates.length >= MAX_CANDIDATES) return;
    change(() =>
      setCandidates((old) => [
        ...old,
        {
          id: crypto.randomUUID(),
          page: page.number,
          kind: "검색어",
          label: "직접 지정 영역",
          rect: boundRect(rect, page.width, page.height),
          selected: true,
          manual: true,
        },
      ]),
    );
  }
  async function run() {
    const source = current.current;
    if (!source) return;
    const areas = candidatesRef.current;
    const selectedCount = areas.filter((candidate) => candidate.selected).length;
    if (lock.current || !ackRef.current || !selectedCount) {
      setMessage("제거할 영역을 고르고 확인란에 표시한 뒤 저장해 주세요. 현재 문서는 유지해요.");
      throw new Error("REVIEW_REQUIRED");
    }
    setRun(true);
    setMessage("");
    setDone(0);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const blob = await redact(source, areas, abort.signal, progress);
      const output = await saveResult(deck, source, blob, abort.signal, parent?.handle);
      if (output) {
        setFolder(output.folder);
        setSaved(output.saved);
        savedWorkspace.current = true;
        setMessage(
          `선택한 ${selectedCount}개 영역을 제거하고 새 PDF를 저장했어요. 출력의 텍스트·주석·첨부가 없는 것을 확인했어요.`,
        );
      } else {
        setMessage("저장을 취소했어요. 제거 영역은 유지해요.");
        throw new Error("SAVE_CANCELLED");
      }
    } catch {
      setMessage(
        abort.signal.aborted
          ? "취소했어요. 원본과 완료된 결과는 유지해요."
          : "새 PDF를 만들거나 검사하지 못했어요. 큰 페이지는 나누고, 저장 폴더를 다시 선택해 주세요.",
      );
      throw new Error("SAVE_FAILED");
    } finally {
      controller.current = null;
      setRun(false);
    }
  }
  return (
    <ToolLayout
      title="PDF 개인정보 지우기"
      description="자동 후보와 검색어·직접 지정 영역을 확인하고 실제 정보를 제거한 새 PDF를 만들어요."
    >
      <ToolLayout.Section step="input" title="1. PDF 선택">
        <DropZone
          {...(busy ? {} : { onPick: () => void pick() })}
          description="PDF 한 개를 끌어 놓거나 선택해 주세요. 원본은 그대로 남아요."
        />
        <CheckBox
          content="사진으로 된 페이지도 자동으로 읽기"
          checked={autoOcr}
          disabled={busy}
          onChange={setAutoOcr}
        />
        {inputMessage && (
          <div role="status">
            <InfoBar severity="informational" message={inputMessage} />
          </div>
        )}
        {pendingFile && <Body>{pendingFile.name} · 읽는 중</Body>}
        {input && (
          <Body>
            {input.file.name} · {input.pages.length}쪽
          </Body>
        )}
        <Button
          disabled={busy || !input}
          onClick={() =>
            void (async () => {
              if (lock.current) return;
              setRun(true);
              try {
                if (!(await canReplace())) return;
                await current.current?.doc.loadingTask.destroy();
                current.current = null;
                savedWorkspace.current = true;
                setInput(null);
                setCandidates([]);
                setFolder(null);
                setSaved(null);
                setMessage("");
                setInputMessage("");
                await session.save();
              } catch {
                setMessage("문서를 닫지 못했어요. 현재 영역을 유지하니 다시 시도해 주세요.");
              } finally {
                setRun(false);
              }
            })()
          }
        >
          문서 비우기
        </Button>
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="2. 찾을 정보">
        <div className={s.actions}>
          <Button
            disabled={busy}
            onClick={() =>
              void (async () => {
                if (lock.current) return;
                setRun(true);
                try {
                  const selected = await deck.fs.pickFolder();
                  if (selected) setParent(selected);
                } catch {
                  setMessage("저장 폴더를 선택하지 못했어요. 다시 선택해 주세요.");
                } finally {
                  setRun(false);
                }
              })()
            }
          >
            다른 저장 폴더 선택
          </Button>
          {parent && (
            <Button disabled={busy} onClick={() => setParent(null)}>
              원본 폴더에 저장
            </Button>
          )}
        </div>
        <Caption>
          {parent ? `저장 폴더: ${parent.name}` : "새 PDF는 원본과 같은 폴더에 저장해요. 새 폴더는 만들지 않아요."}
        </Caption>
        <div className={s.actions}>
          {TYPES.filter((kind) => kind !== "검색어").map((kind) => (
            <CheckBox
              key={kind}
              content={kind}
              checked={enabled.includes(kind)}
              disabled={busy}
              onChange={(value) => {
                const next = value ? [...enabled, kind] : enabled.filter((k) => k !== kind);
                setEnabled(next);
                refresh(terms, next);
              }}
            />
          ))}
        </div>
        <Body secondary>
          계좌번호·생년월일·주소·학번·이름은 항목 이름과 함께 찾아요. 이름은 라벨이 있는 한글·영문 표기를 찾으며, 라벨
          없는 이름은 명단·검색어로 추가해 주세요. 사진 속 글자는 PC 안에서 읽으며 인식 오류가 있을 수 있어요. 주소는
          가까운 다음 줄도 확인하지만 후보가 빠질 수 있어요. 후보와 같은 글자 덩어리의 주변 글자도 지워질 수 있어요.
        </Body>
        <CheckBox
          content="명단·검색어도 후보에 포함"
          checked={enabled.includes("검색어")}
          disabled={busy}
          onChange={(value) => {
            const next = value ? [...enabled, "검색어" as const] : enabled.filter((kind) => kind !== "검색어");
            setEnabled(next);
            refresh(terms, next);
          }}
        />
        <Caption>
          명단·검색어 {terms.length}개 · 찾은 영역{" "}
          {candidates.filter((candidate) => candidate.kind === "검색어").length}건
        </Caption>
        <div className={s.actions}>
          <TextBox
            header="제거할 검색어"
            value={term}
            disabled={busy}
            onChange={(value) => change(() => setTerm(value))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) addTerm();
            }}
          />
          <Button disabled={busy || !term.trim()} onClick={addTerm}>
            검색어 추가
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void importTerms();
            }}
          >
            목록 불러오기
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void template();
            }}
          >
            CSV 양식 저장
          </Button>
        </div>
        <CheckBox content="CSV 첫 줄은 제목이에요" checked={skipHeader} disabled={busy} onChange={setSkipHeader} />
        <ListView
          header={`검색어 ${terms.length}개`}
          items={terms}
          getKey={(value) => value}
          renderItem={(value) => (
            <div className={s.actions}>
              <Body>{value}</Body>
              <Button
                disabled={busy}
                onClick={() => {
                  const next = terms.filter((t) => t !== value);
                  setTerms(next);
                  refresh(next);
                }}
              >
                검색어 제거
              </Button>
            </div>
          )}
          emptyText="이름·번호 등 찾을 내용을 추가하거나 TXT·CSV 목록을 불러와 주세요."
        />
        <Button disabled={busy || !input} onClick={() => refresh()}>
          자동 후보 다시 찾기
        </Button>
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="3. 제거할 영역 확인">
        {page && input ? (
          <div className={s.stack}>
            <div className={s.actions}>
              <Button disabled={busy || pageIndex === 0} onClick={() => setPageIndex(pageIndex - 1)}>
                이전 페이지
              </Button>
              <ComboBox
                header="확인할 페이지"
                value={String(pageIndex)}
                disabled={busy}
                options={input.pages.map((p, i) => ({
                  value: String(i),
                  label: `${p.number}쪽 · 후보 ${candidates.filter((c) => c.page === p.number).length}건${p.ocrConfidence !== undefined && p.ocrConfidence < 70 ? " · 글자 인식 확인 필요" : ""}`,
                }))}
                onChange={(value) => setPageIndex(Number(value))}
              />
              <Button
                disabled={busy || pageIndex === input.pages.length - 1}
                onClick={() => setPageIndex(pageIndex + 1)}
              >
                다음 페이지
              </Button>
            </div>
            <div className={s.actions}>
              <Button
                disabled={busy}
                onClick={() => {
                  void scan(false);
                }}
              >
                이 페이지 이미지 글자 읽기
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  void scan(true);
                }}
              >
                전체 이미지 글자 읽기
              </Button>
            </div>
            <Caption>
              글자와 사진이 섞인 문서는 이미지 글자 읽기로 추가 확인해요. 인식이 끝나도 개인정보가 없다고 보장하지
              않아요.
            </Caption>
            {(!page.boxes.length || page.ocr === "empty") && (
              <InfoBar
                severity="warning"
                title="읽힌 글자가 없거나 부족한 페이지예요"
                message="개인정보가 없다는 뜻은 아니에요. 이미지 글자 읽기를 다시 실행하거나 직접 영역을 지정해 주세요."
              />
            )}
            {page.ocr === "read" && page.ocrConfidence !== undefined && page.ocrConfidence < 70 && (
              <InfoBar
                severity="warning"
                title="이 페이지의 글자 인식이 불확실해요"
                message="빠지거나 잘못 읽은 글자가 있을 수 있어요. 원문을 보며 제거 영역을 직접 추가해 주세요."
              />
            )}
            {preview ? (
              <ImageCropPreview
                header="제거 결과 미리보기와 직접 지정 영역"
                alt={`${page.number}쪽, 선택한 제거 영역은 검정색`}
                src={preview}
                imageWidth={page.width}
                imageHeight={page.height}
                rect={boundRect(rect, page.width, page.height)}
                onRectChange={setRect}
                disabled={busy}
              />
            ) : (
              <Caption>{previewing ? "페이지를 표시하는 중이에요." : "미리보기를 준비해 주세요."}</Caption>
            )}
            <div className={s.coordinates}>
              {(["x", "y", "width", "height"] as const).map((key) => (
                <NumberBox
                  key={key}
                  header={{ x: "왼쪽", y: "위쪽", width: "너비", height: "높이" }[key]}
                  value={rect[key]}
                  min={key === "width" || key === "height" ? 1 : 0}
                  max={key === "x" || key === "width" ? page.width : page.height}
                  disabled={busy}
                  onChange={(value) => setRect(boundRect({ ...rect, [key]: value }, page.width, page.height))}
                />
              ))}
            </div>
            <Button disabled={busy || candidates.length >= MAX_CANDIDATES} onClick={addArea}>
              직접 지정 영역 추가
            </Button>
            <div className={s.list}>
              <ListView
                header={`${page.number}쪽 제거 후보`}
                items={onPage}
                getKey={(candidate) => candidate.id}
                renderItem={(candidate) => (
                  <div className={s.actions}>
                    <CheckBox
                      content={`${candidate.kind} · ${candidate.label}`}
                      checked={candidate.selected}
                      disabled={busy}
                      onChange={(value) => {
                        change(() =>
                          setCandidates((all) =>
                            all.map((c) => (c.id === candidate.id ? { ...c, selected: value } : c)),
                          ),
                        );
                      }}
                    />
                    <Button disabled={busy} onClick={() => setRect(candidate.rect)}>
                      영역 확인
                    </Button>
                    {candidate.manual && (
                      <Button
                        disabled={busy}
                        onClick={() => change(() => setCandidates((all) => all.filter((c) => c.id !== candidate.id)))}
                      >
                        영역 제거
                      </Button>
                    )}
                  </div>
                )}
                emptyText="이 페이지에 찾은 후보가 없어요. 직접 지정 영역을 추가할 수 있어요."
              />
            </div>
          </div>
        ) : (
          <Body>PDF를 선택하면 페이지와 제거 후보를 표시해요.</Body>
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="4. 새 PDF 만들기">
        <InfoBar
          severity="warning"
          title="이미지 PDF로 저장해요"
          message="선택 영역의 픽셀을 지우고 모든 페이지를 200 DPI 이미지로 다시 만들어요. 텍스트 검색·복사, 양식, 링크·서명·첨부는 유지하지 않아요. 자동 탐지는 누락될 수 있으니 각 페이지를 확인해 주세요."
        />
        <CheckBox
          content="제거 영역과 이미지 PDF로 바뀌는 것을 확인했어요"
          checked={ack}
          disabled={busy}
          onChange={setAck}
        />
        <Body>선택한 영역 {selected.length}개 · 원본 보호</Body>
        <div className={s.actions}>
          <Button
            appearance="primary"
            disabled={busy || !input || !ack || !selected.length}
            onClick={() => {
              void session.save();
            }}
          >
            정보 제거하여 저장
          </Button>
          <Button disabled={!busy} onClick={() => controller.current?.abort()}>
            취소
          </Button>
        </div>
        {busy && <ProgressBar header="PDF 처리 진행" value={(done / Math.max(1, total)) * 100} />}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="5. 결과">
        {message && <InfoBar severity="informational" message={message} />}
        {saved && (
          <Body>
            {saved.name} · {(saved.size / 1024 / 1024).toFixed(2)} MB
          </Body>
        )}
        <Button
          disabled={!folder || busy}
          onClick={() => {
            if (folder)
              void deck.fs
                .reveal(folder.handle)
                .catch(() => setMessage("결과 폴더를 열지 못했어요. 탐색기에서 확인해 주세요."));
          }}
        >
          결과 폴더 열기
        </Button>
        <Body secondary>
          출력은 원본 PDF 객체를 복사하지 않아요. 아직 선택하지 않은 개인정보가 이미지에 남아 있을 수 있어요. 저장
          결과도 눈으로 확인해 주세요.
        </Body>
      </ToolLayout.Section>
      <ContentDialog
        open={replacing}
        title="저장하지 않은 제거 영역이 있어요"
        primaryButtonText="영역 버리고 계속"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setReplacing(false);
          const resolve = confirmReplacement.current;
          confirmReplacement.current = null;
          resolve?.(result === "primary");
        }}
      >
        현재 영역을 유지하려면 취소를 누르고 PDF를 먼저 저장해 주세요. 원본 PDF는 바뀌지 않아요.
      </ContentDialog>
    </ToolLayout>
  );
}
