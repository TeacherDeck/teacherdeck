// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useMemo, useRef, useState } from "react";
import type { SchoolDataDocument, SchoolDateChangeKind, SchoolGrantRecord, SchoolWeeklySlot } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  ComboBox,
  ContentDialog,
  InfoBar,
  NumberBox,
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import {
  appendRoster,
  newChange,
  newId,
  newOverride,
  parseDaySlots,
  parseMembership,
  parseWeekly,
  setWeeklyEntry,
  formatWeekly,
  WEEKDAYS,
  type SchoolDataHost,
} from "./school-data-model.ts";
import {
  applyWorkbookTimetable,
  readWorkbook,
  rosterFromWorkbook,
  rosterRows,
  timetableFromWorkbook,
  timetableRows,
} from "./school-workbook.ts";
import { renderTimetablePng } from "./school-timetable-image.ts";
import { SchoolPortability } from "./SchoolPortability.tsx";
export type { SchoolDataHost } from "./school-data-model.ts";
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, padding: deckTokens.pagePadding },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalL,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: deckTokens.inlineGap },
  member: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: deckTokens.inlineGap,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
  },
  tableScroll: { overflowX: "auto" },
  weeklyTable: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
  },
  imageHeader: { backgroundColor: tokens.colorNeutralBackground3 },
  weeklyCell: {
    padding: tokens.spacingVerticalXS,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    verticalAlign: "middle",
    overflowWrap: "anywhere",
  },
  cellButton: { width: "100%", minWidth: 0, whiteSpace: "normal" },
  today: { backgroundColor: tokens.colorBrandBackground2 },
  saturday: { color: tokens.colorPaletteBlueForeground2 },
  sunday: { color: tokens.colorPaletteRedForeground1 },
});
const minuteText = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** Teacher-owned authoring; no module can call the save or native-photo commands. */
export function SchoolData({ host }: { host: SchoolDataHost }) {
  const s = useStyles(),
    [document, setDocument] = useState<SchoolDataDocument | null>(null),
    [semesterId, setSemesterId] = useState(""),
    [tab, setTab] = useState("roster"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [grants, setGrants] = useState<SchoolGrantRecord[]>([]);
  const timetableElement = useRef<HTMLTableElement>(null);
  const [confirmBackup, setConfirmBackup] = useState(false);
  const [semesterSettings, setSemesterSettings] = useState(false);
  const [recovery, setRecovery] = useState<SchoolDataDocument | null>(null);
  const [workbookUndo, setWorkbookUndo] = useState<{
    before: SchoolDataDocument;
    revision: number;
    kind: "roster" | "timetable";
  } | null>(null);
  const [confirmWorkbookUndo, setConfirmWorkbookUndo] = useState(false);
  const [workbookPreviewOpen, setWorkbookPreviewOpen] = useState(false);
  const [workbookPreview, setWorkbookPreview] = useState<{
    kind: "roster" | "timetable";
    text: string;
    warnings: string[];
    count: number;
    lessons?: ReturnType<typeof timetableFromWorkbook>["lessons"];
  } | null>(null);
  const [year, setYear] = useState(new Date().getFullYear()),
    [term, setTerm] = useState(1),
    [start, setStart] = useState(`${new Date().getFullYear()}-03-01`),
    [end, setEnd] = useState(`${new Date().getFullYear()}-07-31`),
    [archive, setArchive] = useState(false);
  const [roster, setRoster] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [editing, setEditing] = useState(""),
    [editName, setEditName] = useState(""),
    [editStatus, setEditStatus] = useState("active");
  const [contextId, setContextId] = useState(""),
    [contextLabel, setContextLabel] = useState(""),
    [subject, setSubject] = useState(""),
    [room, setRoom] = useState(""),
    [members, setMembers] = useState("");
  const [dayId, setDayId] = useState(""),
    [dayLabel, setDayLabel] = useState("기본 일과"),
    [dayText, setDayText] = useState("1,09:00,09:50\n2,10:00,10:50"),
    [weeklyId, setWeeklyId] = useState(""),
    [weeklyLabel, setWeeklyLabel] = useState("기본 시간표"),
    [weeklyText, setWeeklyText] = useState("");
  const [gridContextId, setGridContextId] = useState("");
  const [weeklyEntries, setWeeklyEntries] = useState<SchoolWeeklySlot[] | null>([]);
  const [gridPeriods, setGridPeriods] = useState(8);
  const weeklyDrafts = useRef(new Map<string, { label: string; text: string; entries: SchoolWeeklySlot[] | null }>());
  const semesterWeeklySelections = useRef(new Map<string, string>());
  const [overrideDate, setOverrideDate] = useState(""),
    [overrideWeekday, setOverrideWeekday] = useState(""),
    [overrideDay, setOverrideDay] = useState(""),
    [overrideFromPeriod, setOverrideFromPeriod] = useState(1),
    [overrideWeekly, setOverrideWeekly] = useState("");
  const [changeDate, setChangeDate] = useState(""),
    [changeContext, setChangeContext] = useState(""),
    [changeKind, setChangeKind] = useState<SchoolDateChangeKind>("MOVE"),
    [changeTargetDate, setChangeTargetDate] = useState(""),
    [fromPeriod, setFromPeriod] = useState(1),
    [toPeriod, setToPeriod] = useState(2);
  const refresh = async () => {
    setWorkbookUndo(null);
    setConfirmWorkbookUndo(false);
    setBusy(true);
    setError("");
    try {
      const [d, g] = await Promise.all([host.load(), host.grants()]);
      setDocument(d);
      setSemesterSettings(!d.semesters.length);
      setGrants(g);
      setSemesterId((previous) =>
        d.semesters.some((v) => v.id === previous)
          ? previous
          : (d.semesters.find((v) => !v.readOnly)?.id ?? d.semesters[0]?.id ?? ""),
      );
    } catch {
      setError("학교 자료를 불러오지 못했어요. 원본 자료는 유지돼요. 다시 불러오기를 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [host]);
  const save = async (
    change: (d: SchoolDataDocument) => SchoolDataDocument | undefined,
    text: string,
    importKind?: "roster" | "timetable",
  ) => {
    if (!document || busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const before = importKind ? structuredClone(document) : null;
      const copy = structuredClone(document),
        next = change(copy) ?? copy;
      const result = await host.save({ expectedRevision: document.revision, document: next });
      setDocument(result);
      setWorkbookUndo(importKind && before ? { before, revision: result.revision, kind: importKind } : null);
      setMessage(text);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "저장하지 못했어요. 다른 화면에서 변경했다면 다시 불러온 후 적용해 주세요.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const undoWorkbook = async () => {
    if (!document || busy || !workbookUndo) return;
    if (document.revision !== workbookUndo.revision) {
      setWorkbookUndo(null);
      setError("가져온 뒤 자료가 변경되어 되돌릴 수 없어요. 현재 자료를 다시 확인해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const restored = await host.save({
        expectedRevision: workbookUndo.revision,
        document: structuredClone(workbookUndo.before),
      });
      setDocument(restored);
      if (
        (weeklyId && !restored.timetable.weeklyTables.some((table) => table.id === weeklyId)) ||
        weeklyEntries?.some(
          (entry) =>
            !restored.contexts.some((context) => context.id === entry.contextId && context.semesterId === semesterId),
        )
      ) {
        weeklyDrafts.current.delete(JSON.stringify([semesterId, weeklyId]));
        setWeeklyId("");
        setWeeklyLabel("새 시간표");
        setWeeklyText("");
        setWeeklyEntries([]);
        setGridContextId("");
      }
      setWorkbookUndo(null);
      setMessage("최근 XLSX 가져오기 전 자료로 되돌렸어요.");
    } catch {
      // Keep the snapshot for retry, but never rebase it to a newer revision: the host's
      // compare-and-swap protects changes made outside this screen.
      setError("가져오기를 되돌리지 못했어요. 다른 화면에서 변경했다면 다시 불러와 현재 자료를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const semester = document?.semesters.find((v) => v.id === semesterId),
    disabled = busy || !semester || semester.readOnly;
  const importWorkbook = async (kind: "roster" | "timetable") => {
    if (disabled) return;
    setBusy(true);
    setError("");
    try {
      const input = await host.readWorkbook();
      if (!input) return;
      const sheet = await readWorkbook(input);
      if (kind === "roster") {
        const result = rosterFromWorkbook(sheet);
        setWorkbookPreview({ kind, ...result, count: result.text.split("\n").length });
      } else {
        const result = timetableFromWorkbook(sheet);
        setWorkbookPreview({
          kind,
          text: result.lessons
            .map(
              (l) =>
                `${["월", "화", "수", "목", "금", "토", "일"][l.weekday - 1]},${l.period},${[l.subject, l.division, l.hint].filter(Boolean).join(" ")}`,
            )
            .join("\n"),
          lessons: result.lessons,
          warnings: result.warnings,
          count: result.lessons.length,
        });
      }
      setWorkbookPreviewOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "XLSX 명부·시간표를 읽지 못했어요. 이전 자료는 유지돼요.");
    } finally {
      setBusy(false);
    }
  };
  const exportWorkbook = async (kind: "roster" | "timetable", template = false) => {
    if (!document || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const rows = template
        ? kind === "roster"
          ? [
              ["학년", "반", "번호", "이름"],
              ["1", "1", "1", "가학생"],
              ["1", "1", "2", "나학생"],
            ]
          : [
              ["", "월", "화", "수", "목", "금"],
              ...Array.from({ length: 7 }, (_, i) => [String(i + 1), "", "", "", "", ""]),
            ]
        : kind === "roster"
          ? rosterRows(document, semesterId)
          : timetableRows(document, weeklyId);
      if (await host.writeWorkbook({ sheetName: kind === "roster" ? "학생 명단" : "시간표", rows }))
        setMessage("선택한 폴더에 XLSX 새 파일을 저장했어요. 같은 이름의 파일이 있으면 번호를 붙여 보존해요.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "XLSX 파일을 저장하지 못했어요. 기존 파일은 유지돼요.");
    } finally {
      setBusy(false);
    }
  };
  const enrollments = useMemo(
    () =>
      document?.enrollments
        .filter((e) => e.semesterId === semesterId)
        .sort((a, b) => a.grade - b.grade || a.classNumber - b.classNumber || a.studentNumber - b.studentNumber) ?? [],
    [document, semesterId],
  );
  const studentMap = useMemo(() => new Map(document?.students.map((v) => [v.id, v]) ?? []), [document]);
  const filtered = enrollments.filter(
      (e) =>
        !query || `${e.grade}-${e.classNumber}-${e.studentNumber} ${studentMap.get(e.studentId)?.name}`.includes(query),
    ),
    safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1)),
    shown = filtered.slice(safePage * 50, safePage * 50 + 50);
  const contexts = document?.contexts.filter((c) => c.semesterId === semesterId) ?? [],
    days = document?.timetable.dayTemplates.filter((v) => v.semesterId === semesterId) ?? [],
    weeklies = document?.timetable.weeklyTables.filter((v) => v.semesterId === semesterId) ?? [];
  const grid = useMemo(() => {
    try {
      if (
        weeklyEntries?.some(
          (entry) =>
            !document?.contexts.some((context) => context.id === entry.contextId && context.semesterId === semesterId),
        )
      )
        throw new Error("편집 중인 수업이 현재 학기 자료에 없어요. 시간표를 다시 선택하거나 입력을 확인해 주세요.");
      return {
        entries: weeklyEntries ?? (document && weeklyText.trim() ? parseWeekly(document, semesterId, weeklyText) : []),
        error: "",
      };
    } catch (error) {
      return { entries: [], error: error instanceof Error ? error.message : "주간 수업 입력을 확인해 주세요." };
    }
  }, [document, semesterId, weeklyText, weeklyEntries]);
  const periods = Math.max(gridPeriods, ...grid.entries.map((entry) => entry.period));
  const exportBackup = async () => {
    if (!document || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (await host.exportBackup())
        setMessage("저장된 명부·시간표 복구 JSON을 새 파일로 저장했어요. 사진 파일과 미저장 초안은 포함하지 않아요.");
    } catch {
      setError("복구 JSON을 저장하지 못했어요. 기존 파일과 학교 자료는 유지돼요.");
    } finally {
      setBusy(false);
    }
  };
  const exportTimetableImage = async () => {
    if (!document || busy || grid.error || !timetableElement.current) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const pngBase64 = await renderTimetablePng(
        {
          title: `${semester?.academicYear}학년도 ${semester?.term}학기 · ${weeklyLabel.trim() || "새 시간표"}`,
          periods,
          entries: structuredClone(grid.entries),
          contexts: contexts.map(({ id, label }) => ({ id, label })),
        },
        timetableElement.current,
      );
      if (await host.exportTimetableImage({ pngBase64 }))
        setMessage("현재 화면의 시간표를 PNG 새 파일로 저장했어요. 학교 자료의 저장 상태는 바뀌지 않아요.");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "시간표 이미지를 저장하지 못했어요. 입력·이미지 크기를 확인해 주세요. 기존 파일과 학교 자료는 유지돼요.",
      );
    } finally {
      setBusy(false);
    }
  };
  const currentWeekday = ((new Date().getDay() + 6) % 7) + 1;
  const gridContextLabel = (context: (typeof contexts)[number]) => {
    const sameName = contexts.filter((other) => other.label === context.label);
    return sameName.length > 1
      ? `${context.label} · 같은 이름 ${sameName.findIndex((other) => other.id === context.id) + 1}${context.subject ? ` · ${context.subject}` : ""}${context.room ? ` · ${context.room}` : ""}`
      : context.label;
  };
  const semesterOptions =
    document?.semesters.map((v) => ({
      value: v.id,
      label: `${v.academicYear}학년도 ${v.term}학기${v.readOnly ? " · 읽기 전용" : ""}`,
    })) ?? [];
  const updateContext = (id: string) => {
    setContextId(id);
    const c = contexts.find((v) => v.id === id);
    setContextLabel(c?.label ?? "");
    setSubject(c?.subject ?? "");
    setRoom(c?.room ?? "");
    setMembers(
      c?.enrollmentIds
        .map((eid) => {
          const e = required(enrollments.find((v) => v.id === eid));
          return `${e.grade},${e.classNumber},${e.studentNumber}`;
        })
        .join("\n") ?? "",
    );
  };
  const rememberWeeklyDraft = () => {
    weeklyDrafts.current.set(JSON.stringify([semesterId, weeklyId]), {
      label: weeklyLabel,
      text: weeklyText,
      entries: weeklyEntries,
    });
    semesterWeeklySelections.current.set(semesterId, weeklyId);
  };
  const selectWeekly = (id: string, targetSemester = semesterId) => {
    const draft = weeklyDrafts.current.get(JSON.stringify([targetSemester, id]));
    const saved = document?.timetable.weeklyTables.find(
      (table) => table.id === id && table.semesterId === targetSemester,
    );
    setWeeklyId(id);
    setWeeklyLabel(draft?.label ?? saved?.label ?? "새 시간표");
    setWeeklyEntries(draft ? draft.entries : (saved?.entries ?? []));
    setWeeklyText(draft?.text ?? (document && saved ? formatWeekly(document, saved.entries) : ""));
  };
  const selectSemester = (id: string) => {
    rememberWeeklyDraft();
    setSemesterId(id);
    setContextId("");
    setDayId("");
    setGridContextId("");
    selectWeekly(semesterWeeklySelections.current.get(id) ?? "", id);
    setPage(0);
  };
  return (
    <div className={s.page}>
      <PageHeader
        title="우리 반·수업 자료"
        description="학급 명부와 수업·시간표를 한 번 정리하고, 허용한 도구에서 함께 사용해요. 모든 자료는 이 PC 안에 저장돼요."
      />
      {error && <InfoBar severity="error" title="처리 확인" message={error} />}
      {message && <InfoBar severity="success" title="저장 완료" message={message} onClose={() => setMessage("")} />}
      {workbookUndo && (
        <InfoBar
          message="최근 XLSX 가져오기를 되돌릴 수 있어요. 학교 자료를 다시 저장하거나 다시 불러오면 이 기능은 종료돼요."
          action={
            <Button disabled={busy} onClick={() => setConfirmWorkbookUndo(true)}>
              가져오기 되돌리기
            </Button>
          }
        />
      )}
      <div className={s.row}>
        {document?.semesters.length ? (
          <ComboBox
            header="현재 학기"
            value={semesterId}
            disabled={busy}
            options={semesterOptions}
            onChange={(value) => {
              if (!busy) selectSemester(value);
            }}
          />
        ) : null}
        <Button
          disabled={busy}
          onClick={() => {
            void refresh();
          }}
        >
          다시 불러오기
        </Button>
        <Button disabled={busy || !document} onClick={() => setConfirmBackup(true)}>
          명부·시간표 복구 JSON 저장
        </Button>
        {busy && <ProgressRing label="학교 자료 처리 중" />}
      </div>
      {!document && !busy && error && (
        <div className={s.card}>
          <Body>
            학교 자료만 사용할 수 없는 상태예요. 다른 도구는 계속 사용할 수 있어요. 저장 자료를 빈 값으로 바꾸지 않아요.
            TeacherDeck 학교 자료 JSON을 선택한 뒤 내용을 확인하고 복구할 수 있어요. TimeAlert 전체 백업 파일은 여기서
            가져오지 않아요.
          </Body>
          <Button
            onClick={() => {
              setBusy(true);
              void host
                .readBackup()
                .then(setRecovery)
                .catch(() => setError("TeacherDeck 학교 자료 JSON을 읽지 못했어요. 원본 자료는 유지돼요."))
                .finally(() => setBusy(false));
            }}
          >
            복구할 학교 자료 JSON 선택
          </Button>
        </div>
      )}

      {document && (
        <SchoolPortability
          host={host}
          document={document}
          semesterId={semesterId}
          busy={busy}
          onBusy={setBusy}
          onSaved={(saved) => {
            setWorkbookUndo(null);
            setConfirmWorkbookUndo(false);
            setDocument(saved);
            if (!saved.semesters.some((semester) => semester.id === semesterId))
              setSemesterId(saved.semesters.find((semester) => !semester.readOnly)?.id ?? saved.semesters[0]?.id ?? "");
          }}
        />
      )}

      <SettingsExpander
        header="새 학기·학기 보관"
        description={
          semester
            ? `${semester.startDate}~${semester.endDate}${semester.readOnly ? " · 읽기 전용" : ""}`
            : "먼저 학기를 추가해 주세요"
        }
        expanded={semesterSettings}
        onExpandedChange={setSemesterSettings}
      >
        <div className={s.card}>
          {semester && (
            <Body>
              {semester.readOnly
                ? "보관한 학기는 읽기 전용이에요. 새 학기에 이어 쓰려면 새 학기를 추가해 주세요."
                : "수정 가능한 학기예요. 학기를 보관하면 명부·수업·시간표가 읽기 전용으로 유지돼요."}
            </Body>
          )}
          <div className={s.row}>
            <NumberBox header="학년도" value={year} min={2000} max={2200} onChange={setYear} />
            <NumberBox header="학기" value={term} min={1} max={2} onChange={setTerm} />
            <TextBox header="학기 시작일" value={start} onChange={setStart} placeholder="2026-03-01" />
            <TextBox header="학기 종료일" value={end} onChange={setEnd} placeholder="2026-07-31" />
            <Button
              appearance="primary"
              disabled={busy || !document}
              onClick={() => {
                const id = newId();
                void save((d) => {
                  if (d.semesters.some((v) => v.academicYear === year && v.term === term))
                    throw new Error("같은 학년도·학기가 있어요. 현재 학기에서 선택해 주세요.");
                  d.semesters.push({
                    id,
                    academicYear: year,
                    term,
                    startDate: start,
                    endDate: end,
                    archived: false,
                    readOnly: false,
                  });
                }, "새 학기를 추가했어요.").then((saved) => {
                  if (saved) {
                    selectSemester(id);
                    setSemesterSettings(false);
                  }
                });
              }}
            >
              새 학기 추가
            </Button>
            <Button disabled={disabled} onClick={() => setArchive(true)}>
              현재 학기 보관
            </Button>
          </div>
        </div>
      </SettingsExpander>
      {semester && (
        <>
          <div className={s.row} aria-label="학교 자료 종류">
            {[
              { value: "roster", label: "학급 명부" },
              { value: "contexts", label: "수업·분반" },
              { value: "timetable", label: "일과표·시간표" },
              { value: "grants", label: "도구별 허용" },
            ].map((item) => (
              <Button
                key={item.value}
                appearance={tab === item.value ? "primary" : "secondary"}
                aria-pressed={tab === item.value}
                onClick={() => setTab(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {tab === "roster" && (
            <div className={s.card}>
              <BodyStrong>여러 학급 명부 한꺼번에 추가</BodyStrong>
              <Body>
                학년, 반, 번호, 이름 순서로 쉼표나 탭으로 나누어 붙여 주세요. 이름이 같아도 학번으로 구분해요. 같은
                학번·이름을 다시 넣으면 중복하지 않아요.
              </Body>
              <div className={s.row}>
                <Button
                  disabled={disabled}
                  onClick={() => {
                    void importWorkbook("roster");
                  }}
                >
                  XLSX 명부 가져오기
                </Button>
                <Button
                  disabled={busy || !document}
                  onClick={() => {
                    void exportWorkbook("roster", true);
                  }}
                >
                  학생 명부 XLSX 양식
                </Button>
                <Button
                  disabled={busy || !enrollments.length}
                  onClick={() => {
                    void exportWorkbook("roster");
                  }}
                >
                  현재 명부 XLSX 내보내기
                </Button>
              </div>
              <Caption>다음교시·나이스 명부의 표준 열을 읽어요. 사진 파일은 학생별로 따로 선택해요.</Caption>
              <TextBox
                header="학급 명부 입력"
                multiline
                value={roster}
                onChange={setRoster}
                placeholder={"학년,반,번호,이름\n1,1,1,가학생\n1,2,1,나학생"}
              />
              <Button
                appearance="primary"
                disabled={disabled || !roster.trim()}
                onClick={() => {
                  void save((d) => appendRoster(d, semesterId, roster), "명부를 추가했어요. 학급도 함께 만들었어요.");
                }}
              >
                명부 추가
              </Button>
              <div className={s.row}>
                <TextBox
                  header="학생 찾기"
                  value={query}
                  onChange={(v) => {
                    setQuery(v);
                    setPage(0);
                  }}
                  placeholder="이름 또는 학년-반-번호"
                />
                <Caption>
                  {enrollments.length}명 중 {filtered.length}명 · {safePage * 50 + (shown.length ? 1 : 0)}~
                  {safePage * 50 + shown.length} 표시
                </Caption>
                <Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                  이전 학생
                </Button>
                <Button disabled={(safePage + 1) * 50 >= filtered.length} onClick={() => setPage(safePage + 1)}>
                  다음 학생
                </Button>
              </div>
              {shown.map((e) => (
                <div key={e.id} className={s.member}>
                  <Body>
                    {e.grade}-{e.classNumber}-{e.studentNumber} · {studentMap.get(e.studentId)?.name} ·{" "}
                    {e.status === "active" ? "재학" : e.status === "transferred" ? "전출" : "숨김"}
                    {studentMap.get(e.studentId)?.photoId ? " · 사진 있음" : ""}
                  </Body>
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      setEditing(e.id);
                      setEditName(studentMap.get(e.studentId)?.name ?? "");
                      setEditStatus(e.status);
                    }}
                  >
                    학생 수정
                  </Button>
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      if (busy || !document) return;
                      setBusy(true);
                      setError("");
                      void host
                        .importPhoto({ studentId: e.studentId, expectedRevision: document.revision })
                        .then((d) => {
                          if (d.revision !== document.revision) setWorkbookUndo(null);
                          setDocument(d);
                          setMessage("선택한 학생의 사진을 저장했어요.");
                        })
                        .catch(() =>
                          setError("사진을 저장하지 못했어요. PNG·JPEG·WebP 사진과 자료 변경 여부를 확인해 주세요."),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    사진 선택
                  </Button>
                </div>
              ))}
            </div>
          )}
          {tab === "contexts" && (
            <div className={s.card}>
              <Body>
                학급 밖의 선택 수업도 학급 명부의 학번을 연결해 만들어요. 수업을 나눠도 학생 원본은 중복하지 않아요.
              </Body>
              <ComboBox
                header="수업 선택"
                value={contextId}
                options={[
                  { value: "", label: "새 수업·분반" },
                  ...contexts
                    .filter((c) => c.kind === "division")
                    .map((c) => ({ value: c.id, label: `${c.label} · ${c.enrollmentIds.length}명` })),
                ]}
                onChange={updateContext}
              />
              <div className={s.row}>
                <TextBox header="수업 이름" value={contextLabel} onChange={setContextLabel} />
                <TextBox header="과목" value={subject} onChange={setSubject} />
                <TextBox header="수업 장소" value={room} onChange={setRoom} />
              </div>
              <TextBox
                header="수업 학생 명단"
                multiline
                value={members}
                onChange={setMembers}
                placeholder={"학년,반,번호\n1,1,1\n1,2,1"}
              />
              <Caption>각 줄에 학년, 반, 번호를 넣어 주세요. 1~1,000명을 연결할 수 있어요.</Caption>
              <Button
                appearance="primary"
                disabled={disabled || !contextLabel.trim() || !members.trim()}
                onClick={() => {
                  void save((d) => {
                    const enrollmentIds = parseMembership(d, semesterId, members);
                    const current = d.contexts.find((c) => c.id === contextId);
                    const label = contextLabel.trim();
                    if (d.contexts.some((c) => c.semesterId === semesterId && c.label === label && c.id !== contextId))
                      throw new Error("시간표에서 구분할 수 있도록 다른 수업 이름을 써 주세요.");
                    if (current)
                      Object.assign(current, {
                        label,
                        subject: subject.trim() || null,
                        room: room.trim() || null,
                        enrollmentIds,
                      });
                    else
                      d.contexts.push({
                        id: newId(),
                        semesterId,
                        kind: "division",
                        label,
                        subject: subject.trim() || null,
                        room: room.trim() || null,
                        enrollmentIds,
                        weeklyTableId: null,
                      });
                  }, "수업 명단을 저장했어요.");
                }}
              >
                수업 명단 저장
              </Button>
              {contexts.map((c) => (
                <Body key={c.id}>
                  {c.kind === "homeroom" ? "학급" : "수업"} · {c.label} · {c.enrollmentIds.length}명
                  {c.subject ? ` · ${c.subject}` : ""}
                  {c.room ? ` · ${c.room}` : ""}
                </Body>
              ))}
            </div>
          )}
          {tab === "timetable" && (
            <>
              <div className={s.card}>
                <BodyStrong>일과표</BodyStrong>
                <Body>교시별 시각을 정해요. 주간 시간표와 별도로 관리해서 단축 수업일에도 적용할 수 있어요.</Body>
                <ComboBox
                  header="일과표 선택"
                  value={dayId}
                  options={[{ value: "", label: "새 일과표" }, ...days.map((v) => ({ value: v.id, label: v.label }))]}
                  onChange={(id) => {
                    setDayId(id);
                    const v = days.find((d) => d.id === id);
                    setDayLabel(v?.label ?? "새 일과");
                    setDayText(
                      v?.slots
                        .map((p) => `${p.period},${minuteText(p.startMinute)},${minuteText(p.endMinute)}`)
                        .join("\n") ?? "",
                    );
                  }}
                />
                <TextBox header="일과표 이름" value={dayLabel} onChange={setDayLabel} />
                <TextBox
                  header="교시별 시각"
                  multiline
                  value={dayText}
                  onChange={setDayText}
                  placeholder={"1,09:00,09:50\n2,10:00,10:50"}
                />
                <Button
                  disabled={disabled || !dayLabel.trim() || !dayText.trim()}
                  onClick={() => {
                    void save((d) => {
                      const slots = parseDaySlots(dayText),
                        current = d.timetable.dayTemplates.find((v) => v.id === dayId);
                      if (current) Object.assign(current, { label: dayLabel.trim(), slots });
                      else d.timetable.dayTemplates.push({ id: newId(), semesterId, label: dayLabel.trim(), slots });
                    }, "일과표를 저장했어요.");
                  }}
                >
                  일과표 저장
                </Button>
              </div>
              <div className={s.card}>
                <BodyStrong>주간 시간표</BodyStrong>
                <Body>수업을 고른 뒤 요일·교시 칸을 눌러 배치해요. 여러 칸에 같은 수업을 빠르게 넣을 수 있어요.</Body>
                <div className={s.row}>
                  <Button
                    disabled={disabled}
                    onClick={() => {
                      void importWorkbook("timetable");
                    }}
                  >
                    XLSX 시간표 가져오기
                  </Button>
                  <Button
                    disabled={busy || !document}
                    onClick={() => {
                      void exportWorkbook("timetable", true);
                    }}
                  >
                    시간표 XLSX 양식
                  </Button>
                  <Button
                    disabled={busy || !weeklyId}
                    onClick={() => {
                      void exportWorkbook("timetable");
                    }}
                  >
                    선택한 시간표 XLSX 내보내기
                  </Button>
                  <Button
                    disabled={busy || Boolean(grid.error)}
                    onClick={() => {
                      void exportTimetableImage();
                    }}
                  >
                    현재 화면 시간표 PNG 저장
                  </Button>
                </div>
                <Caption>
                  XLSX는 기본 주간표만 담아요. 일과 시각·날짜 변경·수업의 학생 연결·사진은 포함하지 않아요.
                </Caption>
                <Caption>
                  PNG는 지금 보이는 교시와 수업 배치를 담으며 미저장 수정도 포함해요. 일과 시각·날짜 변경·사진은 담지
                  않고, 학교 자료 저장을 대신하지 않아요.
                </Caption>
                <ComboBox
                  header="시간표 선택"
                  value={weeklyId}
                  disabled={busy}
                  options={[
                    { value: "", label: "새 시간표" },
                    ...weeklies.map((v) => ({ value: v.id, label: v.label })),
                  ]}
                  onChange={(id) => {
                    if (busy) return;
                    rememberWeeklyDraft();
                    selectWeekly(id);
                  }}
                />
                <TextBox header="시간표 이름" value={weeklyLabel} onChange={setWeeklyLabel} />
                <div className={s.row}>
                  <ComboBox
                    header="칸에 넣을 수업"
                    value={contexts.some((context) => context.id === gridContextId) ? gridContextId : ""}
                    disabled={disabled}
                    options={[
                      { value: "", label: "칸 비우기" },
                      ...contexts.map((context) => ({ value: context.id, label: gridContextLabel(context) })),
                    ]}
                    onChange={setGridContextId}
                  />
                  <NumberBox
                    header="표에 보일 교시"
                    value={gridPeriods}
                    min={1}
                    max={64}
                    disabled={disabled}
                    onChange={setGridPeriods}
                  />
                </div>
                <Caption>
                  학기·시간표를 바꾸면 미저장 편집을 이 화면에서 따로 유지해요. 배치를 확인한 뒤 시간표 저장을 눌러
                  주세요. 등록된 높은 교시는 항상 표시해요.
                </Caption>
                {!contexts.length && (
                  <InfoBar message="수업·분반에서 수업 이름을 먼저 만들어 주세요. XLSX 시간표를 가져와 수업을 추가할 수도 있어요." />
                )}
                {grid.error && (
                  <InfoBar severity="warning" message={`붙여넣은 주간 수업 입력을 먼저 고쳐 주세요. ${grid.error}`} />
                )}
                <div className={s.tableScroll}>
                  <table ref={timetableElement} className={s.weeklyTable} aria-label="주간 시간표 편집">
                    <thead>
                      <tr>
                        <th className={`${s.weeklyCell} ${s.imageHeader}`} scope="col">
                          교시
                        </th>
                        {WEEKDAYS.map((day, index) => (
                          <th
                            className={`${s.weeklyCell} ${s.imageHeader} ${index === 5 ? s.saturday : index === 6 ? s.sunday : ""} ${index + 1 === currentWeekday ? s.today : ""}`}
                            data-day-tone={index === 5 ? "blue" : index === 6 ? "red" : "neutral"}
                            scope="col"
                            key={day}
                          >
                            {day}
                            {index + 1 === currentWeekday ? " · 오늘" : ""}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({ length: periods }, (_, index) => index + 1).map((period) => (
                        <tr key={period}>
                          <th className={s.weeklyCell} scope="row">
                            {period}교시
                          </th>
                          {WEEKDAYS.map((day, index) => {
                            const entry = grid.entries.find(
                              (entry) => entry.weekday === index + 1 && entry.period === period,
                            );
                            const label = contexts.find((context) => context.id === entry?.contextId)?.label;
                            return (
                              <td className={s.weeklyCell} key={day}>
                                <Button
                                  className={s.cellButton}
                                  appearance={label ? "secondary" : "subtle"}
                                  disabled={disabled || Boolean(grid.error)}
                                  aria-label={`${day}요일 ${period}교시: ${label ?? "빈 칸"}`}
                                  onClick={() => {
                                    try {
                                      if (document) {
                                        const next = setWeeklyEntry(
                                          document,
                                          semesterId,
                                          grid.entries,
                                          index + 1,
                                          period,
                                          contexts.some((context) => context.id === gridContextId) ? gridContextId : "",
                                        );
                                        setWeeklyEntries(next);
                                        setWeeklyText(formatWeekly(document, next));
                                      }
                                    } catch (error) {
                                      setError(error instanceof Error ? error.message : "수업 배치를 확인해 주세요.");
                                    }
                                  }}
                                >
                                  {label ?? "+"}
                                </Button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <SettingsExpander
                  header="텍스트로 붙여넣기·수정"
                  description="요일, 교시, 수업 이름을 CSV나 탭 구분으로 넣어요"
                >
                  <TextBox
                    header="주간 수업 입력"
                    multiline
                    value={weeklyText}
                    onChange={(text) => {
                      setWeeklyText(text);
                      setWeeklyEntries(null);
                    }}
                    placeholder={`월,1,${contexts[0]?.label ?? "수업 이름"}\n화,2,${contexts[1]?.label ?? "수업 이름"}`}
                  />
                </SettingsExpander>
                <Button
                  disabled={disabled || !weeklyLabel.trim() || (!weeklyText.trim() && !weeklyId)}
                  onClick={() => {
                    const nextId = weeklyId || newId();
                    void save((d) => {
                      const entries =
                          weeklyEntries ?? (weeklyText.trim() ? parseWeekly(d, semesterId, weeklyText) : []),
                        current = d.timetable.weeklyTables.find((v) => v.id === nextId);
                      if (current) Object.assign(current, { label: weeklyLabel.trim(), entries });
                      else
                        d.timetable.weeklyTables.push({
                          id: nextId,
                          semesterId,
                          label: weeklyLabel.trim(),
                          startDate: null,
                          endDate: null,
                          entries,
                        });
                    }, "주간 시간표를 저장했어요.").then((saved) => {
                      if (saved) {
                        weeklyDrafts.current.delete(JSON.stringify([semesterId, weeklyId]));
                        weeklyDrafts.current.delete(JSON.stringify([semesterId, nextId]));
                        setWeeklyId(nextId);
                      }
                    });
                  }}
                >
                  시간표 저장
                </Button>
              </div>
              <SettingsExpander
                header="특정 날짜의 일과·요일 변경"
                description="행사일·단축 수업일의 일과표와 적용 요일을 따로 지정해요"
              >
                <div className={s.card}>
                  <TextBox
                    header="변경 날짜"
                    value={overrideDate}
                    onChange={setOverrideDate}
                    placeholder="2026-05-01"
                  />
                  <ComboBox
                    header="대신 적용할 요일"
                    value={overrideWeekday}
                    onChange={setOverrideWeekday}
                    options={[
                      { value: "", label: "원래 요일 유지" },
                      ...["월", "화", "수", "목", "금", "토", "일"].map((label, i) => ({
                        value: String(i + 1),
                        label,
                      })),
                    ]}
                  />
                  <ComboBox
                    header="이 날짜의 일과표"
                    value={overrideDay}
                    onChange={setOverrideDay}
                    options={[
                      { value: "", label: "기본 일과 유지" },
                      ...days.map((v) => ({ value: v.id, label: v.label })),
                    ]}
                  />
                  <ComboBox
                    header="이 날짜의 시간표"
                    value={overrideWeekly}
                    onChange={setOverrideWeekly}
                    options={[
                      { value: "", label: "기본 시간표 유지" },
                      ...weeklies.map((v) => ({ value: v.id, label: v.label })),
                    ]}
                  />
                  {overrideDay && (
                    <NumberBox
                      header="임시 일과 적용 시작 교시"
                      value={overrideFromPeriod}
                      min={1}
                      max={64}
                      onChange={setOverrideFromPeriod}
                    />
                  )}
                  <Button
                    disabled={disabled || !overrideDate || !(overrideWeekday || overrideDay || overrideWeekly)}
                    onClick={() => {
                      void save((d) => {
                        const v = newOverride(
                            semesterId,
                            overrideDate,
                            Number(overrideWeekday),
                            overrideDay,
                            overrideWeekly,
                            overrideDay ? overrideFromPeriod : undefined,
                          ),
                          previous = d.timetable.dayOverrides.findIndex(
                            (p) => p.semesterId === semesterId && p.date === overrideDate,
                          );
                        if (previous >= 0)
                          d.timetable.dayOverrides[previous] = {
                            ...v,
                            id: required(d.timetable.dayOverrides[previous]).id,
                          };
                        else d.timetable.dayOverrides.push(v);
                      }, "날짜별 일과를 저장했어요.");
                    }}
                  >
                    날짜 변경 저장
                  </Button>
                  {document?.timetable.dayOverrides
                    .filter((v) => v.semesterId === semesterId)
                    .map((v) => (
                      <div className={s.row} key={v.id}>
                        <Body>
                          {v.date} ·{" "}
                          {v.substituteWeekday
                            ? `${["월", "화", "수", "목", "금", "토", "일"][v.substituteWeekday - 1]}요일 적용`
                            : "원래 요일"}{" "}
                          · {days.find((d) => d.id === v.dayTemplateId)?.label ?? "기본 일과"} ·{" "}
                          {v.fromPeriod ? `${v.fromPeriod}교시부터 · ` : ""}
                          {weeklies.find((w) => w.id === v.weeklyTableId)?.label ?? "기본 시간표"}
                        </Body>
                        <Button
                          disabled={disabled}
                          onClick={() => {
                            void save((d) => {
                              d.timetable.dayOverrides = d.timetable.dayOverrides.filter((p) => p.id !== v.id);
                            }, "날짜 변경을 해제했어요.");
                          }}
                        >
                          변경 해제
                        </Button>
                      </div>
                    ))}
                </div>
              </SettingsExpander>
              <SettingsExpander
                header="수업 이동·취소·추가"
                description="주간 시간표는 보존하고 해당 날짜 수업만 변경해요"
              >
                <div className={s.card}>
                  <TextBox
                    header="수업 변경 날짜"
                    value={changeDate}
                    onChange={setChangeDate}
                    placeholder="2026-05-01"
                  />
                  <ComboBox
                    header="변경할 수업"
                    value={changeContext}
                    onChange={setChangeContext}
                    options={contexts.map((c) => ({ value: c.id, label: c.label }))}
                  />
                  <ComboBox
                    header="변경 종류"
                    value={changeKind}
                    onChange={(v) => setChangeKind(v as SchoolDateChangeKind)}
                    options={[
                      { value: "MOVE", label: "이동" },
                      { value: "CANCEL", label: "취소" },
                      { value: "ADD", label: "추가" },
                    ]}
                  />
                  <div className={s.row}>
                    {changeKind === "MOVE" && (
                      <TextBox
                        header="이동할 날짜 · 비우면 같은 날짜"
                        value={changeTargetDate}
                        onChange={setChangeTargetDate}
                        placeholder="2026-05-02"
                      />
                    )}
                    {changeKind !== "ADD" && (
                      <NumberBox header="원래 교시" value={fromPeriod} min={1} max={64} onChange={setFromPeriod} />
                    )}
                    {changeKind !== "CANCEL" && (
                      <NumberBox header="변경·추가 교시" value={toPeriod} min={1} max={64} onChange={setToPeriod} />
                    )}
                  </div>
                  <Button
                    disabled={disabled || !changeDate || !changeContext}
                    onClick={() => {
                      void save((d) => {
                        d.timetable.dateChanges.push(
                          newChange(
                            semesterId,
                            changeDate,
                            changeContext,
                            changeKind,
                            fromPeriod,
                            toPeriod,
                            changeTargetDate,
                          ),
                        );
                      }, "해당 날짜의 수업 변경을 저장했어요.");
                    }}
                  >
                    수업 변경 저장
                  </Button>
                  {document?.timetable.dateChanges
                    .filter((v) => v.semesterId === semesterId)
                    .map((v) => (
                      <div key={v.id} className={s.row}>
                        <Body>
                          {v.date} · {contexts.find((c) => c.id === v.contextId)?.label} ·{" "}
                          {v.kind === "MOVE"
                            ? `${v.fromPeriod}→${v.targetDate ? `${v.targetDate} ` : ""}${v.toPeriod}교시 이동`
                            : v.kind === "CANCEL"
                              ? `${v.fromPeriod}교시 취소`
                              : `${v.toPeriod}교시 추가`}
                        </Body>
                        <Button
                          disabled={disabled}
                          onClick={() => {
                            void save((d) => {
                              d.timetable.dateChanges = d.timetable.dateChanges.filter((p) => p.id !== v.id);
                            }, "수업 변경을 해제했어요.");
                          }}
                        >
                          수업 변경 해제
                        </Button>
                      </div>
                    ))}
                </div>
              </SettingsExpander>
            </>
          )}
          {tab === "grants" && (
            <div className={s.card}>
              <Body>
                허용한 자료는 해당 도구에서만 읽을 수 있어요. 철회하면 새 읽기와 사진 접근이 차단돼요. 이미 도구에
                적용한 작업 명단·완료 기록은 도구에서 별도로 관리해요.
              </Body>
              {grants.length === 0 && (
                <Body>아직 허용한 도구가 없어요. 교실 도구에서 ‘학교 공통명부 사용’을 눌러 주세요.</Body>
              )}
              {grants.map((g) => (
                <div key={g.grant.grantHandle} className={s.row}>
                  <Body>
                    {g.moduleId} · {g.grant.contexts.map((c) => c.label).join(", ")} ·{" "}
                    {g.grant.scopes
                      .map((v) => (v === "roster-basic" ? "명부" : v === "photos" ? "사진" : "시간표"))
                      .join(", ")}
                    {g.grant.persistent ? " · 다음 실행에도 허용" : " · 이번 실행만"}
                  </Body>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void host
                        .revokeGrant(g.moduleId, g.grant.grantHandle)
                        .then(() => host.grants())
                        .then(setGrants)
                        .catch(() => setError("허용을 철회하지 못했어요. 다시 시도해 주세요."))
                        .finally(() => setBusy(false));
                    }}
                  >
                    이 도구 허용 철회
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <ContentDialog
        open={archive}
        title="현재 학기를 읽기 전용으로 보관할까요?"
        primaryButtonText="학기 보관"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setArchive(false);
          if (result === "primary")
            void save((d) => {
              const v = required(d.semesters.find((p) => p.id === semesterId));
              v.archived = true;
              v.readOnly = true;
            }, "학기를 읽기 전용으로 보관했어요.");
        }}
      >
        <Body>
          이 학기의 명부·수업·시간표와 학생 원본은 이후 수정할 수 없어요. 다음 학기 자료는 새 학기로 추가해 주세요.
        </Body>
      </ContentDialog>
      <ContentDialog
        open={!!editing}
        title="학생 정보 수정"
        primaryButtonText="학생 정보 저장"
        closeButtonText="취소"
        onClose={(result) => {
          const id = editing;
          setEditing("");
          if (result === "primary")
            void save((d) => {
              const e = required(d.enrollments.find((v) => v.id === id));
              required(d.students.find((v) => v.id === e.studentId)).name = editName.trim();
              e.status = editStatus as "active" | "transferred" | "hidden";
            }, "학생 정보를 수정했어요.");
        }}
      >
        <TextBox header="학생 이름" value={editName} onChange={setEditName} />
        <ComboBox
          header="재학 상태"
          value={editStatus}
          onChange={setEditStatus}
          options={[
            { value: "active", label: "재학" },
            { value: "transferred", label: "전출" },
            { value: "hidden", label: "숨김" },
          ]}
        />
      </ContentDialog>
      {recovery && (
        <ContentDialog
          open
          title="선택한 학교 자료로 복구할까요?"
          primaryButtonText="자료 확인 후 복구"
          closeButtonText="취소"
          defaultButton="close"
          onClose={(result) => {
            const next = recovery;
            setRecovery(null);
            if (result !== "primary" || !next) return;
            setBusy(true);
            void host
              .recover({ expectedRevision: 0, document: next })
              .then((d) => {
                setWorkbookUndo(null);
                setDocument(d);
                setSemesterId(d.semesters.find((v) => !v.readOnly)?.id ?? d.semesters[0]?.id ?? "");
                setGrants([]);
                setError("");
                setMessage("손상본을 별도 보존한 뒤 학교 자료를 복구했어요. 도구별 허용은 다시 선택해 주세요.");
              })
              .catch(() =>
                setError(
                  "자료를 복구하지 못했어요. 손상본과 기존 자료는 보존돼요. 사진 파일이 포함된 자료는 사진 원본도 확인해 주세요.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <Body>
            {recovery?.semesters.length ?? 0}개 학기, {recovery?.students.length ?? 0}명,{" "}
            {recovery?.contexts.length ?? 0}개 학급·수업을 복구해요. 현재 손상본은 별도 파일로 보존해요. 이전 도구
            허용은 해제돼요. 사진은 JSON에 포함되지 않아 별도 확인이 필요해요.
          </Body>
        </ContentDialog>
      )}
      <ContentDialog
        open={workbookPreviewOpen && workbookPreview !== null}
        title={workbookPreview?.kind === "roster" ? "XLSX 학생 명부 확인" : "XLSX 주간 시간표 확인"}
        primaryButtonText="확인한 자료 적용"
        closeButtonText="취소"
        onClose={(result) => {
          if (!workbookPreviewOpen) return;
          const preview = workbookPreview;
          // Keep the last payload through Fluent's exit motion. Clearing it here changes
          // a roster preview into the timetable fallback while the surface is still visible.
          setWorkbookPreviewOpen(false);
          if (result !== "primary" || !preview) return;
          if (preview.kind === "roster") {
            setRoster(preview.text);
            void save(
              (d) => appendRoster(d, semesterId, preview.text),
              "XLSX 명부를 추가했어요. 학급도 함께 만들었어요.",
              "roster",
            );
          } else if (preview.lessons)
            void save(
              (d) => applyWorkbookTimetable(d, semesterId, weeklyLabel || "가져온 시간표", required(preview.lessons)),
              "XLSX 주간 시간표를 추가했어요. 새 수업의 학생 명단은 수업·분반에서 확인해 주세요.",
              "timetable",
            );
        }}
      >
        <Body>
          {workbookPreview?.count ?? 0}
          {workbookPreview?.kind === "roster" ? "명의 학생" : "개의 수업"}을 읽었어요. 처음 20줄을 표시해요. 적용 전에
          원본과 학번·이름·요일·교시를 비교해 주세요.
        </Body>
        {workbookPreview?.warnings.map((warning, i) => (
          <InfoBar key={i} severity="warning" title="가져오기 확인" message={warning} />
        ))}
        <TextBox
          header="가져온 자료 미리보기"
          multiline
          readOnly
          value={workbookPreview?.text.split("\n").slice(0, 20).join("\n") ?? ""}
          onChange={() => {}}
        />
      </ContentDialog>
      <ContentDialog
        open={confirmBackup}
        title="명부·시간표 복구 JSON을 저장할까요?"
        primaryButtonText="복구 JSON 저장"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setConfirmBackup(false);
          if (result === "primary") void exportBackup();
        }}
      >
        <Body>
          호스트에 저장된 모든 학기의 명부·수업 연결·일과 시각·주간표·날짜 변경을 담아요. 사진 파일과 화면의 미저장
          수정은 포함하지 않아요. 같은 PC의 명부·시간표 복구용이며 사진을 포함한 이동용 전체 백업이 아니에요. 기존
          파일은 그대로 두고 새 이름으로 저장해요.
        </Body>
      </ContentDialog>
      <ContentDialog
        open={confirmWorkbookUndo && workbookUndo !== null}
        title="최근 XLSX 가져오기를 되돌릴까요?"
        primaryButtonText="가져오기 되돌리기"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setConfirmWorkbookUndo(false);
          if (result === "primary") void undoWorkbook();
        }}
      >
        <Body>
          최근 XLSX 가져오기를 취소하고, 가져오기 직전 학교 자료로 되돌려요. 그 뒤 다른 화면에서 저장한 변경이 있으면
          되돌리지 않아요.
        </Body>
      </ContentDialog>
    </div>
  );
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("자료에 필요한 항목을 찾지 못했어요.");
  return value;
}
