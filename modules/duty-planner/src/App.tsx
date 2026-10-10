// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  InfoBar,
  NumberBox,
  PageHeader,
  ProgressRing,
  TextBox,
  SettingsExpander,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
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
import { HOLIDAYS, HOLIDAY_YEAR } from "./holidays.ts";
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
  saveMonth,
  selectCurrent,
  switchMonth,
  writeExport,
  type Months,
} from "./history.ts";
import { parseTimetable } from "./timetable.ts";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
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
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    overflowWrap: "anywhere",
  },
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [state, setState] = useState<PlannerState>(initialState);
  const [months, setMonths] = useState<Months>({});
  const [backupText, setBackupText] = useState("");
  const [timetableText, setTimetableText] = useState("");
  const [roster, setRoster] = useState("");
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [teacherId, setTeacherId] = useState("");
  const [selectedDay, setSelectedDay] = useState("1");
  const [manualSelection, setManualSelection] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const nameInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const composingName = useRef(false);
  const workerRef = useRef<Worker | null>(null);
  const cumulative = cumulativeInput(state, months);
  const input = { ...state.input, holidays: HOLIDAYS };
  const daySlots = slotsForDay(input, Number(selectedDay));
  const days = calendar(input);
  const teacher = state.input.teachers.find((t) => t.id === teacherId);
  const currentDay = days.find((d) => String(d.day) === selectedDay);
  const projected = counts(input, { ...input.manual, ...state.assignments });
  useEffect(() => {
    let active = true;
    Promise.all([loadState(deck), loadMonths(deck)])
      .then(([latestState, storedMonths]) => {
        const saved = selectCurrent(latestState, storedMonths);
        setMonths(storedMonths);
        if (!active) return;
        if (saved) {
          setState(saved);
          setRoster(saved.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          setMessage(
            "저장한 내용을 불러오지 못했어요. 기존 저장값을 보호하려고 저장을 잠갔어요. 도구를 다시 열어 주세요.",
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
    setManualSelection(state.assignments[selectedDay] ?? state.input.manual[selectedDay] ?? []);
  }, [selectedDay, state.assignments, state.input.manual]);
  function changeMonth(year: number, month: number) {
    const drafts = { ...months, [monthKey(state)]: state };
    setMonths(drafts);
    const next = switchMonth(state, drafts, year, month);
    setState(next);
    setRoster(next.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
    setIssues([]);
  }
  async function persist(next = state) {
    for (const draft of Object.values({ ...months, [monthKey(next)]: next })) await saveMonth(deck, draft);
    await saveMonth(deck, next);
    setMonths((prev) => ({ ...prev, [monthKey(next)]: next }));
  }
  async function exportFile(name: string, text: string) {
    try {
      if (await writeExport(deck, name, text)) setMessage("새 결과 폴더에 저장했어요.");
    } catch {
      setMessage("파일을 저장하지 못했어요. 다시 저장해 주세요.");
    }
  }
  function updateInput(patch: Partial<PlanInput>) {
    setState((prev) => ({ ...prev, input: { ...prev.input, ...patch }, assignments: {} }));
    setIssues([]);
  }
  function applyRoster() {
    const next = parseRoster(roster, input.teachers);
    if (!next) {
      setMessage("명단은 이름과 과거 횟수를 한 줄씩 입력해 주세요. 중복 이름 없이 최대 500명이에요.");
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
      setState((prev) => ({ ...prev, assignments: event.data.assignments }));
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
    worker.postMessage({ ...cumulativeInput(state, months), holidays: HOLIDAYS });
  }
  function applyManual(selection = manualSelection) {
    if (!currentDay || currentDay.excluded) {
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
    setState((prev) => ({
      ...prev,
      input: { ...prev.input, manual: { ...prev.input.manual, [selectedDay]: selection } },
      assignments: { ...prev.assignments, [selectedDay]: selection },
    }));
    setManualSelection(selection);
    setIssues([]);
    setMessage("직접 배정을 적용했어요. 다시 배정해도 이 날짜는 유지돼요.");
  }
  function clearManual() {
    const manual = Object.fromEntries(Object.entries(input.manual).filter(([day]) => day !== selectedDay));
    updateInput({ manual });
    setMessage("이 날짜의 직접 배정을 해제했어요. 교사 고정 조건은 유지돼요.");
  }
  if (!loaded) return <ProgressRing label="저장한 내용을 불러와요" />;
  const teacherOptions = [
    { value: "", label: "교사를 선택해 주세요" },
    ...input.teachers.map((t) => ({ value: t.id, label: t.name })),
  ];
  return (
    <main className={s.page}>
      <PageHeader
        title="지도일배정기"
        description="달력에서 제외일과 담당 교사를 고르고, 남은 날짜를 균등하게 배정해요."
      />
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
      </div>
      {message && <InfoBar message={message} onClose={() => setMessage("")} />}
      {issues.map((issue, index) => (
        <InfoBar key={`${index}-${issue}`} severity="error" message={issue} />
      ))}
      {!input.teachers.length && <InfoBar message="아래에서 교사 이름을 추가한 뒤 배정을 눌러 주세요." />}
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
      <div className={s.workspace}>
        <section className={s.card} aria-label="월별 배정 달력">
          <BodyStrong>
            {input.year}년 {input.month}월
          </BodyStrong>
          <Caption secondary>날짜를 누르면 담당 교사를 바꾸거나 지도 없는 날로 지정할 수 있어요.</Caption>
          <div className={s.calendar}>
            {WEEKDAYS.map((day) => (
              <BodyStrong key={day}>{day}</BodyStrong>
            ))}
            {Array.from({ length: days[0]?.weekday ?? 0 }, (_, i) => (
              <div key={`blank-${i}`} aria-hidden="true" />
            ))}
            {days.map((d) => (
              <Button
                key={d.day}
                className={s.cell}
                appearance={selectedDay === String(d.day) ? "primary" : "subtle"}
                disabled={busy}
                aria-label={`${d.day}일 배정 편집`}
                onClick={() => setSelectedDay(String(d.day))}
              >
                <BodyStrong>{d.day}</BodyStrong>
                {d.excluded ? (
                  <Caption>{d.reason}</Caption>
                ) : (
                  <>
                    <Caption>
                      {(state.assignments[String(d.day)] ?? input.manual[String(d.day)] ?? [])
                        .map((id) => input.teachers.find((t) => t.id === id)?.name ?? "")
                        .join(" · ") || "미배정"}
                    </Caption>
                    {input.manual[String(d.day)] && <Caption>직접 배정</Caption>}
                    {input.teachers.some((t) => t.fixed.includes(d.day)) && <Caption>고정 조건</Caption>}
                  </>
                )}
              </Button>
            ))}
          </div>
        </section>
        <section className={s.card} aria-label="날짜별 직접 배정">
          <BodyStrong>
            {selectedDay}일 {currentDay ? WEEKDAYS[currentDay.weekday] : ""}요일
          </BodyStrong>
          <CheckBox
            content="이 날짜는 지도하지 않아요"
            checked={input.excluded.includes(Number(selectedDay))}
            disabled={busy || !!state.closed}
            onChange={(on) =>
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
            disabled={busy || !!state.closed}
            onChange={(on) =>
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
            disabled={busy || !!state.closed}
            onChange={(value) =>
              setState((prev) => ({ ...prev, memo: { ...prev.memo, [selectedDay]: value.slice(0, 2000) } }))
            }
          />
          <BodyStrong>실제 수행 기록</BodyStrong>
          <Button
            disabled={busy || !!state.closed}
            onClick={() => {
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
          <Button
            disabled={busy || !!state.closed}
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
          {Array.from({ length: daySlots }, (_, i) => (
            <ComboBox
              key={`actual-${i}`}
              header={`${i + 1}번째 실제 수행자`}
              value={state.actual?.[selectedDay]?.[i] ?? ""}
              options={teacherOptions}
              disabled={busy || !!state.closed}
              onChange={(id) => {
                const next = Array.from({ length: daySlots }, (_, n) =>
                  n === i ? id : (state.actual?.[selectedDay]?.[n] ?? ""),
                );
                if (id && next.filter((x) => x === id).length > 1) {
                  setMessage("실제 수행자는 서로 다르게 선택해 주세요.");
                  return;
                }
                setState((prev) => ({ ...prev, actual: { ...prev.actual, [selectedDay]: next.filter(Boolean) } }));
              }}
            />
          ))}
          <Caption secondary>배정만으로 횟수가 늘지 않아요. 실제 수행자를 기록하고 월을 마감해요.</Caption>
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
                  disabled={busy || !!state.closed}
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
          <BodyStrong>선택한 교사 조건</BodyStrong>
          <ComboBox
            header="조건을 바꿀 교사"
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
              <CheckBox
                content={`${selectedDay}일에 ${teacher.name} 고정`}
                checked={teacher.fixed.includes(Number(selectedDay))}
                disabled={busy || !!state.closed}
                onChange={(on) =>
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
                disabled={busy || !!state.closed}
                onChange={(on) =>
                  editTeacher({
                    excluded: on
                      ? [...teacher.excluded, Number(selectedDay)]
                      : teacher.excluded.filter((day) => day !== Number(selectedDay)),
                  })
                }
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
        </section>
      </div>
      <section className={s.card} aria-label="교사 명단과 배정 횟수">
        <BodyStrong>교사 명단 · {input.teachers.length}명</BodyStrong>
        <div className={s.row}>
          {input.teachers.map((t) => (
            <Button
              key={t.id}
              appearance={teacherId === t.id ? "primary" : "subtle"}
              disabled={busy || !!state.closed}
              onClick={() => setTeacherId(t.id)}
            >
              {t.name} · 과거 {t.past} · 누적 {cumulative.teachers.find((x) => x.id === t.id)?.past ?? t.past} + 이번{" "}
              {projected[t.id] ?? 0}회
            </Button>
          ))}
        </div>
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
      </section>
      <SettingsExpander header="월 마감 · 백업 · 내보내기">
        <div className={s.row}>
          <Button
            disabled={busy || storageBlocked || !!state.closed}
            onClick={() => {
              const next = closeMonth(state);
              void persist(next)
                .then(() => {
                  setState(next);
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
          <Button onClick={() => void exportFile("legacy.json", exportLegacy({ ...months, [monthKey(state)]: state }))}>
            기존 형식 JSON 저장
          </Button>
          <Button
            onClick={() =>
              void readBackup(deck)
                .then((text) => {
                  if (text !== null) setBackupText(text);
                })
                .catch(() => setMessage("백업을 읽지 못했어요. 5MiB 이하 UTF-8 JSON 파일을 선택해 주세요."))
            }
          >
            백업 파일 열기
          </Button>
        </div>
        {state.closed && (
          <InfoBar message="마감한 달이에요. 수행 기록을 수정하려면 마감 수정 열기를 누르고 수정 후 다시 저장·마감해 주세요." />
        )}
        <SettingsExpander header="JSON 백업 복원">
          <TextBox header="복원할 JSON" multiline value={backupText} onChange={setBackupText} />
          <Caption>복원은 화면의 작업 상태를 바꿔요. 확인 후 저장을 누르면 복원한 모든 달이 이 PC에 저장돼요.</Caption>
          <Button
            disabled={storageBlocked}
            onClick={() => {
              const restored = decodeBackup(backupText);
              if (!restored) {
                setMessage("TeacherDeck 백업 구조를 확인해 주세요.");
                return;
              }
              const first = Object.values(restored)[0];
              if (!first) return;
              setMonths(restored);
              setState(first);
              setRoster(first.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
              setMessage("백업을 화면에 복원했어요. 내용을 확인하고 저장해 주세요.");
            }}
          >
            복원 적용
          </Button>
        </SettingsExpander>
      </SettingsExpander>
      <Caption secondary>
        {input.year === HOLIDAY_YEAR
          ? "2026년 법정 공휴일은 자동 제외해요. 임시공휴일·학교 휴업일은 달력에서 추가해 주세요."
          : "공휴일 자동 제외는 2026년만 지원해요. 이 연도 공휴일은 달력에서 직접 제외해 주세요."}
      </Caption>
      <Caption secondary>
        다시 배정해도 실제 수행 횟수는 늘지 않아요. 월별 조건과 수행 기록을 따로 보관해요. 명단은 이 모듈에만 저장돼요.
      </Caption>
    </main>
  );
}
