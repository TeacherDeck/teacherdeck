// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo, OfficeAvailability } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  DropZone,
  InfoBar,
  ListView,
  ProgressBar,
  ToggleSwitch,
  ToolLayout,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { conversionError, planConversions, providerFor, replanRows, type ConversionRow } from "./logic.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  row: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: deckTokens.inlineGap,
    minWidth: 0,
  },
  text: { overflowWrap: "anywhere", minWidth: 0 },
  list: { maxHeight: "40vh", overflowY: "auto" },
});
const labels = { hancom: "한글", excel: "Excel", powerpoint: "PowerPoint", word: "Word" };
const stateLabels = {
  pending: "변환 대기",
  converting: "변환 중",
  converted: "변환했어요",
  failed: "다시 확인",
  cancelled: "중지했어요",
};
export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [files, setFiles] = useState<FileHandleInfo[]>([]),
    [rows, setRows] = useState<ConversionRow[]>([]),
    [macros, setMacros] = useState(false),
    [availability, setAvailability] = useState<OfficeAvailability | null>(null),
    [folder, setFolder] = useState<FolderHandleInfo | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const locked = useRef(false),
    stopped = useRef(false),
    mounted = useRef(true),
    selectedFiles = useRef<FileHandleInfo[]>([]);
  useEffect(() => {
    mounted.current = true;
    void deck.office
      .availability()
      .then(setAvailability)
      .catch(() => setMessage("설치된 한글·Office를 확인하지 못했어요. 다시 열어 주세요."));
    return () => {
      mounted.current = false;
      stopped.current = true;
      void deck.office.cancel().catch(() => undefined);
    };
  }, [deck]);
  function addFiles(incoming: FileHandleInfo[]) {
    if (locked.current) return;
    const valid = incoming.filter((file) => providerFor(file) !== null);
    const known = new Set(selectedFiles.current.map((file) => file.handle));
    const additions = valid.filter((file) => {
      if (known.has(file.handle)) return false;
      known.add(file.handle);
      return true;
    });
    if (additions.length) {
      selectedFiles.current = [...selectedFiles.current, ...additions];
      setFiles(selectedFiles.current);
      setRows([]);
    }
    if (valid.length !== incoming.length) setMessage("한글·Excel·PowerPoint·Word 문서만 선택해 주세요.");
  }
  useEffect(() => deck.on("fs.dropped", ({ files: incoming }) => addFiles(incoming)), [deck]);
  async function pick() {
    try {
      addFiles(
        await deck.fs.pickFiles({
          multiple: true,
          filters: [
            {
              name: "한글·Office 문서",
              extensions: ["hwp", "hwpx", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "doc", "docx", "docm"],
            },
          ],
        }),
      );
    } catch {
      setMessage("문서를 선택하지 못했어요. 다시 선택해 주세요.");
    }
  }
  const plans = planConversions(files, macros),
    shown = rows.length ? rows : plans;
  const hancomRunning = rows.some((row) => row.state === "converting" && providerFor(row.file) === "hancom");
  const unsupported = plans.some(
    (row) =>
      availability !== null &&
      !availability.providers.some((p) => p.provider === providerFor(row.file) && p.registered),
  );
  function update(next: ConversionRow[]) {
    if (mounted.current) setRows([...next]);
  }
  async function run(retry = false) {
    if (locked.current) return;
    const selected = retry ? rows.filter((row) => row.state === "failed" || row.state === "cancelled") : plans;
    if (!selected.length) return;
    locked.current = true;
    stopped.current = false;
    setBusy(true);
    setMessage("");
    let batchId: string | null = null;
    const next = retry
      ? rows.map((row) => {
          if (!selected.includes(row)) return { ...row };
          const replacement = plans.find((plan) => plan.file.handle === row.file.handle);
          return replacement ? { ...replacement } : { ...row };
        })
      : plans.map((row) => ({ ...row }));
    try {
      const parent = await deck.fs.pickFolder();
      if (parent === null) return;
      const output = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "변환한 문서" });
      batchId = output.batchId;
      setFolder(output.folder);
      update(next);
      for (const row of next) {
        if (!selected.some((chosen) => chosen.file.handle === row.file.handle) || row.state === "converted") continue;
        if (stopped.current) {
          row.state = "cancelled";
          update(next);
          continue;
        }
        row.state = "converting";
        update(next);
        try {
          const result = await deck.office.convert({
            sourceHandle: row.file.handle,
            batchId,
            targetFormat: row.format,
            suggestedName: row.outputName,
          });
          row.state = "converted";
          row.result = result.file;
          setAvailability((previous) =>
            previous
              ? {
                  providers: previous.providers.map((provider) =>
                    provider.provider === result.provider ? { ...provider, ready: true } : provider,
                  ),
                }
              : previous,
          );
          row.message = "새 형식으로 다시 열어 확인했어요. 서식도 확인해 주세요.";
        } catch (error) {
          const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
          row.state = code === "CANCELLED" ? "cancelled" : "failed";
          const advice =
            typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
              ? error.message
              : undefined;
          row.message = conversionError(code, advice);
          if (code === "CANCELLED") stopped.current = true;
        }
        update(next);
      }
      setMessage(
        stopped.current
          ? "변환을 중지했어요. 저장한 결과는 유지해요."
          : next.some((row) => row.state === "failed")
            ? "변환하지 못한 문서가 있어요. 항목별 안내를 확인하고 실패한 문서만 다시 변환해 주세요."
            : "변환을 마쳤어요. 새 문서의 표·그림·수식과 서식을 확인해 주세요.",
      );
    } catch {
      setMessage("출력 폴더를 준비하지 못했어요. 다른 폴더를 선택해 주세요.");
    } finally {
      if (batchId !== null)
        await deck.fs.closeOutputFolder({ batchId }).catch(() => {
          if (mounted.current) setMessage("저장한 결과는 유지했어요. 도구를 다시 열어 주세요.");
        });
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function stop() {
    stopped.current = true;
    try {
      await deck.office.cancel();
    } catch {
      setMessage("중지 요청을 확인하지 못했어요. 현재 변환이 끝나면 멈춰요.");
    }
  }
  return (
    <ToolLayout
      title="문서 형식 변환"
      description="설치된 한글·Office로 실제 문서 형식을 바꿔요. 원본은 유지하고 새 폴더에 저장해요."
    >
      <ToolLayout.Section step="input" title="변환할 문서">
        {files.length === 0 && (
          <DropZone
            {...(busy ? {} : { onPick: () => void pick() })}
            description="HWP·XLS·PPT·DOC 문서를 선택하거나 덱 창에 놓아 주세요."
          />
        )}
        <div className={s.actions}>
          {files.length > 0 && (
            <Button disabled={busy} onClick={() => void pick()}>
              문서 추가
            </Button>
          )}
          <Button
            disabled={busy || files.length === 0}
            onClick={() => {
              selectedFiles.current = [];
              setFiles([]);
              setRows([]);
              setFolder(null);
              setMessage("");
            }}
          >
            목록 비우기
          </Button>
          <Caption>{files.length}개 문서</Caption>
          {files.length > 0 && <Caption>덱 창에 문서를 놓아 더 추가할 수 있어요.</Caption>}
        </div>
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="변환 옵션">
        <ToggleSwitch
          header="매크로 보존 형식으로 변환"
          checked={macros}
          disabled={busy}
          onChange={(value) => {
            setMacros(value);
            setRows((previous) => replanRows(previous, planConversions(files, value)));
          }}
        />
        <Caption>매크로 문서는 XLSM·PPTM·DOCM으로 보존해요. Excel 4.0 매크로 문서는 직접 확인해 주세요.</Caption>
        {availability && (
          <Caption>
            {availability.providers
              .map(
                (provider) =>
                  `${labels[provider.provider]} ${provider.ready ? "변환 확인됨" : provider.registered ? "등록 확인·변환 전" : "설치 확인 필요"}`,
              )
              .join(" · ")}
          </Caption>
        )}
        {unsupported && (
          <InfoBar
            severity="warning"
            title="필요한 프로그램을 확인해 주세요"
            message="목록에 포함된 문서를 여는 한글·Office가 필요해요. 설치된 종류의 문서를 먼저 변환할 수 있어요."
          />
        )}
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="새 파일 미리보기">
        <div className={s.list}>
          <ListView
            header="변환할 문서와 새 파일"
            items={shown}
            getKey={(row) => row.file.handle}
            emptyText="문서를 선택하면 새 형식과 파일 이름을 보여드려요."
            renderItem={(row) => (
              <div className={s.row}>
                <div className={s.text}>
                  <Body>
                    {row.file.name} → {row.outputName}
                  </Body>
                  {row.message && <Caption>{row.message}</Caption>}
                </div>
                <Caption>{stateLabels[row.state]}</Caption>
                {row.result && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void deck.fs
                        .reveal(row.result?.handle ?? "")
                        .catch(() => setMessage("저장한 결과를 열지 못했어요. 출력 폴더에서 확인해 주세요."))
                    }
                  >
                    결과 확인
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="변환">
        <div className={s.actions}>
          <Button appearance="primary" disabled={busy || plans.length === 0} onClick={() => void run()}>
            출력 폴더 선택하고 변환
          </Button>
          {busy && <Button onClick={() => void stop()}>중지</Button>}
          {!busy && rows.some((row) => row.state === "failed" || row.state === "cancelled") && (
            <Button onClick={() => void run(true)}>실패한 문서 다시 변환</Button>
          )}
        </div>
        {busy && (
          <ProgressBar
            value={
              (100 * rows.filter((row) => row.state === "converted" || row.state === "failed").length) /
              Math.max(1, rows.length)
            }
            header="문서를 변환하고 있어요"
          />
        )}
        {hancomRunning && (
          <InfoBar
            severity="informational"
            message="한글에서 작업용 사본을 새 형식으로 저장하고 있어요. 파일 접근은 작업용 사본과 새 결과로 제한해요. 안전하게 연결하지 못하면 변환을 중지해요."
          />
        )}
        <Caption>다른 Office의 문서 접근 승인 창은 직접 확인해 주세요. 한 문서당 최대 2분 기다려요.</Caption>
      </ToolLayout.Section>
      {(message || folder) && (
        <ToolLayout.Section step="result" title="변환 결과">
          {message && <InfoBar severity="informational" message={message} />}
          {folder && (
            <Button
              disabled={busy}
              onClick={() =>
                void deck.fs
                  .reveal(folder.handle)
                  .catch(() => setMessage("결과 폴더를 열지 못했어요. 선택한 출력 폴더에서 확인해 주세요."))
              }
            >
              결과 폴더 열기
            </Button>
          )}
          {folder && <Caption>기존 파일과 앞서 변환한 파일은 덮어쓰지 않아요.</Caption>}
        </ToolLayout.Section>
      )}
    </ToolLayout>
  );
}
