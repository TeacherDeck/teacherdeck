// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import {
  Body,
  Button,
  CheckBox,
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
import { DEFAULT_OPTIONS, encode, loadOptions, runBatch, saveOptions, supported, type Result } from "./batch.ts";
const useStyles = makeStyles({
  list: { maxHeight: "30vh", overflowY: "auto" },
  actions: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalM },
  options: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalL },
});
const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(2)} MB`;
export function App({ deck }: { deck: Deck }) {
  const styles = useStyles();
  const [files, setFiles] = useState<FileHandleInfo[]>([]);
  const filesRef = useRef<FileHandleInfo[]>([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [parent, setParent] = useState<FolderHandleInfo | null>(null);
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [message, setMessage] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void loadOptions(deck)
      .then((value) => {
        if (active) setOptions(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [deck]);
  useEffect(
    () =>
      deck.on("fs.dropped", (incoming) => {
        if (busy.current) return;
        void addFiles(incoming.files);
      }),
    [deck, files, results, automatic, parent, options],
  );
  async function addFiles(incoming: FileHandleInfo[]) {
    if (busy.current || !incoming.length) return;
    const accepted = [...new Map(incoming.filter(supported).map((file) => [file.handle, file])).values()].filter(
      (file) => !filesRef.current.some((existing) => existing.handle === file.handle),
    );
    if (!accepted.length) {
      if (incoming.some((file) => !supported(file)))
        setMessage("JPG, PNG, WebP만 추가해요. 움직이는 이미지와 HEIC는 지원하지 않아요.");
      return;
    }
    // Drop events can arrive in one React batch; reserve handles synchronously.
    filesRef.current = [...filesRef.current, ...accepted];
    setFiles(filesRef.current);
    setMessage(
      incoming.some((file) => !supported(file))
        ? "JPG, PNG, WebP만 추가해요. 움직이는 이미지와 HEIC는 지원하지 않아요."
        : "",
    );
    if (automatic && parent) await run(accepted);
  }
  async function pickFiles() {
    try {
      await addFiles(
        await deck.fs.pickFiles({
          multiple: true,
          filters: [{ name: "이미지", extensions: ["jpg", "jpeg", "png", "webp"] }],
        }),
      );
    } catch {
      setMessage("파일을 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  async function pickFolder() {
    try {
      const picked = await deck.fs.pickFolder();
      if (picked) setParent(picked);
    } catch {
      setMessage("폴더를 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  async function run(
    selected: readonly FileHandleInfo[] = files.filter(
      (file) => !results.some((result) => result.file.handle === file.handle),
    ),
  ) {
    if (busy.current || !selected.length) return;
    busy.current = true;
    let target = parent;
    try {
      if (!target) target = await deck.fs.pickFolder();
    } catch {
      setMessage("폴더를 선택하지 못했어요. 다시 선택해 주세요.");
    }
    if (!target) {
      busy.current = false;
      return;
    }
    setParent(target);
    const abort = new AbortController();
    controller.current = abort;
    setTotal(selected.length);
    setProcessed(0);
    setRunning(true);
    setMessage("");
    void saveOptions(deck, options).catch(() => undefined);
    try {
      const mergeResults = (incoming: Result[]) =>
        setResults((previous) => [
          ...new Map([...previous, ...incoming].map((result) => [result.file.handle, result])).values(),
        ]);
      const output = await runBatch(deck, selected, target.handle, options, abort.signal, encode, (current) => {
        setProcessed(current.length);
        mergeResults(current);
      });
      if (output.folder) setFolder(output.folder);
      mergeResults(output.results);
      setMessage(
        abort.signal.aborted
          ? "취소했어요. 저장한 결과와 실패 목록을 유지하고, 아직 처리하지 않은 파일은 다시 압축할 수 있어요."
          : `${output.results.filter((r) => r.status !== "failed").length}개 이미지를 저장했어요.${output.results.some((r) => r.status === "failed") ? " 실패한 파일은 결과 목록에서 재시도할 수 있어요." : ""}`,
      );
    } catch {
      setMessage("결과 폴더를 사용하지 못했어요. 저장 폴더를 다시 선택해 주세요.");
    } finally {
      busy.current = false;
      setRunning(false);
      controller.current = null;
    }
  }
  return (
    <ToolLayout
      title="이미지 용량 줄이기"
      description="여러 이미지를 한 번에 줄여 새 폴더에 저장해요. 원본은 그대로 남아요."
    >
      <ToolLayout.Section step="input" title="1. 이미지 추가">
        {!running && (
          <DropZone
            onPick={() => {
              void pickFiles();
            }}
            description="JPG · PNG · WebP를 끌어 놓거나 파일을 선택해 주세요."
          />
        )}
        <div className={styles.actions}>
          <Button
            appearance="primary"
            disabled={running || !files.some((file) => !results.some((result) => result.file.handle === file.handle))}
            onClick={() => {
              void run();
            }}
          >
            압축하여 저장
          </Button>
          <Button disabled={!running} onClick={() => controller.current?.abort()}>
            취소
          </Button>
        </div>
        <CheckBox
          content="파일 추가 시 바로 압축"
          checked={automatic}
          disabled={running || !parent}
          onChange={setAutomatic}
        />
        <Body secondary>처음에는 저장 폴더를 선택해요. 바로 압축은 이 화면에서만 적용돼요.</Body>
        <Body>
          {files.length}개 · {bytes(files.reduce((sum, file) => sum + file.size, 0))} · 대기{" "}
          {files.filter((file) => !results.some((result) => result.file.handle === file.handle)).length}개
        </Body>
        <Button
          disabled={running || !files.length}
          onClick={() => {
            filesRef.current = [];
            setFiles([]);
            setResults([]);
            setFolder(null);
            setMessage("");
          }}
        >
          목록 비우기
        </Button>
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="2. 압축 설정">
        <SettingsExpander header="압축 설정" description={`품질 ${options.quality}% · 긴 변 ${options.maxEdge}px`}>
          <div className={styles.options}>
            <NumberBox
              header="품질 (%)"
              value={options.quality}
              min={10}
              max={100}
              onChange={(quality) => {
                if (!running) setOptions({ ...options, quality });
              }}
            />
            <NumberBox
              header="긴 변 최대 크기 (px)"
              value={options.maxEdge}
              min={100}
              max={10000}
              onChange={(maxEdge) => {
                if (!running) setOptions({ ...options, maxEdge });
              }}
            />
          </div>
        </SettingsExpander>
        <Body secondary>
          작은 이미지는 확대하지 않아요. 투명도를 유지하는 WebP로 저장해요. 용량이 줄지 않으면 원본을 복사해요.
        </Body>
        <Button
          disabled={running}
          onClick={() => {
            void pickFolder();
          }}
        >
          저장 폴더 선택
        </Button>
        <Body>{parent ? parent.name : "저장할 상위 폴더를 선택해 주세요."}</Body>
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="3. 입력 확인">
        <div className={styles.list}>
          <ListView
            header="선택한 이미지"
            items={files}
            getKey={(file) => file.handle}
            renderItem={(file) => (
              <Body>
                {file.name} · {bytes(file.size)} ·{" "}
                {results.some((result) => result.file.handle === file.handle) ? "결과 목록에서 확인" : "압축 대기"}
              </Body>
            )}
            emptyText="파일을 추가하면 여기에서 확인할 수 있어요."
          />
        </div>
        <Body secondary>
          64 MB 또는 4,800만 화소를 넘는 이미지는 건너뛰어요. 압축된 파일에서는 촬영 정보가 제거돼요. 원본 복사에는 촬영
          정보가 남아요.
        </Body>
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="4. 압축">
        <div className={styles.actions}>
          <Body secondary>위의 압축하여 저장을 누르면 새 폴더에 결과를 저장해요.</Body>
        </div>
        {running && (
          <>
            <ProgressBar header="압축 진행" value={total ? (processed / total) * 100 : 0} />
            <Body aria-live="polite">
              {processed} / {total}개 처리했어요.
            </Body>
          </>
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="5. 결과">
        {message && <InfoBar severity="informational" message={message} />}
        <div className={styles.list}>
          <ListView
            header="압축 결과"
            items={results}
            getKey={(result) => result.file.handle}
            renderItem={(result) => (
              <div className={styles.actions}>
                <Body>
                  {result.file.name} ·{" "}
                  {result.status === "failed"
                    ? "처리하지 못했어요. 형식과 크기를 확인해 주세요."
                    : `${result.status === "original" ? "원본 복사" : "압축"} · ${bytes(result.file.size)} → ${bytes(result.outputSize ?? 0)}`}
                </Body>
                {result.folder && (
                  <Button
                    disabled={running}
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
        </div>
        <Button
          disabled={running || !results.some((r) => r.status === "failed")}
          onClick={() => {
            void run(results.filter((r) => r.status === "failed").map((r) => r.file));
          }}
        >
          실패한 파일 재시도
        </Button>
        {folder && (
          <Button
            onClick={() => {
              void deck.fs
                .reveal(folder.handle)
                .catch(() => setMessage("결과 폴더를 열지 못했어요. 저장 폴더에서 확인해 주세요."));
            }}
          >
            결과 폴더 열기
          </Button>
        )}
      </ToolLayout.Section>
    </ToolLayout>
  );
}
