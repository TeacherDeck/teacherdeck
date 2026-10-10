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
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { calendar, counts, parseDays, parseRoster, type PlanInput, type PlanResult } from "./planner.ts";
import { HOLIDAYS, HOLIDAY_YEAR } from "./holidays.ts";
import { initialState, loadState, saveState, type PlannerState } from "./state.ts";
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
  calendar: { display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: tokens.spacingHorizontalXS },
  dayButton: { minWidth: 0, width: "100%", paddingInline: tokens.spacingHorizontalXS },
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalXS,
    minWidth: 0,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    overflowWrap: "anywhere",
  },
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [state, setState] = useState<PlannerState>(initialState);
  const [roster, setRoster] = useState("");
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [teacherId, setTeacherId] = useState("");
  const [selectedDay, setSelectedDay] = useState("1");
  const [fixedText, setFixedText] = useState("");
  const [excludedText, setExcludedText] = useState("");
  const [past, setPast] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [manualSelection, setManualSelection] = useState<string[]>([]);
  const [globalExcluded, setGlobalExcluded] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const input = { ...state.input, holidays: HOLIDAYS };
  const days = calendar(input);
  const teacher = state.input.teachers.find((t) => t.id === teacherId);
  const currentDay = days.find((d) => String(d.day) === selectedDay);
  const projected = counts(input, state.assignments);
  useEffect(() => {
    let active = true;
    loadState(deck)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          setState(saved);
          setRoster(saved.input.teachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
          setGlobalExcluded(saved.input.excluded.join(", "));
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
    setFixedText(teacher?.fixed.join(", ") ?? "");
    setExcludedText(teacher?.excluded.join(", ") ?? "");
    setPast(teacher?.past ?? 0);
    setWeekdays(teacher?.weekdays ?? []);
  }, [teacher]);
  useEffect(() => {
    setManualSelection(state.assignments[selectedDay] ?? state.input.manual[selectedDay] ?? []);
  }, [selectedDay, state.assignments, state.input.manual]);
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
  function applyTeacher() {
    const fixed = parseDays(fixedText);
    const excluded = parseDays(excludedText);
    if (!fixed || !excluded || !Number.isInteger(past)) {
      setMessage("날짜는 1~31일을 쉼표로 구분하고 과거 횟수는 정수로 입력해 주세요.");
      return;
    }
    const nextTeachers = input.teachers.map((t) =>
      t.id === teacherId ? { ...t, fixed, excluded, weekdays, past } : t,
    );
    updateInput({ teachers: nextTeachers });
    setRoster(nextTeachers.map((t) => `${t.name}\t${t.past}`).join("\n"));
    setMessage("교사 조건을 적용했어요. 조건이 겹치면 배정할 때 원인을 알려 드려요.");
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
    worker.postMessage(input);
  }
  function applyManual() {
    if (!currentDay || currentDay.excluded) {
      setMessage("제외된 날짜에는 배정할 수 없어요. 날짜 제외 조건을 먼저 조정해 주세요.");
      return;
    }
    if (manualSelection.filter(Boolean).length !== input.perDay || new Set(manualSelection).size !== input.perDay) {
      setMessage("하루 인원에 맞게 서로 다른 교사를 선택해 주세요.");
      return;
    }
    const fixed = input.teachers.filter((t) => t.fixed.includes(currentDay.day));
    if (
      fixed.some((t) => !manualSelection.includes(t.id)) ||
      manualSelection.some((id) => {
        const t = input.teachers.find((item) => item.id === id);
        return !t || t.excluded.includes(currentDay.day) || t.weekdays.includes(currentDay.weekday);
      })
    ) {
      setMessage("고정·교사 제외 조건과 직접 배정이 겹쳐요. 교사 조건을 먼저 조정해 주세요.");
      return;
    }
    setState((prev) => ({
      ...prev,
      input: { ...prev.input, manual: { ...prev.input.manual, [selectedDay]: manualSelection } },
      assignments: { ...prev.assignments, [selectedDay]: manualSelection },
    }));
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
        description="교사 조건을 먼저 지키고, 과거 횟수를 포함한 총횟수를 균등하게 배정해요."
      />
      {message && <InfoBar message={message} onClose={() => setMessage("")} />}
      {issues.map((issue, index) => (
        <InfoBar key={`${index}-${issue}`} severity="error" message={issue} />
      ))}
      <InfoBar
        severity={input.year === HOLIDAY_YEAR ? "informational" : "warning"}
        message={
          input.year === HOLIDAY_YEAR
            ? "2026년 법정 공휴일과 대체공휴일을 자동 제외해요. 임시공휴일·학교 휴업일은 직접 추가해 주세요."
            : "공휴일 자동 제외는 2026년만 지원해요. 이 연도의 공휴일·학교 휴업일은 월 전체 제외 날짜에 입력해 주세요."
        }
      />
      <section className={s.card} aria-label="월과 명단">
        <div className={s.row}>
          <NumberBox
            header="연도"
            min={1900}
            max={2100}
            value={input.year}
            disabled={busy}
            onChange={(year) => updateInput({ year })}
          />
          <NumberBox
            header="월"
            min={1}
            max={12}
            value={input.month}
            disabled={busy}
            onChange={(month) => updateInput({ month })}
          />
          <NumberBox
            header="하루 인원"
            min={1}
            max={3}
            value={input.perDay}
            disabled={busy}
            onChange={(perDay) => updateInput({ perDay })}
          />
          <CheckBox
            content="주말 제외"
            checked={input.weekends}
            disabled={busy}
            onChange={(weekends) => updateInput({ weekends })}
          />
        </div>
        <Caption secondary>
          월을 바꿔도 일 번호로 입력한 고정·제외·직접 배정은 유지돼요. 새 달의 조건을 확인해 주세요.
        </Caption>
        <TextBox
          header="교사 명단"
          multiline
          value={roster}
          disabled={busy}
          onChange={setRoster}
          placeholder={"교사A\t0\n교사B\t3"}
          description="한 줄에 이름을 입력해 주세요. 과거 횟수는 이름 뒤 탭 또는 쉼표로 구분해요."
        />
        <div className={s.row}>
          <Button onClick={applyRoster} disabled={busy}>
            명단 적용
          </Button>
          <TextBox
            header="월 전체 제외 날짜"
            value={globalExcluded}
            disabled={busy}
            onChange={setGlobalExcluded}
            placeholder="1, 5, 20"
          />
          <Button
            disabled={busy}
            onClick={() => {
              const excluded = parseDays(globalExcluded);
              if (!excluded) setMessage("제외 날짜는 1~31일을 쉼표로 구분해 주세요.");
              else updateInput({ excluded });
            }}
          >
            제외 날짜 적용
          </Button>
        </div>
      </section>
      <section className={s.card} aria-label="교사별 조건">
        <BodyStrong>교사별 조건</BodyStrong>
        <ComboBox
          header="조건을 바꿀 교사"
          options={teacherOptions}
          value={teacherId}
          disabled={busy}
          onChange={setTeacherId}
        />
        {teacher && (
          <>
            <div className={s.row}>
              <NumberBox
                header="과거 실제 수행 횟수"
                value={past}
                min={0}
                max={100000}
                disabled={busy}
                onChange={setPast}
              />
              <TextBox
                header="고정 날짜"
                value={fixedText}
                disabled={busy}
                onChange={setFixedText}
                placeholder="3, 10"
              />
              <TextBox
                header="제외 날짜"
                value={excludedText}
                disabled={busy}
                onChange={setExcludedText}
                placeholder="5, 12"
              />
            </div>
            <div className={s.row}>
              {WEEKDAYS.map((label, i) => (
                <CheckBox
                  key={label}
                  content={`${label}요일 제외`}
                  checked={weekdays.includes(i)}
                  disabled={busy}
                  onChange={(on) => setWeekdays(on ? [...weekdays, i] : weekdays.filter((n) => n !== i))}
                />
              ))}
            </div>
            <Button disabled={busy} onClick={applyTeacher}>
              교사 조건 적용
            </Button>
          </>
        )}
      </section>
      <div className={s.row}>
        <Button appearance="primary" disabled={busy || input.teachers.length === 0} onClick={generate}>
          배정
        </Button>
        <Button
          disabled={busy || storageBlocked}
          onClick={() =>
            void saveState(deck, state)
              .then(() => setMessage("이 PC에 명단·조건·배정표를 저장했어요."))
              .catch((error: unknown) =>
                setMessage(
                  error instanceof Error && error.message === "STORAGE_SIZE_LIMIT"
                    ? "저장 용량을 넘었어요. 명단이나 조건을 줄인 뒤 다시 저장해 주세요."
                    : "저장하지 못했어요. 다시 저장해 주세요.",
                ),
              )
          }
        >
          저장
        </Button>
        {busy && <ProgressRing label="조건에 맞게 배정해요" />}
      </div>
      <Caption secondary>
        미리보기와 다시 배정은 실제 수행 횟수를 올리지 않아요. 과거 실제 수행 횟수는 직접 입력해요. 입력을 바꾼 뒤에는
        각 적용 버튼을 눌러 주세요.
      </Caption>
      <section className={s.card} aria-label="월별 배정 달력">
        <BodyStrong>
          {input.year}년 {input.month}월
        </BodyStrong>
        <div className={s.calendar}>
          {WEEKDAYS.map((day) => (
            <BodyStrong key={day}>{day}</BodyStrong>
          ))}
          {Array.from({ length: days[0]?.weekday ?? 0 }, (_, i) => (
            <div key={`blank-${i}`} aria-hidden="true" />
          ))}
          {days.map((d) => (
            <div key={d.day} className={s.cell}>
              <Button
                className={s.dayButton}
                appearance={selectedDay === String(d.day) ? "primary" : "subtle"}
                disabled={busy}
                aria-label={`${d.day}일 배정 편집`}
                onClick={() => setSelectedDay(String(d.day))}
              >
                {d.day}
              </Button>
              {d.excluded ? (
                <Caption secondary>{d.reason}</Caption>
              ) : (
                <>
                  <Caption>
                    {(state.assignments[String(d.day)] ?? [])
                      .map((id) => input.teachers.find((t) => t.id === id)?.name ?? "")
                      .join(" · ") || "미배정"}
                  </Caption>
                  {input.manual[String(d.day)] && <Caption secondary>직접 배정</Caption>}
                  {input.teachers.some((t) => t.fixed.includes(d.day)) && <Caption secondary>고정 조건</Caption>}
                </>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className={s.card} aria-label="날짜별 직접 배정">
        <BodyStrong>{selectedDay}일 직접 배정·교체</BodyStrong>
        {currentDay?.excluded ? (
          <Body>제외된 날짜예요. 제외 조건을 먼저 조정해 주세요.</Body>
        ) : (
          <>
            <div className={s.row}>
              {Array.from({ length: input.perDay }, (_, i) => (
                <ComboBox
                  key={i}
                  header={`${i + 1}번째 교사`}
                  disabled={busy}
                  options={teacherOptions}
                  value={manualSelection[i] ?? ""}
                  onChange={(id) =>
                    setManualSelection((prev) =>
                      Array.from({ length: input.perDay }, (_, n) => (n === i ? id : (prev[n] ?? ""))),
                    )
                  }
                />
              ))}
            </div>
            <div className={s.row}>
              <Button disabled={busy} onClick={applyManual}>
                직접 배정 적용
              </Button>
              <Button disabled={busy || !input.manual[selectedDay]} onClick={clearManual}>
                직접 배정 해제
              </Button>
            </div>
          </>
        )}
      </section>
      <section className={s.card} aria-label="교사별 배정 횟수">
        <BodyStrong>배정 횟수 미리보기</BodyStrong>
        <div className={s.row}>
          {input.teachers.map((t) => (
            <Body key={t.id}>
              {t.name}: 과거 {t.past} + 이번 배정 {projected[t.id] ?? 0} = 총 {t.past + (projected[t.id] ?? 0)}
            </Body>
          ))}
        </div>
      </section>
      <Caption secondary>명단은 이 모듈에만 저장돼요. 공통 명부 연결과 파일 내보내기는 후속 기능이에요.</Caption>
    </main>
  );
}
