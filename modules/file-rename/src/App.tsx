// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Start here. UI only from @deck/ui, icons from @fluentui/react-icons (MOD-010); batch file tools use ToolLayout (MOD-011);
// host features only through `deck` (MOD-006). See modules/timer for a complete example.
import type { Deck, FileHandleInfo, FolderHandleInfo, RenameHistory, RenamePlan, RenameResult } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ContentDialog,
  DropZone,
  InfoBar,
  ListView,
  NumberBox,
  ProgressBar,
  SettingsExpander,
  TextBox,
  ToolLayout,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyze,
  copyBatch,
  folderFiles,
  histories,
  readWorkbook,
  renameBatch,
  RenamePlanExpired,
  templateFile,
  type CopyResult,
} from "./io.ts";
import {
  DEFAULT_MATCH,
  DEFAULT_NAMING,
  metadataFrom,
  fileKey,
  matchRows,
  preview,
  type Entry,
  type MatchOptions,
  type Mode,
  type Naming,
  type Metadata,
} from "./logic.ts";
import { rowsFor, type Workbook } from "./workbook.ts";
const useStyles = makeStyles({
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalM },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0, flexGrow: 1 },
  half: { flex: "1 1 16rem", minWidth: 0 },
  materials: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
  text: { overflowWrap: "anywhere" },
});
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
interface Template {
  name: string;
  naming: Omit<Naming, "date">;
}
const statusLabel = (status: string) =>
  (
    ({
      preview: "미리보기",
      ready: "준비됨",
      unchanged: "이름 유지",
      invalid: "처리 불가",
      conflict: "이름 충돌",
      changed: "원본 변경됨",
      success: "변경 완료",
      failed: "변경 실패",
      notStarted: "미처리",
      pending: "진행 중",
      completed: "변경 완료",
      blocked: "보호됨",
      undone: "복구 완료",
    }) as Record<string, string>
  )[status] ?? "확인 필요";
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<Mode>("pattern");
  const [naming, setNaming] = useState<Naming>({ ...DEFAULT_NAMING, date: today() });
  const [match, setMatch] = useState<MatchOptions>(DEFAULT_MATCH);
  const [book, setBook] = useState<Workbook | null>(null);
  const [sheet, setSheet] = useState("0");
  const [header, setHeader] = useState(1);
  const [materialColumns, setMaterialColumns] = useState<string[] | null>(null);
  const [recursive, setRecursive] = useState(false);
  const [keywords, setKeywords] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [operation, setOperation] = useState<"copy" | "rename">("copy");
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [renameResult, setRenameResult] = useState<RenameResult | null>(null);
  const [results, setResults] = useState<CopyResult[]>([]);
  const [folder, setFolder] = useState<FolderHandleInfo | null>(null);
  const [history, setHistory] = useState<RenameHistory[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [sort, setSort] = useState("nameAsc");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const table = useMemo(() => {
    const current = book?.sheets[Number(sheet)];
    try {
      return current ? { ...rowsFor(current, header), error: "" } : { columns: [], rows: [], error: "" };
    } catch {
      return {
        columns: [],
        rows: [],
        error:
          "헤더가 없거나 중복되어 있어요. 서로 다른 열 이름을 가진 헤더 행을 골라 주세요. 이름 재료 열은128개까지 읽어요.",
      };
    }
  }, [book, sheet, header]);
  const previews = useMemo(
    () => preview(entries, naming, mode, table.rows, match, operation === "copy"),
    [entries, naming, mode, table.rows, match, operation],
  );
  const unmatched = mode === "excel" ? matchRows(entries, table.rows, match) : null;
  const visible = previews.filter(
    (row) =>
      (!query || row.entry.file.name.includes(query) || row.name.includes(query)) &&
      (!onlyProblems || row.errors.length > 0 || row.reason.includes("미확인")),
  );
  const maxPage = Math.max(0, Math.ceil(visible.length / 50) - 1);
  const currentPage = Math.min(page, maxPage);
  const rows = visible.slice(currentPage * 50, (currentPage + 1) * 50);
  const invalid = previews.filter((row) => row.errors.length).length;
  const update = (handle: string, change: (entry: Entry) => Entry) => {
    setEntries((old) => old.map((entry) => (entry.file.handle === handle ? change(entry) : entry)));
    setPlan(null);
  };
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        if (!lock.current && !renameResult) add(files);
      }),
    [deck, renameResult],
  );
  useEffect(() => {
    setPlan(null);
  }, [entries, naming, mode, book, sheet, header, match]);
  useEffect(() => {
    void histories(deck)
      .then(setHistory)
      .catch(() => setMessage("이력을 읽지 못했어요. 다시 확인해 주세요."));
    void deck.storage
      .get<Template[]>("rename-templates")
      .then((value) => {
        if (
          Array.isArray(value) &&
          value.length <= 20 &&
          value.every(
            (t) =>
              typeof t.name === "string" &&
              typeof t.naming?.pattern === "string" &&
              Number.isInteger(t.naming.start) &&
              Number.isInteger(t.naming.digits),
          )
        )
          setTemplates(value);
      })
      .catch(() => setMessage("저장한 패턴을 읽지 못했어요. 직접 입력해 주세요."));
  }, [deck]);
  function add(files: FileHandleInfo[]) {
    setEntries((old) => {
      const known = new Set(old.map((entry) => entry.file.handle));
      const additions = files
        .filter((file) => {
          if (known.has(file.handle)) return false;
          known.add(file.handle);
          return true;
        })
        .map((file) => ({ file }));
      if (old.length + additions.length > 2000) {
        setMessage("한 작업에2,000개까지 추가할 수 있어요. 목록을 나누어 주세요.");
        return old;
      }
      return [...old, ...additions];
    });
    setPage(0);
  }
  async function task(work: (signal: AbortSignal) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    setMessage("");
    setDone(0);
    try {
      await work(abort.signal);
    } catch {
      setMessage(
        abort.signal.aborted
          ? "취소했어요. 이미 완료한 결과는 유지해요."
          : "작업을 마치지 못했어요. 파일 상태·연결·권한을 확인하고 다시 시도해 주세요.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      controller.current = null;
    }
  }
  const pick = () => task(async () => add(await deck.fs.pickFiles({ multiple: true })));
  async function loadExcel() {
    await task(async (signal) => {
      const file = (await deck.fs.pickFiles({ filters: [{ name: "엑셀 통합 문서", extensions: ["xlsx"] }] }))[0];
      if (!file) return;
      const result = await readWorkbook(deck, file, signal);
      if (signal.aborted) return;
      setBook(result);
      setMaterialColumns(null);
      discardManualRows();
      setSheet("0");
      setHeader(1);
      setMessage("시트·헤더 행·연결 키를 골라 주세요. 학번의 선행0은 유지해요.");
    });
  }
  async function analyzeAll() {
    await task(async (signal) => {
      setTotal(entries.length);
      for (const [index, entry] of entries.entries()) {
        if (signal.aborted) break;
        if (entry.metadata?.source === "직접 확인한 문서 정보") {
          setDone(index + 1);
          continue;
        }
        try {
          const metadata = await analyze(
            deck,
            entry,
            keywords
              .split(/[,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
            signal,
          );
          update(entry.file.handle, (e) => ({ ...e, metadata }));
        } catch {
          if (signal.aborted) break;
          const metadata = metadataFrom("", entry.file.name, []);
          metadata.source = "문서 분석 실패 · 파일명 추출값을 직접 확인해 주세요";
          update(entry.file.handle, (e) => ({ ...e, metadata }));
        }
        setDone(index + 1);
      }
      setMessage(
        signal.aborted
          ? "분석을 취소했어요. 완료한 추출값과 직접 입력값은 유지해요."
          : "추출값을 확인해 주세요. 빈 재료는 직접 입력하기 전 실행하지 않아요.",
      );
    });
  }
  async function saveTemplate() {
    if (!templateName.trim() || templateName.length > 80) {
      setMessage("패턴 이름을1~80자로 입력해 주세요.");
      return;
    }
    await task(async () => {
      const next = [
        ...templates.filter((t) => t.name !== templateName),
        { name: templateName, naming: { pattern: naming.pattern, start: naming.start, digits: naming.digits } },
      ];
      if (next.length > 20) throw new Error("TEMPLATE_LIMIT");
      await deck.storage.set("rename-templates", next);
      setTemplates(next);
      setMessage("패턴을 저장했어요. 파일 목록과 엑셀 내용은 저장하지 않아요.");
    });
  }
  async function hostPreview() {
    await task(async () => {
      if (invalid || !entries.length) throw new Error("INVALID_PLAN");
      const next = await deck.fileOps.planRename({
        items: previews.map((row) => ({ sourceHandle: row.entry.file.handle, targetName: row.name })),
      });
      setPlan(next);
      setMessage(
        next.items.some((row) => !["ready", "unchanged"].includes(row.status))
          ? "원본 폴더의 충돌이 있어요. 이름을 수정한 뒤 다시 확인해 주세요."
          : "원본 폴더 충돌을 확인했어요. 실행 직전에 다시 검사해요.",
      );
    });
  }
  async function run(retry = false) {
    await task(async (signal) => {
      setTotal(entries.length);
      if (operation === "copy") {
        const out = await copyBatch(
          deck,
          previews,
          signal,
          (value) => {
            setResults(value);
            setDone(value.filter((row) => row.status !== "notStarted").length);
          },
          retry ? results : [],
        );
        if (out.cancelled) {
          setMessage("저장 폴더 선택을 취소했어요. 이전 결과는 유지해요.");
          return;
        }
        setResults(out.results);
        if (out.folder) setFolder(out.folder);
        setMessage(
          signal.aborted
            ? "복사를 취소했어요. 완료한 파일은 유지하며 실패·미처리만 다시 시도할 수 있어요."
            : `복사${out.results.filter((row) => row.status === "success").length}개·실패${out.results.filter((row) => row.status === "failed").length}개·미처리${out.results.filter((row) => row.status === "notStarted").length}개예요.`,
        );
      } else {
        if (!plan) throw new Error("NO_PLAN");
        let out;
        try {
          out = await renameBatch(deck, plan, signal, (value) => {
            setRenameResult(value);
            setDone(value.success + value.failed);
          });
        } catch (error) {
          if (!(error instanceof RenamePlanExpired)) throw error;
          if (error.partial) setRenameResult(error.partial);
          setPlan(null);
          const updatedHistory = await histories(deck).catch(() => null);
          if (updatedHistory) setHistory(updatedHistory);
          setMessage(
            "이름 변경 계획이 만료됐어요. 완료한 변경과 이력은 유지해요. 실패·미처리는 새 미리보기로 옮겨 파일 상태와 원본 폴더 충돌을 다시 확인해 주세요.",
          );
          return;
        }
        if (out) setRenameResult(out);
        setHistory(await histories(deck));
        setMessage(
          signal.aborted
            ? "다음 이름 변경을 취소했어요. 완료한 변경은 이력에서 되돌릴 수 있어요."
            : "원본 이름 변경 결과를 확인해 주세요. 수정·대체된 결과는 자동으로 되돌리지 않아요.",
        );
      }
    });
  }
  async function undo(item: RenameHistory) {
    await task(async (signal) => {
      let out;
      do {
        if (signal.aborted) break;
        out = await deck.fileOps.undoRename({ historyHandle: item.historyHandle });
        setDone(out.success + out.failed + out.blocked);
        setTotal(item.total);
      } while (!out.done);
      setHistory(await histories(deck));
      setMessage(out ? `복구${out.success}개·실패${out.failed}개·보호${out.blocked}개예요.` : "되돌리기를 취소했어요.");
    });
  }
  function move(direction: number) {
    setEntries((old) => {
      const next = [...old];
      const indexes = next.flatMap((entry, index) => (selected.has(entry.file.handle) ? [index] : []));
      if (direction > 0) indexes.reverse();
      for (const index of indexes) {
        const target = index + direction;
        if (target >= 0 && target < next.length && !selected.has(next[target]?.file.handle ?? "")) {
          const item = next[index];
          const other = next[target];
          if (item && other) {
            next[index] = other;
            next[target] = item;
          }
        }
      }
      return next;
    });
  }
  function sortEntries() {
    setEntries((old) =>
      [...old].sort((a, b) => {
        const sign = sort.endsWith("Desc") ? -1 : 1;
        return (
          sign *
          (sort.startsWith("size")
            ? a.file.size - b.file.size
            : sort.startsWith("modified")
              ? a.file.modifiedAt - b.file.modifiedAt
              : a.file.name.localeCompare(b.file.name, "ko", { numeric: false }))
        );
      }),
    );
    setPage(0);
  }
  const hostReady = plan && plan.items.every((row) => ["ready", "unchanged"].includes(row.status));
  const ran = renameResult !== null;
  const discardManualRows = () =>
    setEntries((old) =>
      old.map((entry) => {
        const rest = { ...entry };
        delete rest.manualRow;
        return rest;
      }),
    );
  return (
    <ToolLayout
      title="파일명 정리"
      description="원본을 보며 새 이름을 정하고 새 폴더에 복사해요. 원본 이름 변경은 별도 확인 후 실행해요."
    >
      {message && <InfoBar message={message} onClose={() => setMessage("")} />}
      <ToolLayout.Section step="input" title="1. 파일 추가">
        {!entries.length && (
          <DropZone
            title="파일을 끌어 놓거나 추가해 주세요"
            description="한 작업2,000개까지 · 폴더는 최상위 파일만 기본으로 읽어요"
            {...(!busy && !ran ? { onPick: () => void pick() } : {})}
          />
        )}
        <div className={s.actions}>
          <Button disabled={busy || ran} onClick={() => void pick()}>
            파일 추가
          </Button>
          <Button
            disabled={busy || ran}
            onClick={() => void task(async (signal) => add(await folderFiles(deck, recursive, signal)))}
          >
            폴더 추가
          </Button>
          <CheckBox content="하위 폴더 포함" checked={recursive} disabled={busy || ran} onChange={setRecursive} />
          <Button
            disabled={busy || !selected.size || ran}
            onClick={() => {
              setEntries((old) => old.filter((entry) => !selected.has(entry.file.handle)));
              setSelected(new Set());
            }}
          >
            선택 제거
          </Button>
          <Button
            disabled={busy || !entries.length}
            onClick={() => {
              setEntries([]);
              setSelected(new Set());
              setResults([]);
              setRenameResult(null);
              setPlan(null);
            }}
          >
            목록 비우기
          </Button>
        </div>
        <Caption>
          목록에서 제거해도 원본 파일은 지우지 않아요. 이름 변경 후 새 작업은 목록을 비우고 파일을 다시 추가해 주세요.
        </Caption>
      </ToolLayout.Section>
      <ToolLayout.Section step="options" title="2. 이름 재료">
        <ComboBox
          header="이름 만드는 방식"
          value={mode}
          disabled={busy || ran}
          onChange={setMode}
          options={[
            { value: "pattern", label: "직접 패턴" },
            { value: "excel", label: "엑셀 연결" },
            { value: "document", label: "문서 정보" },
          ]}
        />
        <TextBox
          header="이름 패턴 (확장자는 원본 그대로 붙여요)"
          value={naming.pattern}
          disabled={busy || ran}
          onChange={(pattern) => setNaming((old) => ({ ...old, pattern }))}
        />
        <div className={s.materials}>
          {[
            "원본",
            "연번",
            "yyyymmdd",
            ...(mode === "excel"
              ? table.columns.filter((column) => materialColumns === null || materialColumns.includes(column))
              : mode === "document"
                ? ["연도", "월", "분류", "상위분류", "하위분류", "학년"]
                : []),
          ].map((material) => (
            <Button
              key={material}
              disabled={busy || ran}
              onClick={() => setNaming((old) => ({ ...old, pattern: old.pattern + `{${material}}` }))}
            >{`{${material}}`}</Button>
          ))}
        </div>
        {mode === "excel" && (
          <div className={s.stack}>
            <div className={s.actions}>
              <Button disabled={busy || ran} onClick={() => void loadExcel()}>
                엑셀 읽기
              </Button>
              <Button disabled={busy} onClick={() => void task(async () => templateFile(deck))}>
                연결 양식 저장
              </Button>
            </div>
            <ComboBox
              header="시트"
              disabled={busy || ran}
              value={sheet}
              onChange={(value) => {
                setSheet(value);
                setMaterialColumns(null);
                discardManualRows();
              }}
              options={(book?.sheets ?? []).map((value, index) => ({ value: String(index), label: value.name }))}
            />
            <NumberBox
              header="헤더 행"
              min={1}
              max={1048576}
              value={header}
              disabled={busy || ran}
              onChange={(value) => {
                setHeader(value);
                setMaterialColumns(null);
                discardManualRows();
              }}
            />
            {table.error && <InfoBar severity="error" message={table.error} />}
            <SettingsExpander header="이름 재료로 쓸 열 선택">
              <div className={s.materials}>
                {table.columns.map((column) => (
                  <CheckBox
                    key={column}
                    content={column}
                    checked={materialColumns === null || materialColumns.includes(column)}
                    disabled={busy || ran}
                    onChange={(checked) =>
                      setMaterialColumns((old) => {
                        const chosen = new Set(old ?? table.columns);
                        if (checked) chosen.add(column);
                        else chosen.delete(column);
                        return [...chosen];
                      })
                    }
                  />
                ))}
              </div>
              <Caption>체크한 열의 재료 버튼을 보여줘요. 연결 키 열과 이미 입력한 패턴은 그대로 유지해요.</Caption>
            </SettingsExpander>
            <ComboBox
              header="매칭 방식"
              value={match.mode}
              disabled={busy || ran}
              onChange={(value) => setMatch((old) => ({ ...old, mode: value }))}
              options={[
                { value: "student", label: "학번 정확 일치" },
                { value: "number", label: "번호 정확 일치" },
                { value: "oldname", label: "기존 이름 정확 일치" },
                { value: "order", label: "현재 목록 순서" },
              ]}
            />
            <ComboBox
              header="엑셀 연결 키 열"
              value={match.column}
              disabled={busy || ran || match.mode === "order"}
              onChange={(column) => setMatch((old) => ({ ...old, column }))}
              options={table.columns.map((value) => ({ value, label: value }))}
            />
            <TextBox
              header="파일 키 구분자 (비우면 전체 이름)"
              value={match.delimiter}
              disabled={busy || ran || match.mode === "order"}
              onChange={(delimiter) => setMatch((old) => ({ ...old, delimiter }))}
            />
            <NumberBox
              header="구분한 부분 번호 (0부터)"
              value={match.part}
              min={0}
              max={99}
              disabled={busy || ran || match.mode === "order"}
              onChange={(part) => setMatch((old) => ({ ...old, part }))}
            />
            <CheckBox
              content="번호의 선행0을 같은 숫자로 비교"
              checked={match.normalizeNumber}
              disabled={busy || ran || match.mode !== "number"}
              onChange={(normalizeNumber) => setMatch((old) => ({ ...old, normalizeNumber }))}
            />
            <Caption>
              학번은 선행0·문자·공백을 그대로 비교해요. 중복·공란·여러 파일의 같은 행 연결은 자동으로 확정하지 않아요.
              기존 이름은 확장자를 포함해 비교해요.
            </Caption>
            <Caption>
              {unmatched
                ? `미연결${entries.length - unmatched.linked.size}개 · 사용하지 않은 엑셀 행${unmatched.unused.length}개`
                : "엑셀을 읽고 시트와 헤더를 골라 주세요."}
            </Caption>
            <SettingsExpander header="사용하지 않은 엑셀 행">
              <TextBox
                header="미사용 행 번호"
                readOnly
                multiline
                value={unmatched?.unused.map((row) => String(row.row)).join(", ") ?? ""}
                onChange={() => undefined}
              />
            </SettingsExpander>
          </div>
        )}
        {mode === "document" && (
          <div className={s.stack}>
            <TextBox
              header="우선 분류 키워드 (쉼표·줄바꿈 구분)"
              value={keywords}
              multiline
              disabled={busy || ran}
              onChange={setKeywords}
            />
            <Button disabled={busy || ran || !entries.length} onClick={() => void analyzeAll()}>
              문서 분석
            </Button>
            <Caption>
              PDF·HWP5·HWPX·UTF-8 텍스트의 상단을 읽어요. 보호 문서·스캔 PDF·분석 불가 문서는 직접 값을 입력해 주세요.
              추출값은 확인이 필요해요.
            </Caption>
          </div>
        )}
        <SettingsExpander header="연번·날짜·패턴 보관">
          <div className={s.stack}>
            <NumberBox
              header="연번 시작"
              value={naming.start}
              min={0}
              max={999999999}
              disabled={busy || ran}
              onChange={(start) => setNaming((old) => ({ ...old, start }))}
            />
            <NumberBox
              header="연번 자릿수"
              value={naming.digits}
              min={1}
              max={12}
              disabled={busy || ran}
              onChange={(digits) => setNaming((old) => ({ ...old, digits }))}
            />
            <TextBox
              header="작업 날짜 (YYYY-MM-DD)"
              value={naming.date}
              disabled={busy || ran}
              onChange={(date) => setNaming((old) => ({ ...old, date }))}
            />
            <TextBox header="저장할 패턴 이름" value={templateName} disabled={busy} onChange={setTemplateName} />
            <Button disabled={busy} onClick={() => void saveTemplate()}>
              패턴 저장
            </Button>
            <div className={s.actions}>
              {templates.map((template) => (
                <Button
                  key={template.name}
                  disabled={busy || ran}
                  onClick={() => setNaming({ ...template.naming, date: today() })}
                >
                  {template.name}
                </Button>
              ))}
            </div>
          </div>
        </SettingsExpander>
      </ToolLayout.Section>
      <ToolLayout.Section step="preview" title="3. 이름 미리보기">
        <ComboBox
          header="실행 방식"
          value={operation}
          disabled={busy || ran}
          onChange={setOperation}
          options={[
            { value: "copy", label: "새 폴더에 복사 (기본)" },
            { value: "rename", label: "원본 이름 변경" },
          ]}
        />
        {operation === "rename" && (
          <InfoBar
            severity="warning"
            message="원본 이름이 바뀌어요. 먼저 충돌을 확인하고 실행 요약과 호스트 확인창에서 승인해 주세요. 수정·대체된 결과는 자동 복구하지 않아요."
          />
        )}
        <div className={s.actions}>
          {operation === "rename" && (
            <Button disabled={busy || ran || invalid > 0 || !entries.length} onClick={() => void hostPreview()}>
              원본 폴더 충돌 확인
            </Button>
          )}
          <Button
            appearance="primary"
            disabled={busy || ran || invalid > 0 || !entries.length || (operation === "rename" && !hostReady)}
            onClick={() => (operation === "rename" ? setConfirm(true) : void run())}
          >
            {operation === "copy" ? "새 폴더에 복사" : "원본 이름 변경"}
          </Button>
          <Button disabled={!busy} onClick={() => controller.current?.abort()}>
            취소
          </Button>
          {operation === "copy" && results.some((row) => row.status !== "success") && (
            <Button disabled={busy || invalid > 0} onClick={() => void run(true)}>
              실패·미처리 다시 시도
            </Button>
          )}
          {operation === "rename" && renameResult && !renameResult.done && (
            <Button disabled={busy || !plan} onClick={() => void run()}>
              남은 변경 계속
            </Button>
          )}
          {operation === "rename" && renameResult && (renameResult.failed > 0 || renameResult.notStarted > 0) && (
            <Button
              disabled={busy}
              onClick={() => {
                const failed = new Set(
                  renameResult.items
                    .filter((item) => ["failed", "changed", "conflict", "notStarted"].includes(item.status))
                    .map((item) => item.sourceHandle),
                );
                setEntries((old) => old.filter((entry) => failed.has(entry.file.handle)));
                setRenameResult(null);
                setPlan(null);
                setSelected(new Set());
                setPage(0);
                setMessage(
                  "실패·미처리만 새 미리보기로 옮겼어요. 이미 변경한 파일은 이력에서 유지해요. 원본 폴더 충돌을 다시 확인해 주세요.",
                );
              }}
            >
              실패·미처리 새 미리보기
            </Button>
          )}
        </div>
        {busy && <ProgressBar header="진행" value={total ? (done / total) * 100 : 0} />}
        <Caption>
          이름 교환은 한 묶음으로 처리해요. 원본 변경 취소는 다음 묶음 시작을 막으며 완료한 변경은 이력에 남아요.
        </Caption>

        <div className={s.actions}>
          <ComboBox
            header="정렬 기준"
            value={sort}
            disabled={busy || ran}
            onChange={setSort}
            options={[
              { value: "nameAsc", label: "파일명 오름차순" },
              { value: "nameDesc", label: "파일명 내림차순" },
              { value: "sizeAsc", label: "크기 오름차순" },
              { value: "sizeDesc", label: "크기 내림차순" },
              { value: "modifiedAsc", label: "수정일 오름차순" },
              { value: "modifiedDesc", label: "수정일 내림차순" },
            ]}
          />
          <Button disabled={busy || ran} onClick={sortEntries}>
            정렬
          </Button>
          <Button disabled={busy || ran || !selected.size} onClick={() => move(-1)}>
            선택 위로
          </Button>
          <Button disabled={busy || ran || !selected.size} onClick={() => move(1)}>
            선택 아래로
          </Button>
          <CheckBox
            content="모두 선택"
            checked={entries.length > 0 && selected.size === entries.length}
            onChange={(checked) =>
              setSelected(checked ? new Set(entries.map((entry) => entry.file.handle)) : new Set())
            }
          />
        </div>
        <div className={s.actions}>
          <TextBox
            header="파일명 찾기"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setPage(0);
            }}
          />
          <CheckBox
            content="확인 필요한 항목만"
            checked={onlyProblems}
            onChange={(value) => {
              setOnlyProblems(value);
              setPage(0);
            }}
          />
          <Body>
            {entries.length}개 · 실행 전 수정 필요{invalid}개
          </Body>
        </div>
        <ListView
          header="이름 미리보기"
          items={rows}
          getKey={(row) => row.entry.file.handle}
          emptyText="파일을 추가하거나 검색 조건을 바꿔 주세요."
          renderItem={(row) => (
            <div className={s.row}>
              <div className={s.actions}>
                <div className={s.half}>
                  <CheckBox
                    content={row.entry.file.name}
                    checked={selected.has(row.entry.file.handle)}
                    onChange={(checked) =>
                      setSelected((old) => {
                        const next = new Set(old);
                        if (checked) next.add(row.entry.file.handle);
                        else next.delete(row.entry.file.handle);
                        return next;
                      })
                    }
                  />
                </div>
                <div className={s.half}>
                  <TextBox
                    header="최종 파일명 (확장자 포함)"
                    value={row.name}
                    disabled={busy || ran}
                    onChange={(edited) => update(row.entry.file.handle, (e) => ({ ...e, edited }))}
                    {...(row.errors.length ? { validationMessage: row.errors.join(" ") } : {})}
                  />
                </div>
                <Caption>
                  {statusLabel(
                    plan?.items.find((item) => item.sourceHandle === row.entry.file.handle)?.status ??
                      renameResult?.items.find((item) => item.sourceHandle === row.entry.file.handle)?.status ??
                      "preview",
                  )}
                </Caption>
                <Button onClick={() => setDetail(detail === row.entry.file.handle ? null : row.entry.file.handle)}>
                  {detail === row.entry.file.handle ? "이름 재료 접기" : "이름 재료 보기"}
                </Button>
              </div>
              {detail === row.entry.file.handle && (
                <div className={s.stack}>
                  <Caption>
                    {row.reason} · {row.entry.file.size.toLocaleString()}바이트 ·{" "}
                    {new Date(row.entry.file.modifiedAt).toLocaleDateString()}
                  </Caption>
                  {mode === "excel" && (
                    <Caption>
                      파일 연결 키:{" "}
                      {match.mode === "order" ? "현재 목록 순서" : fileKey(row.entry.file, match) || "(공란)"} · 연결
                      행: {row.linked?.row ?? "미연결"}
                    </Caption>
                  )}
                  <div className={s.actions}>
                    <Button
                      disabled={busy || ran || row.entry.edited === undefined}
                      onClick={() =>
                        update(row.entry.file.handle, (entry) => {
                          const rest = { ...entry };
                          delete rest.edited;
                          return rest;
                        })
                      }
                    >
                      패턴으로 되돌리기
                    </Button>
                    {mode === "excel" && (
                      <NumberBox
                        header="직접 연결할 엑셀 행 (0은 자동)"
                        value={row.entry.manualRow ?? 0}
                        min={0}
                        max={1048576}
                        disabled={busy || ran}
                        onChange={(manualRow) =>
                          update(row.entry.file.handle, (entry) => {
                            const rest = { ...entry };
                            delete rest.manualRow;
                            return manualRow ? { ...rest, manualRow } : rest;
                          })
                        }
                      />
                    )}
                  </div>
                  <TextBox
                    header="연결한 이름 재료"
                    multiline
                    readOnly
                    value={Object.entries(row.materials)
                      .map(([key, value]) => key + ": " + value)
                      .join("\n")}
                    onChange={() => undefined}
                  />
                  {mode === "document" &&
                    (["year", "month", "subject", "main", "sub", "grade"] as const).map((field, index) => (
                      <TextBox
                        key={field}
                        header={["연도", "월", "분류", "상위분류", "하위분류", "학년"][index] ?? field}
                        value={row.entry.metadata?.[field] ?? ""}
                        disabled={busy || ran}
                        onChange={(value) =>
                          update(row.entry.file.handle, (entry) => ({
                            ...entry,
                            metadata: {
                              ...(entry.metadata ?? metadataFrom("", entry.file.name, [])),
                              [field]: value,
                              source: "직접 확인한 문서 정보",
                            } as Metadata,
                          }))
                        }
                      />
                    ))}
                  {row.entry.metadata?.header && (
                    <TextBox
                      header="분석한 문서 상단"
                      value={row.entry.metadata.header}
                      multiline
                      readOnly
                      onChange={() => undefined}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        />
        <div className={s.actions}>
          <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            이전50개
          </Button>
          <Caption>
            {currentPage + 1}/{maxPage + 1}쪽
          </Caption>
          <Button disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>
            다음50개
          </Button>
        </div>
      </ToolLayout.Section>
      <ToolLayout.Section step="run" title="4. 실행 상태">
        <Caption>미리보기 위에서 실행해요. 완료한 결과는 아래에서 확인해 주세요.</Caption>
      </ToolLayout.Section>
      <ToolLayout.Section step="result" title="5. 결과와 보호된 되돌리기">
        {results.length > 0 && (
          <TextBox
            header="복사 결과"
            multiline
            readOnly
            value={results
              .map(
                (row) =>
                  `${row.name} · ${row.status === "success" ? "완료" : row.status === "failed" ? "실패" : "미처리"}`,
              )
              .join("\n")}
            onChange={() => undefined}
          />
        )}
        <div className={s.actions}>
          {[
            ...new Map(
              results.flatMap((row) => (row.folder ? [[row.folder.handle, row.folder] as const] : [])),
            ).values(),
          ].map((output, index) => (
            <Button key={output.handle} onClick={() => void task(async () => deck.fs.reveal(output.handle))}>
              결과 폴더 {index + 1} 열기
            </Button>
          ))}
          {folder && !results.some((row) => row.folder) && (
            <Button onClick={() => void task(async () => deck.fs.reveal(folder.handle))}>결과 폴더 열기</Button>
          )}
          <Button disabled={busy} onClick={() => void task(async () => setHistory(await histories(deck)))}>
            변경 이력 다시 읽기
          </Button>
        </div>
        <ListView
          header="변경 이력"
          items={history}
          getKey={(item) => item.historyHandle}
          emptyText="원본 이름을 변경한 이력이 없어요. 복사 결과는 되돌리기로 삭제하지 않아요."
          renderItem={(item) => (
            <div className={s.actions}>
              <Body>
                {new Date(item.createdAt).toLocaleString()} · {item.total}개 · {statusLabel(item.state)}
              </Body>
              <Button disabled={busy || item.state === "undone"} onClick={() => void undo(item)}>
                보호된 되돌리기
              </Button>
            </div>
          )}
        />
      </ToolLayout.Section>
      <ContentDialog
        open={confirm}
        title="원본 이름 변경 확인"
        primaryButtonText="호스트 확인 후 변경"
        closeButtonText="취소"
        onClose={(result) => {
          setConfirm(false);
          if (result === "primary") void run();
        }}
      >
        <Body>
          {entries.length}개 파일의 원본 이름을 변경해요. 기존 파일을 덮어쓰거나 원본 부모 밖으로 옮기지 않아요. 변경
          결과가 수정되면 보호된 되돌리기가 차단될 수 있어요.
        </Body>
      </ContentDialog>
    </ToolLayout>
  );
}
