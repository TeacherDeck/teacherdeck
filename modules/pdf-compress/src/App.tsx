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
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  SettingsExpander,
  ToolLayout,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { loadOptions, runBatch, type Result } from "./batch.ts";
import { DEFAULT_OPTIONS } from "./logic.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  list: { maxHeight: "35vh", overflowY: "auto" },
});
const size = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [files, setFiles] = useState<FileHandleInfo[]>([]);
  const reserved = useRef<FileHandleInfo[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [ack, setAck] = useState(false);
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [message, setMessage] = useState("");
  const [pageDone, setPageDone] = useState(0);
  const [pageTotal, setPageTotal] = useState(0);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  useEffect(() => {
    let active = true;
    void loadOptions(deck).then((value) => {
      if (active) setOptions({ ...value, mode: "preserve" });
    });
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [deck]);
  useEffect(() => deck.on("fs.dropped", ({ files: incoming }) => add(incoming)), [deck, options, auto, ack, parent]);
  function add(incoming: FileHandleInfo[]) {
    if (lock.current) {
      setMessage("현재 파일을 처리하고 있어요. 끝난 뒤 다음 파일을 추가해 주세요.");
      return;
    }
    const accepted = incoming.filter(
      (file) =>
        file.ext.toLowerCase() === "pdf" && !reserved.current.some((existing) => existing.handle === file.handle),
    );
    if (reserved.current.length + accepted.length > 1000) {
      setMessage("한 번에 PDF 1,000개까지 추가해요. 저장한 뒤 목록을 비워 주세요.");
      return;
    }
    reserved.current = [...reserved.current, ...accepted];
    setFiles(reserved.current);
    if (accepted.length !== incoming.length) setMessage("PDF 파일만 추가해요. 이미 추가한 파일은 유지해요.");
    if (auto && accepted.length && (options.mode !== "raster" || ack)) void run(accepted);
  }
  async function pick() {
    try {
      add(await deck.fs.pickFiles({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] }));
    } catch {
      setMessage("파일을 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  async function run(
    selected: readonly FileHandleInfo[] = files.filter(
      (f) => !results.some((r) => r.file.handle === f.handle && r.status !== "failed"),
    ),
  ) {
    if (lock.current || !selected.length || (options.mode === "raster" && !ack)) return;
    lock.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    setMessage("");
    setPageDone(0);
    setPageTotal(0);
    try {
      let destination = parent;
      if (!destination) destination = await deck.fs.pickFolder();
      if (!destination) return;
      setParent(destination);
      void deck.storage.set("pdf-compression", options).catch(() => undefined);
      const merge = (incoming: Result[]) =>
        setResults((old) => [...new Map([...old, ...incoming].map((r) => [r.file.handle, r])).values()]);
      const output = await runBatch(
        deck,
        selected,
        destination.handle,
        options,
        abort.signal,
        (incoming, done, total) => {
          merge(incoming);
          setPageDone(done);
          setPageTotal(total);
        },
      );
      merge(output.results);
      if (output.folder) setFolder(output.folder);
      setMessage(
        abort.signal.aborted
          ? "취소했어요. 저장한 결과는 유지해요. 미처리 파일은 다시 압축할 수 있어요."
          : `${output.results.filter((r) => r.status === "compressed").length}개 PDF를 줄였어요. ${output.results.filter((r) => r.status === "original").length}개는 용량이 줄지 않아 원본 그대로 복사했어요. ${output.results.filter((r) => r.status === "failed").length}개는 재시도해 주세요.`,
      );
    } catch {
      setMessage("결과 폴더를 사용하지 못했어요. 폴더를 다시 선택해 주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  return (
    <ToolLayout
      title="PDF 용량 줄이기"
      description="PDF를 한 번에 추가하면 글자와 문서 구조를 유지하며 압축해요. 저장 폴더는 처음 한 번만 골라 주세요."
    >
      <ToolLayout.Section step="input" title="PDF 추가">
        <div className={s.actions}>
          <Button
            appearance="primary"
            disabled={busy}
            onClick={() => {
              void pick();
            }}
          >
            PDF 추가
          </Button>
          <Button
            disabled={
              busy ||
              (options.mode === "raster" && !ack) ||
              !files.some((f) => !results.some((r) => r.file.handle === f.handle && r.status !== "failed"))
            }
            onClick={() => {
              void run();
            }}
          >
            미처리 파일 압축
          </Button>
          <Button disabled={!busy} onClick={() => controller.current?.abort()}>
            취소
          </Button>
        </div>
        <DropZone
          onPick={() => {
            void pick();
          }}
          description="PDF 여러 개를 끌어 놓거나 선택해 주세요."
        />
        <Body>
          {files.length}개 · {size(files.reduce((sum, f) => sum + f.size, 0))}
        </Body>
        <CheckBox content="파일을 추가하면 바로 압축" checked={auto} disabled={busy} onChange={setAuto} />
        {message && <InfoBar severity="informational" message={message} />}
        {busy && <ProgressBar header="현재 파일 처리 진행" value={pageTotal ? (pageDone / pageTotal) * 100 : 0} />}
        <Button
          disabled={busy || !files.length}
          onClick={() => {
            reserved.current = [];
            setFiles([]);
            setResults([]);
            setFolder(null);
            setMessage("");
          }}
        >
          목록 비우기
        </Button>
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="저장과 압축 방식">
        <SettingsExpander
          header="압축 방식·화질"
          description={`${options.mode === "raster" ? "이미지 문서" : "문서 구조 유지"} · 품질 ${options.quality}%`}
        >
          <ComboBox
            header="압축 방식"
            value={options.mode ?? "preserve"}
            disabled={busy}
            options={[
              { value: "preserve", label: "문서 구조 유지 · 기본" },
              { value: "raster", label: "이미지 PDF로 변환 · 검색·편집 정보 제거" },
            ]}
            onChange={(mode) => {
              if (mode === "preserve" || mode === "raster") {
                setOptions({ ...options, mode });
                setAck(false);
              }
            }}
          />
          <div className={s.actions}>
            {options.mode === "raster" && (
              <NumberBox
                header="해상도 (DPI)"
                value={options.dpi}
                min={72}
                max={300}
                disabled={busy}
                onChange={(dpi) => setOptions({ ...options, dpi })}
              />
            )}
            <NumberBox
              header="사진 품질 (%)"
              value={options.quality}
              min={30}
              max={100}
              disabled={busy}
              onChange={(quality) => setOptions({ ...options, quality })}
            />
          </div>
          <Caption>
            기본 방식은 지원하는 RGB JPEG 사진과 PDF 저장 구조를 줄여요. 투명·특수 색상 이미지는 유지하며, 서명 문서는
            원본으로 보존해요. 줄어들지 않는 파일도 원본 그대로 복사해요.
          </Caption>
        </SettingsExpander>
        {options.mode === "raster" && (
          <>
            <InfoBar
              severity="warning"
              title="이미지 PDF로 바뀌어요"
              message="텍스트 검색·복사, 양식·링크·서명·첨부·접근성 구조는 유지하지 않아요. 작은 글자와 그림은 저장 결과를 확인해 주세요. 용량이 줄지 않으면 원본을 그대로 복사해요."
            />
            <CheckBox content="이미지 문서로 바뀌는 것을 확인했어요" checked={ack} disabled={busy} onChange={setAck} />
          </>
        )}
        <Button
          disabled={busy}
          onClick={() => {
            void deck.fs
              .pickFolder()
              .then((value) => {
                if (value) setParent(value);
              })
              .catch(() => setMessage("폴더를 선택하지 못했어요. 다시 선택해 주세요."));
          }}
        >
          다음 저장 폴더 선택
        </Button>
        <Body>{parent?.name ?? "압축할 때 저장 폴더를 선택해요."}</Body>
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="선택한 PDF">
        <div className={s.list}>
          <ListView
            header="선택한 PDF"
            items={files}
            getKey={(file) => file.handle}
            renderItem={(file) => (
              <div className={s.actions}>
                <Body>
                  {file.name} · {size(file.size)}
                </Body>
                <Button
                  disabled={busy}
                  onClick={() => {
                    reserved.current = reserved.current.filter((f) => f.handle !== file.handle);
                    setFiles(reserved.current);
                  }}
                >
                  목록에서 제거
                </Button>
              </div>
            )}
            emptyText="PDF를 추가하면 여기에서 확인할 수 있어요."
          />
        </div>
        <Body secondary>
          파일 하나 32 MiB·100쪽 이하, 원본 이미지 한 장 2,400만 화소 이하를 처리해요. 이미지 문서 모드는 출력 페이지도
          같은 화소 한도를 적용해요. 비밀번호가 필요한 문서는 지원하지 않아요.
        </Body>
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="처리 상태">
        <Caption>
          {busy
            ? "파일을 순서대로 압축하고 있어요."
            : "추가한 파일은 자동으로 처리해요. 취소하거나 실패한 파일은 위의 미처리 파일 압축으로 이어서 처리할 수 있어요."}
        </Caption>
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="결과">
        <div className={s.list}>
          <ListView
            header="압축 결과"
            items={results}
            getKey={(r) => r.file.handle}
            renderItem={(r) => (
              <div className={s.actions}>
                <Body>
                  {r.file.name} ·{" "}
                  {r.status === "failed"
                    ? "실패: 비밀번호·크기·손상 여부를 확인해 주세요."
                    : r.status === "original"
                      ? `용량 유지 · 원본 복사 ${size(r.outputSize ?? 0)}`
                      : `${size(r.file.size)} → ${size(r.outputSize ?? 0)} · ${Math.round((1 - (r.outputSize ?? 0) / r.file.size) * 100)}% 감소`}
                </Body>
                {r.status === "failed" && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void run([r.file]);
                    }}
                  >
                    이 파일 재시도
                  </Button>
                )}
                {r.saved && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (r.saved)
                        void deck.fs
                          .reveal(r.saved.handle)
                          .catch(() => setMessage("결과 파일 위치를 열지 못했어요. 결과 폴더에서 확인해 주세요."));
                    }}
                  >
                    저장 위치 열기
                  </Button>
                )}
              </div>
            )}
            emptyText="압축 결과와 원본 복사 여부를 여기에 표시해요."
          />
        </div>
        <Button
          disabled={busy || !folder}
          onClick={() => {
            if (folder)
              void deck.fs
                .reveal(folder.handle)
                .catch(() => setMessage("결과 폴더를 열지 못했어요. 탐색기에서 확인해 주세요."));
          }}
        >
          결과 폴더 열기
        </Button>
      </ToolLayout.Section>
    </ToolLayout>
  );
}
