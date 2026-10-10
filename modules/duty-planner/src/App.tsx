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
import { calendar, counts, parseRoster, type PlanInput, type PlanResult } from "./planner.ts";
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
  const input = { ...state.input, holidays: HOLIDAYS };
  const days = calendar(input);
  const teacher = state.input.teachers.find((t) => t.id === teacherId);
  const currentDay = days.find((d) => String(d.day) === selectedDay);
  const projected = counts(input, { ...input.manual, ...state.assignments });
  useEffect(() => {
    let active = true;
    loadState(deck)
      .then((saved) => {
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
    worker.postMessage(input);
  }
  function applyManual(selection = manualSelection) {
    if (!currentDay || currentDay.excluded) {
      setMessage("제외된 날짜에는 배정할 수 없어요. 날짜 제외 조건을 먼저 조정해 주세요.");
      return;
    }
    if (selection.filter(Boolean).length !== input.perDay || new Set(selection).size !== input.perDay) {
      setMessage("하루 인원에 맞게 서로 다른 교사를 선택해 주세요.");
      return;
    }
    const fixed = input.teachers.filter((t) => t.fixed.includes(currentDay.day));
    if (
      fixed.some((t) => !selection.includes(t.id)) ||
      selection.some((id) => {
        const t = input.teachers.find((item) => item.id === id);
        return !t || t.excluded.includes(currentDay.day) || t.weekdays.includes(currentDay.weekday);
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
        <Button appearance="primary" disabled={busy || !input.teachers.length} onClick={generate}>
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
          disabled={busy}
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
        <Button onClick={addTeacher} disabled={busy || !newName.trim()}>
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
            disabled={busy}
            onChange={(on) =>
              updateInput({
                excluded: on
                  ? [...input.excluded, Number(selectedDay)]
                  : input.excluded.filter((day) => day !== Number(selectedDay)),
              })
            }
          />
          {currentDay?.excluded ? (
            <Body>{currentDay.reason}로 제외된 날짜예요.</Body>
          ) : (
            <>
              {Array.from({ length: input.perDay }, (_, i) => (
                <ComboBox
                  key={i}
                  header={`${i + 1}번째 교사`}
                  options={teacherOptions}
                  value={manualSelection[i] ?? ""}
                  disabled={busy}
                  onChange={(id) => {
                    const selection = Array.from({ length: input.perDay }, (_, n) =>
                      n === i ? id : (manualSelection[n] ?? ""),
                    );
                    setManualSelection(selection);
                    if (selection.every(Boolean)) applyManual(selection);
                  }}
                />
              ))}
              <Caption secondary>담당자를 바꾸면 바로 반영돼요. 다시 배정해도 직접 고른 담당자는 유지돼요.</Caption>
              <Button disabled={busy || !input.manual[selectedDay]} onClick={clearManual}>
                직접 배정 해제
              </Button>
            </>
          )}
          <BodyStrong>선택한 교사 조건</BodyStrong>
          <ComboBox
            header="조건을 바꿀 교사"
            options={teacherOptions}
            value={teacherId}
            disabled={busy}
            onChange={setTeacherId}
          />
          {teacher && (
            <>
              <CheckBox
                content={`${selectedDay}일에 ${teacher.name} 고정`}
                checked={teacher.fixed.includes(Number(selectedDay))}
                disabled={busy}
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
                disabled={busy}
                onChange={(on) =>
                  editTeacher({
                    excluded: on
                      ? [...teacher.excluded, Number(selectedDay)]
                      : teacher.excluded.filter((day) => day !== Number(selectedDay)),
                  })
                }
              />
              <NumberBox
                header="과거 실제 수행 횟수"
                value={teacher.past}
                min={0}
                max={100000}
                disabled={busy}
                onChange={(past) => editTeacher({ past })}
              />
              <Caption secondary>배정하지 않는 요일</Caption>
              <div className={s.row}>
                {WEEKDAYS.map((label, i) => (
                  <CheckBox
                    key={label}
                    content={`${label}요일 제외`}
                    checked={teacher.weekdays.includes(i)}
                    disabled={busy}
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
              disabled={busy}
              onClick={() => setTeacherId(t.id)}
            >
              {t.name} · 과거 {t.past} + 이번 {projected[t.id] ?? 0} = {t.past + (projected[t.id] ?? 0)}회
            </Button>
          ))}
        </div>
        <SettingsExpander header="여러 명 붙여넣기" description="이름을 한 줄씩 입력하거나 엑셀 명단을 붙여넣어요.">
          <TextBox
            header="교사 명단"
            multiline
            value={roster}
            disabled={busy}
            onChange={setRoster}
            placeholder={"교사A\n교사B"}
            description="이름만 넣어도 돼요. 과거 횟수가 있으면 이름 옆 열에 함께 붙여넣어요."
          />
          <Button onClick={applyRoster} disabled={busy}>
            명단 적용
          </Button>
        </SettingsExpander>
      </section>
      <Caption secondary>
        {input.year === HOLIDAY_YEAR
          ? "2026년 법정 공휴일은 자동 제외해요. 임시공휴일·학교 휴업일은 달력에서 추가해 주세요."
          : "공휴일 자동 제외는 2026년만 지원해요. 이 연도 공휴일은 달력에서 직접 제외해 주세요."}
      </Caption>
      <Caption secondary>
        다시 배정해도 실제 수행 횟수는 늘지 않아요. 월을 바꾸면 유지된 고정·제외 조건을 확인해 주세요. 명단은 이
        모듈에만 저장돼요.
      </Caption>
    </main>
  );
}
