// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { createDocumentSession, type Deck, type DocumentSession, type FileHandleInfo } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ContentDialog,
  InfoBar,
  NumberBox,
  PageHeader,
  ProgressRing,
  TextBox,
  SettingsExpander,
  deckTokens,
  makeStyles,
  mergeClasses,
  tokens,
} from "@deck/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type SetStateAction } from "react";
import {
  averagePast,
  calendar,
  counts,
  eligibleSlot,
  parseRoster,
  slotsForDay,
  type PlanInput,
  type PlanResult,
} from "./planner.ts";
import { HOLIDAYS, HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR } from "./holidays.ts";
import { initialState, loadState, type PlannerState } from "./state.ts";
import {
  closeMonth,
  cumulativeInput,
  decodeBackup,
  encodeBackup,
  exportCsv,
  exportLegacy,
  loadMonths,
  monthKey,
  recordAssigned,
  readBackup,
  selectCurrent,
  switchMonth,
  writeExport,
  type Months,
} from "./history.ts";
import { calendarStatus } from "./calendar-view.ts";
import { parseTimetable } from "./timetable.ts";
import { changeConditions, isValidAssignment, validSelectedDay } from "./condition-changes.ts";
import { loadLedger, replaceLedger, saveLedgerMonths } from "./ledger.ts";
import { decodeLegacy } from "./legacy.ts";
import { DetailedEditor } from "./DetailedEditor.tsx";
import { detailedCounts } from "./detailed.ts";
import { loadWorkspace, saveWorkspace, type Workspace } from "./workspace.ts";
import { emptyDetailedDraft } from "./detailed-draft.ts";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, padding: deckTokens.pagePadding },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalM,
    borderRadius: deckTokens.cardRadius,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    backgroundColor: deckTokens.cardFill,
  },
  calendarPanel: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, minWidth: 0 },
  weekday: { textAlign: "center", paddingBlock: tokens.spacingVerticalXS },
  red: { color: tokens.colorPaletteRedForeground1 },
  blue: { color: tokens.colorPaletteBlueForeground2 },
  muted: { color: tokens.colorNeutralForeground2 },
  fixed: { color: tokens.colorStatusWarningForeground1 },
  performed: { color: tokens.colorStatusSuccessForeground1 },
  selected: {
    backgroundColor: tokens.colorBrandBackground2,
    outline: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    outlineOffset: `calc(${tokens.strokeWidthThin} * -1)`,
  },
  excluded: { backgroundColor: tokens.colorNeutralBackground3 },
  working: { backgroundColor: tokens.colorNeutralBackground1 },
  dateHeading: { display: "flex", justifyContent: "space-between", width: "100%", gap: tokens.spacingHorizontalXS },
  workspace: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
    gap: deckTokens.sectionGap,
    alignItems: "start",
    "@media (max-width: 760px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  calendar: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: tokens.spacingHorizontalXS },
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalXS,
    minWidth: 0,
    width: "100%",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    whiteSpace: "normal",
    minHeight: `calc(${tokens.lineHeightBase400} * 3)`,
    color: tokens.colorNeutralForeground1,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    overflowWrap: "anywhere",
  },
});
function useWorkspaceState<T>(initial: T | (() => T), session: DocumentSession, changed: RefObject<boolean>) {
  const [value, apply] = useState(initial);
  const current = useRef(value);
  const restore = useCallback((next: T) => {
    current.current = next;
    apply(next);
  }, []);
  const set = useCallback(
    (update: SetStateAction<T>) => {
      void session.change(() => {
        const next = typeof update === "function" ? (update as (previous: T) => T)(current.current) : update;
        changed.current = true;
        restore(next);
      });
    },
    [session, changed, restore],
  );
  return [value, set, restore, current] as const;
}
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const changed = useRef(false);
  const workspaceValue = useRef<(() => Workspace) | null>(null);
  const formalSave = useRef<(() => Promise<void>) | null>(null);
  const session = useMemo(
    () =>
      createDocumentSession(deck, {
        save: async () => {
          if (!workspaceValue.current) throw new Error("WORKSPACE_NOT_READY");
          if (formalSave.current) await formalSave.current();
          await saveWorkspace(deck, workspaceValue.current());
        },
        onError: () => setMessage("작업 초안을 보관하지 못했어요. 화면의 입력을 유지했으니 다시 저장해 주세요."),
      }),
    [deck],
  );
  const [state, setState, restoreState, stateRef] = useWorkspaceState<PlannerState>(initialState, session, changed);
  const [months, setMonths, restoreMonths, monthsRef] = useWorkspaceState<Months>({}, session, changed);
  const [backupText, setBackupText, restoreBackupText, backupTextRef] = useWorkspaceState("", session, changed);
  const sourceFile = useRef<FileHandleInfo | undefined>(undefined);
  const pendingSource = useRef<FileHandleInfo | undefined>(undefined);
  const readingFile = useRef(false);
  const [chooseExportFolder, setChooseExportFolder] = useState(false);
  const [legacyYear, setLegacyYear, restoreLegacyYear, legacyYearRef] = useWorkspaceState<number | null>(
    null,
    session,
    changed,
  );
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{ months: Months; legacy: boolean } | null>(null);
  const [replacementPending, setReplacementPending, restoreReplacementPending, replacementPendingRef] =
    useWorkspaceState(false, session, changed);
  const [timetableText, setTimetableText, restoreTimetableText, timetableTextRef] = useWorkspaceState(
    "",
    session,
    changed,
  );
  const [roster, setRoster, restoreRoster, rosterRef] = useWorkspaceState("", session, changed);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [teacherId, setTeacherId, restoreTeacherId, teacherIdRef] = useWorkspaceState("", session, changed);
  const [selectedDay, setSelectedDay, restoreSelectedDay, selectedDayRef] = useWorkspaceState("1", session, changed);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ?? false);
  const [dateDialog, setDateDialog] = useState(false);
  const [manualSelection, setManualSelection, restoreManualSelection, manualSelectionRef] = useWorkspaceState<string[]>(
    [],
    session,
    changed,
  );
  const [newName, setNewName, restoreNewName, newNameRef] = useWorkspaceState("", session, changed);
  const [rosterExpanded, setRosterExpanded] = useState(true);
  const [detailedDraft, setDetailedDraft, restoreDetailedDraft, detailedDraftRef] = useWorkspaceState(
    emptyDetailedDraft,
    session,
    changed,
  );
  const dateTrigger = useRef<HTMLButtonElement | null>(null);
  const rosterPanel = useRef<HTMLDivElement | null>(null);
  const nameInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const composingName = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const saving = useRef(false);
  const preserveSelection = useRef(false);
  workspaceValue.current = () => ({
    state: stateRef.current,
    months: { ...monthsRef.current, [monthKey(stateRef.current)]: stateRef.current },
    roster: rosterRef.current,
    timetableText: timetableTextRef.current,
    newName: newNameRef.current,
    backupText: backupTextRef.current,
    legacyYear: legacyYearRef.current,
    replacementPending: replacementPendingRef.current,
    teacherId: teacherIdRef.current,
    selectedDay: selectedDayRef.current,
    manualSelection: manualSelectionRef.current,
    detailedDraft: detailedDraftRef.current,
    actualSlots: Object.fromEntries([...actualEditors.current].map(([key, value]) => [key, value.slots])),
  });
  useEffect(() => () => session.dispose(), [session]);
  useEffect(() => {
    if (!loaded || !changed.current) return;
    const timeout = setTimeout(() => {
      void session.save();
    }, 350);
    return () => clearTimeout(timeout);
  }, [
    state,
    months,
    roster,
    timetableText,
    newName,
    backupText,
    legacyYear,
    replacementPending,
    teacherId,
    selectedDay,
    manualSelection,
    detailedDraft,
    loaded,
    session,
  ]);
  // Stored actual performers are a compact set; editor slots retain empty positions.
  // A different source array (recording/restoring a month) invalidates its old draft.
  const actualEditors = useRef(new Map<string, { source: string[] | undefined; slots: string[] }>());
  const cumulative = cumulativeInput(state, months);
  const input = { ...state.input, holidays: HOLIDAYS };
  const daySlots = slotsForDay(input, Number(selectedDay));
  const actualKey = `${monthKey(state)}:${selectedDay}`;
  const actualSource = state.actual?.[selectedDay];
  const actualEditor = actualEditors.current.get(actualKey);
  const actualSlots = actualEditor && actualEditor.source === actualSource ? actualEditor.slots : (actualSource ?? []);
  const days = calendar(input);
  const teacher = state.input.teachers.find((t) => t.id === teacherId);
  const currentDay = days.find((d) => String(d.day) === selectedDay);
  const validManual = Object.fromEntries(
    Object.entries(input.manual).filter(([day, assigned]) => isValidAssignment(input, day, assigned)),
  );
  const projected = counts(input, { ...validManual, ...state.assignments });
  const detailedProjected = state.detailed ? detailedCounts(state.detailed) : {};
  useEffect(() => {
    let active = true;
    const read = async () => {
      const ledger = await loadLedger(deck);
      if (ledger) return ledger;
      const [latestState, storedMonths] = await Promise.all([loadState(deck), loadMonths(deck)]);
      return { current: selectCurrent(latestState, storedMonths), months: storedMonths };
    };
    void Promise.all([read(), loadWorkspace(deck), session.ready])
      .then(([{ current: saved, months: storedMonths }, workspace]) => {
        if (!active) return;
        restoreMonths(storedMonths);
        setRosterExpanded(!saved?.input.teachers.length);
        if (saved) {
          restoreState(saved);
          restoreRoster(saved.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
        }
        if (workspace) {
          restoreState(workspace.state);
          restoreMonths(workspace.months);
          restoreRoster(workspace.roster);
          restoreTimetableText(workspace.timetableText);
          restoreNewName(workspace.newName);
          restoreBackupText(workspace.backupText);
          restoreLegacyYear(workspace.legacyYear);
          restoreReplacementPending(workspace.replacementPending);
          restoreTeacherId(workspace.teacherId);
          restoreSelectedDay(workspace.selectedDay);
          restoreManualSelection(workspace.manualSelection);
          restoreDetailedDraft(workspace.detailedDraft);
          preserveSelection.current = true;
          actualEditors.current = new Map(
            Object.entries(workspace.actualSlots).map(([key, slots]) => {
              const [month, day] = key.split(":");
              const entry = month === monthKey(workspace.state) ? workspace.state : workspace.months[month ?? ""];
              return [key, { source: entry?.actual?.[day ?? ""], slots }];
            }),
          );
          setRosterExpanded(!workspace.state.input.teachers.length || !!workspace.newName);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          setMessage(
            "저장한 내용을 불러오지 못했어요. 기존 저장값을 보호하려고 저장을 잠갔어요. JSON 백업 복원에서 정상 파일을 확인해 복구해 주세요.",
          );
          setStorageBlocked(true);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      workerRef.current?.terminate();
    };
  }, [deck]);
  useEffect(() => {
    if (preserveSelection.current) {
      preserveSelection.current = false;
      return;
    }
    restoreManualSelection(state.assignments[selectedDay] ?? state.input.manual[selectedDay] ?? []);
  }, [selectedDay, state.assignments, state.input.manual]);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 760px)");
    if (!query) return;
    const changed = () => {
      setNarrow(query.matches);
      setDateDialog(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    restoreSelectedDay(validSelectedDay(state.input, selectedDayRef.current));
    setDateDialog(false);
  }, [state.input.year, state.input.month]);
  function changeMonth(year: number, month: number) {
    const drafts = { ...months, [monthKey(state)]: state };
    setMonths(drafts);
    const next = switchMonth(state, drafts, year, month);
    setState(next);
    setSelectedDay(validSelectedDay(next.input, selectedDay));
    setDateDialog(false);
    setRoster(next.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
    setIssues([]);
  }
  async function persist(next?: PlannerState) {
    await session.settle();
    const target = next ?? stateRef.current;
    if (saving.current) throw new Error("SAVE_BUSY");
    saving.current = true;
    setBusy(true);
    formalSave.current = async () => {
      const drafts = { ...monthsRef.current, [monthKey(target)]: target };
      if (replacementPendingRef.current) {
        await replaceLedger(deck, drafts, monthKey(target));
        restoreReplacementPending(false);
      } else {
        await saveLedgerMonths(deck, drafts, monthKey(target));
      }
      restoreMonths(drafts);
      restoreState(target);
    };
    try {
      if (!(await session.save())) throw new Error("WORKSPACE_SAVE_FAILED");
    } finally {
      formalSave.current = null;
      saving.current = false;
      setBusy(false);
    }
  }
  async function restoreConfirmed(preview: { months: Months; legacy: boolean }, importedSource?: FileHandleInfo) {
    const first = Object.values(preview.months)[0];
    if (!first || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (storageBlocked) await replaceLedger(deck, preview.months, monthKey(first));
      setMonths(preview.months);
      sourceFile.current = importedSource;
      setState(first);
      setReplacementPending(!storageBlocked);
      setRoster(first.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
      setStorageBlocked(false);
      setIssues([]);
      setTeacherId("");
      setMessage(
        storageBlocked
          ? "정상 자료를 새 복구 세대에 저장했어요. 기존 손상값은 보존하고 저장 잠금을 풀었어요."
          : "백업을 화면에 복원했어요. 내용을 확인하고 저장해 주세요.",
      );
    } catch {
      setMessage("복구 자료를 저장하지 못했어요. 기존 저장값과 잠금을 유지했으니 다시 시도해 주세요.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function legacyExport() {
    try {
      void exportFile("legacy.json", exportLegacy({ ...months, [monthKey(state)]: state }));
    } catch {
      setMessage(
        "기존 형식은 같은 연도·하루 두 명의 기본 지도일만 보존해요. 세부 업무·시간대·시험실은 자체 JSON 백업 또는 현재 달 CSV로 저장해 주세요.",
      );
    }
  }
  async function exportFile(name: string, text: string) {
    try {
      if (await writeExport(deck, name, text, sourceFile.current, chooseExportFolder))
        setMessage("저장 폴더에 새 파일로 저장했어요.");
    } catch {
      setMessage("파일을 저장하지 못했어요. 다시 저장해 주세요.");
    }
  }
  const importFile = async (file?: FileHandleInfo) => {
    if (readingFile.current || saving.current || busy || !loaded || restoreOpen) {
      setMessage("현재 작업을 마친 뒤 백업 파일을 다시 놓아 주세요.");
      return;
    }
    readingFile.current = true;
    setBusy(true);
    try {
      const text = await readBackup(deck, file, (selected) => {
        pendingSource.current = selected;
      });
      if (text !== null) {
        setBackupText(text);
        setMessage(
          `${pendingSource.current?.name ?? "백업 파일"}을 읽었어요. JSON 백업 복원에서 내용을 확인해 주세요.`,
        );
      }
    } catch {
      setMessage("백업을 읽지 못했어요. 5MiB 이하 UTF-8 JSON 파일을 선택해 주세요.");
    } finally {
      readingFile.current = false;
      setBusy(false);
    }
  };
  const dropped = useRef(importFile);
  dropped.current = importFile;
  useEffect(
    () =>
      deck.on("fs.dropped", ({ files }) => {
        const file = files[0];
        if (files.length !== 1 || !file || file?.ext.toLowerCase() !== "json") {
          setMessage("JSON 백업 파일을 한 번에 1개씩 놓아 주세요.");
          return;
        }
        setMessage(`${file.name}을 받았어요. 백업을 읽고 있어요.`);
        void dropped.current(file);
      }),
    [deck],
  );
  function updateInput(patch: Partial<PlanInput>) {
    const next = changeConditions(state, patch, HOLIDAYS);
    if (next.state.detailed && patch.teachers) {
      const ids = new Set(patch.teachers.map((t) => t.id));
      const detailed = next.state.detailed;
      next.state = {
        ...next.state,
        detailed: {
          ...detailed,
          jobs: detailed.jobs.map((j) => ({ ...j, excluded: j.excluded.filter((id) => ids.has(id)) })),
          assignments: Object.fromEntries(
            Object.entries(detailed.assignments).map(([key, row]) => [key, row.every((id) => ids.has(id)) ? row : []]),
          ),
        },
      };
    }
    setState(next.state);
    setIssues(next.issues);
    setMessage("조건을 바꿨어요. 조건에 맞는 기존 배정은 유지해요. 전체 균형을 다시 맞추려면 배정을 눌러 주세요.");
  }
  function applyRoster() {
    const next = parseRoster(roster, input.teachers);
    if (!next) {
      setMessage("명단은 이름과 과거 횟수를 한 줄씩 입력해 주세요. 중복 이름 없이 최대 500명이에요.");
      return;
    }
    if (
      state.detailed &&
      [
        ...Object.values(state.detailed.actual).flat(),
        ...Object.values(state.detailed.manual).flat(),
        ...state.detailed.jobs.flatMap((j) => j.fixed),
      ].some((id) => !next.some((t) => t.id === id))
    ) {
      setMessage(
        "세부 편성의 고정·직접 배정·실제 기록이 있는 교사를 빼려면 해당 업무의 조건과 기록을 먼저 수정해 주세요.",
      );
      return;
    }
    if (
      Object.values(state.actual ?? {})
        .flat()
        .some((id) => !next.some((t) => t.id === id))
    ) {
      setMessage("실제 수행 기록이 있는 교사를 빼려면 해당 날짜의 수행자를 먼저 수정하거나 비워 주세요.");
      return;
    }
    if (
      Object.values(input.manual)
        .flat()
        .some((id) => !next.some((t) => t.id === id))
    ) {
      setMessage("직접 배정된 교사를 빼려면 해당 날짜의 직접 배정을 먼저 해제해 주세요.");
      return;
    }
    if (input.teachers.some((t) => t.fixed.length > 0 && !next.some((n) => n.id === t.id))) {
      setMessage("고정 배정된 교사를 빼려면 교사의 고정 날짜를 먼저 해제해 주세요.");
      return;
    }
    updateInput({ teachers: next });
    setTeacherId(next[0]?.id ?? "");
    setMessage("명단을 적용했어요. 교사 조건을 설정한 뒤 배정해 주세요.");
  }
  function editTeacher(patch: Partial<PlanInput["teachers"][number]>) {
    const teachers = input.teachers.map((t) => (t.id === teacherId ? { ...t, ...patch } : t));
    updateInput({ teachers });
    setRoster(teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
  }
  function addTeacher() {
    const name = newName.trim();
    if (!name || name.includes("\n") || name.includes(",") || name.includes("\t")) {
      setMessage("교사 이름을 한 명씩 입력해 주세요.");
      return;
    }
    const next = parseRoster([...input.teachers.map((t) => `${t.name}\t${t.past}`), name].join("\n"), input.teachers);
    if (!next) {
      setMessage("이미 등록된 이름인지 확인해 주세요. 명단은 최대 500명이에요.");
      return;
    }
    const added = next.at(-1);
    if (added) added.past = averagePast(cumulative.teachers);
    updateInput({ teachers: next });
    setRoster(next.map((t) => `${t.name}\t${t.past}`).join("\n"));
    setTeacherId(next.at(-1)?.id ?? "");
    setNewName("");
    nameInput.current?.focus();
  }
  function generate() {
    const worker = new Worker(new URL("./planner.worker.ts", import.meta.url), { type: "module" });
    workerRef.current?.terminate();
    workerRef.current = worker;
    setBusy(true);
    setMessage("");
    setIssues([]);
    worker.onmessage = (event: MessageEvent<PlanResult>) => {
      if (!event.data.issues.length) setState((prev) => ({ ...prev, assignments: event.data.assignments }));
      setIssues(event.data.issues);
      setBusy(false);
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = () => {
      setBusy(false);
      setMessage("배정을 계산하지 못했어요. 다시 배정해 주세요.");
      worker.terminate();
      workerRef.current = null;
    };
    const next = cumulativeInput(state, months);
    const detailCounts = state.detailed ? detailedCounts(state.detailed) : {};
    worker.postMessage({
      ...next,
      holidays: HOLIDAYS,
      teachers: next.teachers.map((t) => ({ ...t, past: t.past + (detailCounts[t.id] ?? 0) })),
    });
  }
  function applyManual(selection = manualSelection) {
    if (busy || state.closed || !currentDay || currentDay.excluded) {
      setMessage("제외된 날짜에는 배정할 수 없어요. 날짜 제외 조건을 먼저 조정해 주세요.");
      return;
    }
    if (selection.filter(Boolean).length !== daySlots || new Set(selection).size !== daySlots) {
      setMessage("하루 인원에 맞게 서로 다른 교사를 선택해 주세요.");
      return;
    }
    const fixed = input.teachers.filter((t) => t.fixed.includes(currentDay.day));
    if (
      fixed.some((t) => !selection.includes(t.id)) ||
      selection.some((id, slot) => {
        const t = input.teachers.find((item) => item.id === id);
        return (
          !t ||
          !eligibleSlot(t, currentDay.weekday, slot) ||
          t.participating === false ||
          t.excluded.includes(currentDay.day) ||
          t.weekdays.includes(currentDay.weekday)
        );
      })
    ) {
      setMessage("고정·교사 제외 조건과 직접 배정이 겹쳐요. 교사 조건을 먼저 조정해 주세요.");
      return;
    }
    const next = {
      ...state,
      input: { ...state.input, manual: { ...state.input.manual, [selectedDay]: selection } },
      assignments: { ...state.assignments, [selectedDay]: selection },
    };
    setState(next);
    setManualSelection(selection);
    setIssues(changeConditions(next, {}, HOLIDAYS).issues);
    setMessage("직접 배정을 적용했어요. 다시 배정해도 이 날짜는 유지돼요.");
  }
  function clearManual() {
    if (!currentDay || state.closed || busy) return;
    const manual = Object.fromEntries(Object.entries(input.manual).filter(([day]) => day !== selectedDay));
    const next = { ...state, input: { ...state.input, manual } };
    setState(next);
    setIssues(changeConditions(next, {}, HOLIDAYS).issues);
    setMessage("이 날짜의 직접 배정을 해제했어요. 교사 고정 조건은 유지돼요.");
  }
  if (!loaded) return <ProgressRing label="저장한 내용을 불러와요" />;
  const teacherOptions = [
    { value: "", label: "교사를 선택해 주세요" },
    ...input.teachers.map((t) => ({ value: t.id, label: t.name })),
  ];
  const dateEditor = (
    <section className={s.card} aria-label="날짜별 직접 배정">
      {narrow && message && <InfoBar message={message} />}
      {narrow && issues.map((issue, index) => <InfoBar key={`${index}-${issue}`} severity="error" message={issue} />)}
      <BodyStrong>
        {selectedDay}일 {currentDay ? WEEKDAYS[currentDay.weekday] : ""}요일
      </BodyStrong>
      {(state.legacyMissing?.[selectedDay]?.length ?? 0) > 0 && (
        <Caption secondary>기존 자료에 배정불가 표시가 있는 날짜예요. 담당자를 확인하거나 다시 배정해 주세요.</Caption>
      )}
      {currentDay?.excluded ? (
        <Body>{currentDay.reason}로 제외된 날짜예요.</Body>
      ) : (
        <>
          {Array.from({ length: daySlots }, (_, i) => (
            <ComboBox
              key={i}
              header={`${i + 1}번째 교사`}
              options={teacherOptions}
              value={manualSelection[i] ?? ""}
              disabled={busy || !!state.closed || !currentDay}
              onChange={(id) => {
                const selection = Array.from({ length: daySlots }, (_, n) =>
                  n === i ? id : (manualSelection[n] ?? ""),
                );
                setManualSelection(selection);
                if (selection.every(Boolean)) applyManual(selection);
              }}
            />
          ))}
          <Caption secondary>담당자를 바꾸면 바로 반영돼요. 다시 배정해도 직접 고른 담당자는 유지돼요.</Caption>
          <Button disabled={busy || !!state.closed || !input.manual[selectedDay]} onClick={clearManual}>
            직접 배정 해제
          </Button>
        </>
      )}
      <CheckBox
        content="이 날짜는 지도하지 않아요"
        checked={input.excluded.includes(Number(selectedDay))}
        disabled={busy || !!state.closed || !currentDay}
        onChange={(on) =>
          currentDay &&
          updateInput({
            excluded: on
              ? [...input.excluded, Number(selectedDay)]
              : input.excluded.filter((day) => day !== Number(selectedDay)),
          })
        }
      />
      <CheckBox
        content="고사일 · 한 명 배정"
        checked={input.exam?.includes(Number(selectedDay)) ?? false}
        disabled={busy || !!state.closed || !currentDay}
        onChange={(on) =>
          currentDay &&
          updateInput({
            exam: on
              ? [...(input.exam ?? []), Number(selectedDay)]
              : (input.exam ?? []).filter((d) => d !== Number(selectedDay)),
          })
        }
      />
      <TextBox
        header="날짜 메모"
        value={state.memo?.[selectedDay] ?? ""}
        disabled={busy || !!state.closed || !currentDay}
        onChange={(value) =>
          currentDay && setState((prev) => ({ ...prev, memo: { ...prev.memo, [selectedDay]: value.slice(0, 2000) } }))
        }
      />
      <BodyStrong>실제 수행 기록</BodyStrong>
      <Button
        disabled={busy || !!state.closed || !currentDay}
        onClick={() => {
          if (!currentDay) return;
          try {
            setState(recordAssigned(state, [Number(selectedDay)]));
            setMessage("선택한 날짜를 배정대로 수행했다고 기록했어요.");
          } catch {
            setMessage("미래 날짜는 실제 수행으로 기록할 수 없어요. 수행한 날짜를 선택해 주세요.");
          }
        }}
      >
        이 날짜 배정대로 수행 기록
      </Button>
      <SettingsExpander
        header="수행자 수정 · 월 수행 기록"
        description="배정과 다르게 수행한 교사 또는 오늘까지의 기록을 정리해요."
      >
        <Button
          disabled={busy || !!state.closed || !currentDay}
          onClick={() => {
            const now = new Date();
            const end =
              state.input.year === now.getFullYear() && state.input.month === now.getMonth() + 1 ? now.getDate() : 31;
            try {
              setState(
                recordAssigned(
                  state,
                  Array.from({ length: end }, (_, i) => i + 1),
                ),
              );
              setMessage("오늘까지의 날짜를 배정대로 수행했다고 기록했어요. 대체 수행자가 있으면 수정해 주세요.");
            } catch {
              setMessage("미래 달은 실제 수행으로 기록할 수 없어요.");
            }
          }}
        >
          오늘까지 배정대로 수행 기록
        </Button>
        {Array.from({ length: Math.max(daySlots, actualSlots.length) }, (_, i) => (
          <ComboBox
            key={`actual-${i}`}
            header={`${i + 1}번째 실제 수행자`}
            value={actualSlots[i] ?? ""}
            options={teacherOptions}
            disabled={busy || !!state.closed || !currentDay}
            onChange={(id) => {
              if (!currentDay) return;
              const next = Array.from({ length: Math.max(daySlots, actualSlots.length) }, (_, n) =>
                n === i ? id : (actualSlots[n] ?? ""),
              );
              if (id && next.filter((x) => x === id).length > 1) {
                setMessage("실제 수행자는 서로 다르게 선택해 주세요.");
                return;
              }
              const performers = next.filter(Boolean);
              actualEditors.current.set(actualKey, { source: performers, slots: next });
              setState((prev) => ({ ...prev, actual: { ...prev.actual, [selectedDay]: performers } }));
            }}
          />
        ))}
        <Caption secondary>배정만으로 횟수가 늘지 않아요. 실제 수행자를 기록하고 월을 마감해요.</Caption>
      </SettingsExpander>
      <BodyStrong>선택한 교사 조건</BodyStrong>
      <ComboBox
        header="조건을 바꿀 교사"
        options={teacherOptions}
        value={teacherId}
        disabled={busy || !!state.closed || !currentDay}
        onChange={setTeacherId}
      />
      {teacher && (
        <>
          <CheckBox
            content={`${selectedDay}일에 ${teacher.name} 고정`}
            checked={teacher.fixed.includes(Number(selectedDay))}
            disabled={busy || !!state.closed || !currentDay}
            onChange={(on) =>
              currentDay &&
              editTeacher({
                fixed: on
                  ? [...teacher.fixed, Number(selectedDay)]
                  : teacher.fixed.filter((day) => day !== Number(selectedDay)),
              })
            }
          />
          <CheckBox
            content={`${selectedDay}일에 ${teacher.name} 제외`}
            checked={teacher.excluded.includes(Number(selectedDay))}
            disabled={busy || !!state.closed || !currentDay}
            onChange={(on) =>
              currentDay &&
              editTeacher({
                excluded: on
                  ? [...teacher.excluded, Number(selectedDay)]
                  : teacher.excluded.filter((day) => day !== Number(selectedDay)),
              })
            }
          />
        </>
      )}
    </section>
  );
  const rosterEditor = (
    <section className={s.card} aria-label="교사 명단과 배정 횟수">
      <BodyStrong>교사 명단 · {input.teachers.length}명</BodyStrong>
      <Caption secondary>이름을 입력하고 Enter로 추가해요. 명단이 준비되면 배정하고 달력에서 날짜를 편집해요.</Caption>
      <div className={s.row}>
        <TextBox
          header="교사 이름"
          value={newName}
          onChange={setNewName}
          disabled={busy || !!state.closed}
          placeholder="이름 입력 후 Enter"
          inputRef={nameInput}
          onCompositionStart={() => {
            composingName.current = true;
          }}
          onCompositionEnd={() => {
            composingName.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !composingName.current &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              addTeacher();
            }
          }}
        />
        <Button onClick={addTeacher} disabled={busy || !!state.closed || !newName.trim()}>
          추가
        </Button>
      </div>
      <div className={s.row}>
        {input.teachers.map((t) => (
          <Button
            key={t.id}
            appearance={teacherId === t.id ? "primary" : "subtle"}
            disabled={busy || !!state.closed}
            onClick={() => setTeacherId(t.id)}
          >
            {t.name} · 과거 {t.past} · 누적 {cumulative.teachers.find((x) => x.id === t.id)?.past ?? t.past} + 이번{" "}
            {(projected[t.id] ?? 0) + (detailedProjected[t.id] ?? 0)}회
          </Button>
        ))}
      </div>
      <ComboBox
        header="명단에서 조건을 바꿀 교사"
        options={teacherOptions}
        value={teacherId}
        disabled={busy || !!state.closed}
        onChange={setTeacherId}
      />
      {teacher && (
        <>
          <CheckBox
            content="이번 달 배정에 참여해요"
            checked={teacher.participating !== false}
            disabled={busy || !!state.closed}
            onChange={(participating) => editTeacher({ participating })}
          />
          <SettingsExpander
            header="순번별 허용 요일"
            description="중식 1차·2차처럼 순번마다 담당 가능한 요일을 나눠요."
          >
            {Array.from({ length: input.perDay }, (_, slot) => (
              <div key={slot}>
                <BodyStrong>{slot + 1}번째 담당 가능 요일</BodyStrong>
                <div className={s.row}>
                  {WEEKDAYS.map((label, weekday) => (
                    <CheckBox
                      key={label}
                      content={`${slot + 1}번째 ${label}요일`}
                      checked={eligibleSlot(teacher, weekday, slot)}
                      disabled={busy || !!state.closed}
                      onChange={(on) => {
                        const rows = Array.from({ length: 3 }, (_, n) => [
                          ...(teacher.slotWeekdays?.[n] ?? [0, 1, 2, 3, 4, 5, 6]),
                        ]);
                        rows[slot] = on
                          ? [...(rows[slot] ?? []), weekday]
                          : (rows[slot] ?? []).filter((d) => d !== weekday);
                        editTeacher({ slotWeekdays: rows });
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </SettingsExpander>
          <Button
            disabled={busy || !!state.closed}
            onClick={() =>
              editTeacher({
                past: averagePast(cumulative.teachers.filter((t) => t.id !== teacher.id)),
              })
            }
          >
            다른 참여 교사 평균으로 기초 보정
          </Button>
          <NumberBox
            step={0.1}
            header="과거 실제 수행 횟수"
            value={teacher.past}
            min={0}
            max={100000}
            disabled={busy || !!state.closed}
            onChange={(past) => editTeacher({ past })}
          />
          <Caption secondary>배정하지 않는 요일</Caption>
          <div className={s.row}>
            {WEEKDAYS.map((label, i) => (
              <CheckBox
                key={label}
                content={`${label}요일 제외`}
                checked={teacher.weekdays.includes(i)}
                disabled={busy || !!state.closed}
                onChange={(on) =>
                  editTeacher({ weekdays: on ? [...teacher.weekdays, i] : teacher.weekdays.filter((n) => n !== i) })
                }
              />
            ))}
          </div>
          <Caption secondary>
            고정: {teacher.fixed.join(" · ") || "없음"} / 제외: {teacher.excluded.join(" · ") || "없음"}
          </Caption>
        </>
      )}
      <SettingsExpander
        header="시간표 추출표 붙여넣기"
        description="교사명·요일·교시·교과/교실 열을 붙여 넣으면 4교시 수업 없는 날은 1번째, 있는 날은 2번째 담당으로 설정해요."
      >
        <TextBox
          header="시간표 TSV"
          multiline
          value={timetableText}
          onChange={setTimetableText}
          disabled={busy || !!state.closed}
        />
        <Button
          disabled={busy || !!state.closed}
          onClick={() => {
            const teachers = parseTimetable(timetableText, state.input.teachers, averagePast(cumulative.teachers));
            if (!teachers) {
              setMessage("교사명·요일·교시·교과/교실 열과 월~금 요일을 확인해 주세요.");
              return;
            }
            updateInput({ teachers });
            setRoster(teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
            setMessage("시간표에서 순번별 허용 요일을 설정했어요. 시간강사는 참여 여부를 꺼 주세요.");
          }}
        >
          시간표 조건 적용
        </Button>
      </SettingsExpander>
      <SettingsExpander header="여러 명 붙여넣기" description="이름을 한 줄씩 입력하거나 엑셀 명단을 붙여넣어요.">
        <TextBox
          header="교사 명단"
          multiline
          value={roster}
          disabled={busy || !!state.closed}
          onChange={setRoster}
          placeholder={"교사A\n교사B"}
          description="이름만 넣어도 돼요. 과거 횟수가 있으면 이름 옆 열에 함께 붙여넣어요."
        />
        <Button onClick={applyRoster} disabled={busy || !!state.closed}>
          명단 적용
        </Button>
      </SettingsExpander>
      {!!input.teachers.length && (
        <Button
          onClick={() => {
            setRosterExpanded(false);
            requestAnimationFrame(() =>
              rosterPanel.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus(),
            );
          }}
        >
          명단 준비 완료
        </Button>
      )}
    </section>
  );
  return (
    <main className={s.page}>
      <PageHeader
        title="지도일배정기"
        description="달력에서 제외일과 담당 교사를 고르고, 남은 날짜를 균등하게 배정해요."
      />
      <section className={s.card} aria-label="이번 달 배정">
        <div className={s.row}>
          <BodyStrong>
            {input.year}년 {input.month}월
          </BodyStrong>
          <Caption>
            하루 {input.perDay}명 · 명단 {input.teachers.length}명 · 참여{" "}
            {input.teachers.filter((t) => t.participating !== false).length}명
          </Caption>
          <Button appearance="primary" disabled={busy || !!state.closed || !input.teachers.length} onClick={generate}>
            배정
          </Button>
          <Button
            disabled={busy || storageBlocked}
            onClick={() =>
              void persist()
                .then(() => setMessage("이 PC에 명단·조건·배정표를 저장했어요."))
                .catch((error: unknown) =>
                  setMessage(
                    error instanceof Error && error.message === "STORAGE_SIZE_LIMIT"
                      ? "저장 용량을 넘었어요. 명단이나 조건을 줄여 주세요."
                      : "저장하지 못했어요. 다시 저장해 주세요.",
                  ),
                )
            }
          >
            저장
          </Button>
          {busy && <ProgressRing label="조건에 맞게 배정해요" />}
          <Caption secondary>
            {state.closed ? "마감한 달이에요." : "배정 후 달력에서 담당자를 바로 바꿀 수 있어요."}
          </Caption>
        </div>
        <div className={s.row}>
          <NumberBox
            header="연도"
            min={1900}
            max={2100}
            value={input.year}
            disabled={busy}
            onChange={(year) => changeMonth(year, input.month)}
          />
          <NumberBox
            header="월"
            min={1}
            max={12}
            value={input.month}
            disabled={busy}
            onChange={(month) => changeMonth(input.year, month)}
          />
          <SettingsExpander header="배정 조건">
            <div className={s.row}>
              <NumberBox
                header="하루 인원"
                min={1}
                max={3}
                value={input.perDay}
                disabled={busy || !!state.closed}
                onChange={(perDay) => updateInput({ perDay })}
              />
              <CheckBox
                content="주말 제외"
                checked={input.weekends}
                disabled={busy || !!state.closed}
                onChange={(weekends) => updateInput({ weekends })}
              />
            </div>
          </SettingsExpander>
        </div>
      </section>
      {message && <InfoBar message={message} onClose={() => setMessage("")} />}
      {issues.map((issue, index) => (
        <InfoBar key={`${index}-${issue}`} severity="error" message={issue} />
      ))}
      <div ref={rosterPanel}>
        <SettingsExpander
          header="명단 준비"
          description={`${input.teachers.length}명 · 이름 추가 · 교사별 참여와 횟수 · 붙여넣기`}
          expanded={rosterExpanded}
          onExpandedChange={setRosterExpanded}
        >
          {rosterEditor}
        </SettingsExpander>
      </div>
      {!input.teachers.length && <Caption secondary>명단 준비에서 교사 이름을 추가한 뒤 배정을 눌러 주세요.</Caption>}
      <div className={s.workspace}>
        <section className={s.calendarPanel} aria-label="월별 배정 달력">
          <BodyStrong>
            {input.year}년 {input.month}월
          </BodyStrong>

          <div className={s.row} aria-label="달력 표시 안내">
            <Caption className={s.red}>일요일·공휴일</Caption>
            <Caption className={s.blue}>토요일</Caption>
            <Caption>— 지도 없음</Caption>
            <Caption className={s.fixed}>◆ 직접·고정</Caption>
            <Caption className={s.performed}>✓ 수행 기록</Caption>
          </div>
          <div className={s.calendar}>
            {WEEKDAYS.map((day, index) => (
              <BodyStrong
                key={day}
                className={mergeClasses(s.weekday, index === 0 ? s.red : index === 6 ? s.blue : undefined)}
                data-day-tone={index === 0 ? "red" : index === 6 ? "blue" : "neutral"}
              >
                {day}
              </BodyStrong>
            ))}
            {Array.from({ length: days[0]?.weekday ?? 0 }, (_, i) => (
              <div key={`blank-${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => {
              const view = calendarStatus(d, input, state, selectedDay === String(d.day));
              const direct = input.manual[String(d.day)];
              const conflict = direct !== undefined && !isValidAssignment(input, String(d.day), direct);
              const assigned = state.assignments[String(d.day)] ?? (conflict ? [] : direct) ?? [];
              return (
                <Button
                  key={d.day}
                  className={mergeClasses(
                    s.cell,
                    view.excluded ? s.excluded : s.working,
                    view.selected ? s.selected : undefined,
                  )}
                  appearance="outline"
                  disabled={busy}
                  aria-label={`${d.day}일 배정 편집`}
                  aria-pressed={view.selected}
                  data-day-tone={view.tone}
                  data-day-excluded={view.excluded}
                  onClick={(event) => {
                    dateTrigger.current = event.currentTarget;
                    setSelectedDay(String(d.day));
                    if (narrow) setDateDialog(true);
                  }}
                >
                  <span className={s.dateHeading}>
                    <BodyStrong className={view.tone === "red" ? s.red : view.tone === "blue" ? s.blue : ""}>
                      {d.day}
                    </BodyStrong>
                    {view.selected && <Caption>선택</Caption>}
                  </span>
                  {view.holiday && <Caption className={s.red}>{view.holiday}</Caption>}
                  {view.excluded ? (
                    <Caption className={s.muted}>— {view.holiday === d.reason ? "지도 없음" : d.reason}</Caption>
                  ) : (
                    <>
                      {assigned.length ? (
                        assigned.map((id, i) => (
                          <Caption key={`${i}-${id}`}>
                            {i + 1}차 · <span>{input.teachers.find((t) => t.id === id)?.name ?? "미배정"}</span>
                          </Caption>
                        ))
                      ) : (
                        <Caption className={s.muted}>미배정</Caption>
                      )}
                      {view.exam && <Caption>고사 · 1차만</Caption>}
                    </>
                  )}
                  {conflict && <Caption className={s.fixed}>직접 배정 조건 충돌</Caption>}
                  {(view.manual || view.fixed) && (
                    <Caption className={s.fixed}>
                      ◆ {view.manual ? "직접 배정" : ""}
                      {view.manual && view.fixed ? " · " : ""}
                      {view.fixed ? "고정 조건" : ""}
                    </Caption>
                  )}
                  {view.performed && (
                    <Caption className={s.performed}>✓ 수행 기록 {state.actual?.[String(d.day)]?.length}명</Caption>
                  )}
                  {state.memo?.[String(d.day)] && <Caption className={s.muted}>메모 있음</Caption>}
                </Button>
              );
            })}
          </div>
        </section>
        {!narrow && dateEditor}
      </div>
      <ContentDialog
        open={narrow && dateDialog && !!currentDay}
        title={`${input.month}월 ${selectedDay}일 배정 편집`}
        closeButtonText="닫기"
        onClose={() => {
          setDateDialog(false);
          requestAnimationFrame(() => dateTrigger.current?.focus());
        }}
      >
        {dateEditor}
      </ContentDialog>
      <ContentDialog
        open={restoreOpen}
        title="백업 복원 확인"
        primaryButtonText="확인하고 복원"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          const importedSource = pendingSource.current;
          setRestoreOpen(false);
          if (result === "primary" && restorePreview) void restoreConfirmed(restorePreview, importedSource);
        }}
      >
        <Body>{pendingSource.current?.name ?? "붙여 넣은 백업"}</Body>
        <Body>{Object.keys(restorePreview?.months ?? {}).length}개월의 자료로 현재 작업을 바꿔요.</Body>
        {restorePreview?.legacy && (
          <Body>
            기존 형식의 연도는 {legacyYear ?? input.year}년으로 확인했어요. 누적 횟수는 기초 횟수로 읽고 배정표를 실제
            수행으로 기록하지 않아요. 원본의 제외일에 내장 공휴일도 적용해요.
          </Body>
        )}
        <Body>
          {storageBlocked
            ? "기존 저장값을 보존한 새 복구 세대에 저장하고, 저장이 성공한 뒤에만 잠금을 풀어요."
            : "화면의 미저장 작업이 바뀌어요. 저장을 누르기 전까지 PC 저장값은 유지해요."}
        </Body>
      </ContentDialog>
      <DetailedEditor
        draft={detailedDraft}
        onDraftChange={setDetailedDraft}
        state={state}
        input={{ ...cumulative, holidays: HOLIDAYS }}
        busy={busy}
        onBusy={setBusy}
        onChange={(detailed) => setState((prev) => ({ ...prev, detailed }))}
      />
      <SettingsExpander header="월 마감 · 백업 · 내보내기">
        <CheckBox
          content="내보낼 때 다른 폴더 선택"
          checked={chooseExportFolder}
          onChange={setChooseExportFolder}
          disabled={busy}
        />
        <div className={s.row}>
          <Button
            disabled={busy || storageBlocked || !!state.closed}
            onClick={() => {
              const next = closeMonth(state);
              void persist(next)
                .then(() => {
                  restoreState(next);
                  setMessage("실제 수행 횟수로 월을 마감했어요.");
                })
                .catch(() => setMessage("월 마감을 저장하지 못했어요. 다시 시도해 주세요."));
            }}
          >
            월 마감
          </Button>
          {state.closed && (
            <Button disabled={busy} onClick={() => setState((prev) => ({ ...prev, closed: false }))}>
              마감 수정 열기
            </Button>
          )}
          <Button onClick={() => void exportFile("backup.json", encodeBackup({ ...months, [monthKey(state)]: state }))}>
            JSON 백업 저장
          </Button>
          <Button onClick={() => void exportFile("schedule.csv", exportCsv({ ...state, input }))}>
            Excel CSV 저장
          </Button>
          <Button disabled={busy} onClick={legacyExport}>
            기존 형식 JSON 저장
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void importFile();
            }}
          >
            백업 파일 열기
          </Button>
        </div>
        {state.closed && (
          <InfoBar message="마감한 달이에요. 수행 기록을 수정하려면 마감 수정 열기를 누르고 수정 후 다시 저장·마감해 주세요." />
        )}
        <SettingsExpander header="JSON 백업 복원">
          <TextBox
            header="복원할 JSON"
            multiline
            value={backupText}
            onChange={(value) => {
              pendingSource.current = undefined;
              setBackupText(value);
            }}
            disabled={busy}
          />
          <NumberBox
            header="기존 형식의 연도"
            value={legacyYear ?? input.year}
            min={1900}
            max={2100}
            step={1}
            onChange={setLegacyYear}
          />
          <Caption secondary>
            원작 JSON에는 연도가 없어요. 해당 자료의 연도를 확인해 주세요. TeacherDeck 백업은 파일의 연도를 그대로
            사용해요.
          </Caption>
          <Caption>복원은 화면의 작업 상태를 바꿔요. 확인 후 저장을 누르면 복원한 모든 달이 이 PC에 저장돼요.</Caption>
          <Button
            disabled={busy}
            onClick={() => {
              const own = decodeBackup(backupText);
              const restored = own ?? decodeLegacy(backupText, legacyYear ?? input.year);
              if (!restored) {
                setMessage(
                  "백업 구조와 기존 형식의 연도·요일을 확인해 주세요. 중복 월·날짜·이름이나 범위를 벗어난 값은 복원하지 않아요.",
                );
                return;
              }
              setRestorePreview({ months: restored, legacy: !own });
              setRestoreOpen(true);
            }}
          >
            복원 적용
          </Button>
        </SettingsExpander>
      </SettingsExpander>
      <Caption secondary>
        {input.year >= HOLIDAY_FIRST_YEAR && input.year <= HOLIDAY_LAST_YEAR
          ? input.year === 2026
            ? "2026년 법정 공휴일은 자동 제외해요. 임시공휴일·학교 휴업일은 달력에서 추가해 주세요."
            : "2027~2030년 내장 공휴일을 자동 제외해요. 향후 월력요항·법령 변경은 확인해 주세요. 2030년 선거일과 임시공휴일·학교 휴업일은 직접 추가해 주세요."
          : "공휴일 자동 제외는 2026~2030년을 지원해요. 이 연도 공휴일은 달력에서 직접 제외해 주세요."}
      </Caption>
      <Caption secondary>
        다시 배정해도 실제 수행 횟수는 늘지 않아요. 월별 조건과 수행 기록을 따로 보관해요. 명단은 이 모듈에만 저장돼요.
      </Caption>
    </main>
  );
}
