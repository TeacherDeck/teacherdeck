// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Start here. UI only from @deck/ui, icons from @fluentui/react-icons (MOD-010); batch file tools use ToolLayout (MOD-011);
// host features only through `deck` (MOD-006). See modules/timer for a complete example.
import type { Deck } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ContentDialog,
  InfoBar,
  ListView,
  NumberBox,
  PageHeader,
  PresentationControls,
  ProgressRing,
  RadioButtons,
  SettingsExpander,
  Subtitle,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import {
  applySetup,
  conditionErrors,
  confirm,
  emptyState,
  generate,
  groupCount,
  moveStudent,
  parsePairs,
  parseRoster,
  participants,
  setStudentCondition,
  toggleGroupLock,
  type GroupState,
} from "./logic.ts";
import { loadState, readBackup, saveState, writeBackup } from "./state.ts";
import { SchoolRoster } from "./SchoolRoster.tsx";
import { StudentPage } from "./StudentPage.tsx";
import { presentationPayload } from "./presentation.ts";
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.sectionGap,
    padding: deckTokens.pagePadding,
    minWidth: 0,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: deckTokens.inlineGap },
  workspace: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
    gap: deckTokens.sectionGap,
    "@media (max-width: 760px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  groups: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
    gap: deckTokens.itemGap,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalL,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    minWidth: 0,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    paddingBlock: tokens.spacingVerticalXS,
    minWidth: 0,
    flexGrow: 1,
  },
  wrap: { overflowWrap: "anywhere", whiteSpace: "normal" },
});

export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [state, setState] = useState<GroupState>(emptyState),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [roster, setRoster] = useState(""),
    [label, setLabel] = useState("이번 활동"),
    [mode, setMode] = useState<"count" | "size">("size"),
    [value, setValue] = useState(4),
    [pairs, setPairs] = useState(""),
    [publicView, setPublicView] = useState(false),
    [newTask, setNewTask] = useState(false),
    [replacement, setReplacement] = useState<GroupState | null>(null),
    [swapA, setSwapA] = useState(""),
    [swapB, setSwapB] = useState("");
  const working = useRef(false),
    disabled = busy || blocked || !loaded,
    count = groupCount(state),
    issues = state.students.length ? conditionErrors(state) : [];
  function refreshForm(next: GroupState) {
    setRoster(next.students.map((s) => `${s.number}\t${s.name}`).join("\n"));
    setLabel(next.label);
    setMode(next.mode);
    setValue(next.value);
    setPairs(
      next.pairs
        .map(
          ([a, b]) =>
            `${next.students.find((s) => s.id === a)?.number ?? ""}\t${next.students.find((s) => s.id === b)?.number ?? ""}`,
        )
        .join("\n"),
    );
    setSwapA("");
    setSwapB("");
  }
  useEffect(() => {
    let active = true;
    loadState(deck)
      .then((saved) => {
        if (active) {
          setState(saved);
          refreshForm(saved);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError(
            "저장 자료를 불러오지 못했어요. 기존 기록을 보호하려고 변경을 잠갔어요. 기록 파일을 가져오거나 새 작업을 확인해 복구해 주세요.",
          );
          setBlocked(true);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [deck]);
  async function change(operation: () => GroupState, success: string, recovery = false) {
    if (working.current || busy || !loaded || (blocked && !recovery)) return false;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let next: GroupState;
    try {
      next = operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "입력을 확인해 주세요.");
      working.current = false;
      setBusy(false);
      return false;
    }
    try {
      await saveState(deck, next, { recover: recovery });
      setState(next);
      setBlocked(false);
      setMessage(success);
      return true;
    } catch {
      setError("변경 내용을 저장하지 못했어요. 이전 기록을 유지했어요. 다시 시도해 주세요.");
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function files(importing: boolean) {
    if (working.current || busy || !loaded || (blocked && !importing)) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (importing) {
        const next = await readBackup(deck);
        if (next) setReplacement(next);
      } else if (await writeBackup(deck, state)) setMessage("새 결과 폴더에 기록 파일을 저장했어요.");
    } catch {
      setError(
        importing
          ? "기록 파일을 읽지 못했어요. 이 도구에서 저장한 JSON 파일을 선택해 주세요."
          : "파일을 저장하지 못했어요. 다른 폴더를 선택해 주세요.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function switchView(show: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await deck.window.setFullscreen(show);
      setPublicView(show);
    } catch {
      setError("화면을 바꾸지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  const setup = (
    <SettingsExpander
      key={state.students.length ? "registered" : "empty"}
      header="이번 작업 명단과 편성 조건"
      description="번호·이름을 붙여넣고 모둠 수 또는 한 모둠 인원을 정해요."
      defaultExpanded={!state.students.length}
    >
      <TextBox header="활동 이름" value={label} onChange={setLabel} disabled={disabled} />
      <TextBox
        header="학생 명단"
        description="번호·이름 두 열을 붙여넣거나 한 줄에 번호와 이름을 적어요."
        value={roster}
        onChange={setRoster}
        multiline
        rows={4}
        disabled={disabled}
      />
      <div className={s.row}>
        <RadioButtons
          header="모둠 편성 기준"
          options={[
            { value: "count", label: "모둠 수" },
            { value: "size", label: "한 모둠 인원" },
          ]}
          value={mode}
          onChange={setMode}
          disabled={disabled}
        />
        <NumberBox
          header={mode === "count" ? "모둠 수" : "한 모둠 목표 인원"}
          value={value}
          onChange={setValue}
          min={1}
          max={1000}
          disabled={disabled}
        />
      </div>
      <Caption secondary>
        고정한 학생·모둠을 먼저 지키고 남은 인원을 고르게 나눠요. 고정한 모둠은 목표 인원보다 커도 유지해요.
      </Caption>
      <SettingsExpander header="학생 분리 조건" description="같은 모둠에 넣지 않을 두 학생 번호를 한 줄에 적어요.">
        <TextBox header="분리할 번호 쌍" value={pairs} onChange={setPairs} multiline rows={3} disabled={disabled} />
      </SettingsExpander>
      <div className={s.row}>
        <Button
          appearance="primary"
          disabled={disabled || !roster.trim()}
          onClick={() => {
            void change(
              () => {
                const students = parseRoster(roster, state.students);
                return applySetup(state, students, label, parsePairs(pairs, students), mode, value);
              },
              state.students.length
                ? "명단·편성 조건을 적용했어요. 확정 이력은 보존하고 다시 편성해 주세요."
                : "명단·편성 조건을 적용했어요. 바로 모둠을 만들어 주세요.",
            );
          }}
        >
          명단·편성 조건 적용
        </Button>
        <Button disabled={disabled} onClick={() => refreshForm(state)}>
          편집 취소
        </Button>
      </div>
    </SettingsExpander>
  );
  const groupOptions = Array.from({ length: Math.max(0, Math.min(count, 1000)) }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1}모둠`,
    })),
    studentOptions = [
      { value: "", label: "학생 선택" },
      ...participants(state).map((s) => ({ value: s.id, label: `${s.number}번 ${s.name}` })),
    ];
  const publicResult = (
    <>
      <Subtitle className={s.wrap}>{state.label}</Subtitle>
      <div className={s.groups}>
        {state.groups.map((group) => (
          <section className={s.card} key={group.id}>
            <Subtitle>{group.id}모둠</Subtitle>
            {group.members.map((id) => {
              const student = state.students.find((s) => s.id === id);
              return (
                <Subtitle className={s.wrap} key={id}>
                  {student?.number}번 {student?.name}
                </Subtitle>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
  if (publicView)
    return (
      <div className={s.page}>
        <PresentationControls
          key="presentation"
          deck={deck}
          payload={presentationPayload(state)}
          hidden={publicView}
          disabled={disabled}
        />
        {publicResult}
        <div className={s.row}>
          <Button
            disabled={busy}
            onClick={() => {
              void switchView(false);
            }}
          >
            교사용 화면
          </Button>
        </div>
        {error && <InfoBar severity="error" message={error} />}
      </div>
    );
  return (
    <div className={s.page}>
      <PageHeader
        title="모둠 만들기"
        description="학생·모둠 고정과 제외·분리를 먼저 지키고, 남은 인원을 고르게 나눠요."
      />
      <PresentationControls
        key="presentation"
        deck={deck}
        payload={presentationPayload(state)}
        hidden={publicView}
        disabled={disabled}
      />
      <SchoolRoster
        deck={deck}
        disabled={disabled}
        hasRoster={state.students.length > 0}
        previous={state.students}
        onApply={async (snapshot, students) => {
          const next = applySetup(
            state,
            students,
            snapshot.context.label,
            state.pairs.filter(([a, b]) => students.some((s) => s.id === a) && students.some((s) => s.id === b)),
            state.mode,
            state.value,
          );
          const saved = await change(() => next, "공통 명부를 불러왔어요. 기존 확정 기록은 유지해요.");
          if (saved) {
            refreshForm(next);
          }
          return saved;
        }}
      />
      {!loaded && <ProgressRing label="저장한 기록을 불러오는 중" />}
      {error && <InfoBar severity="error" message={error} />}{" "}
      {message && <InfoBar severity="success" message={message} />} {!state.students.length && setup}
      {state.students.length > 0 && (
        <>
          <div className={s.row}>
            <Button
              appearance="primary"
              disabled={disabled}
              onClick={() => {
                void change(
                  () => generate(state),
                  "모둠을 편성했어요. 직접 이동·교환한 뒤 편성 확정으로 기록해 주세요.",
                );
              }}
            >
              {state.groups.length ? "다시 편성" : "모둠 만들기"}
            </Button>
            <Button
              disabled={disabled || !state.groups.length}
              onClick={() => {
                void change(
                  () => confirm(state, crypto.randomUUID(), new Date().toISOString()),
                  "편성을 확정해 당시 명단과 모둠을 기록했어요.",
                );
              }}
            >
              편성 확정
            </Button>
            <Button
              disabled={disabled || !state.groups.length}
              onClick={() => {
                void switchView(true);
              }}
            >
              학생에게 보여주기
            </Button>
          </div>
          <Caption>
            참여 {participants(state).length}명 · {count}모둠 · 고정 조건을 먼저 지키고 나머지 인원을 고르게 나눠요.
          </Caption>
          {issues.length > 0 && <InfoBar severity="warning" message={issues.join(" ")} />}
          <div className={s.workspace}>
            <section className={s.card} aria-label="모둠 편성 결과">
              <BodyStrong>모둠 편성 결과</BodyStrong>
              {!state.groups.length && <Body>고정·제외 조건을 확인하고 모둠 만들기를 눌러 주세요.</Body>}
              <div className={s.groups}>
                {state.groups.map((group) => (
                  <section key={group.id} className={s.card} aria-label={`${group.id}모둠`}>
                    <BodyStrong>
                      {group.id}모둠 · {group.members.length}명
                    </BodyStrong>
                    <CheckBox
                      content={`${group.id}모둠 전체 고정`}
                      checked={Boolean(state.locked[String(group.id)])}
                      disabled={disabled}
                      onChange={() => {
                        void change(() => toggleGroupLock(state, group.id), "모둠 고정 조건을 바꿨어요.");
                      }}
                    />
                    {group.members.map((id) => {
                      const student = state.students.find((s) => s.id === id);
                      return (
                        <div key={id} className={s.item}>
                          <Body>
                            {student?.number}번 {student?.name}
                          </Body>
                          <ComboBox
                            header={`${student?.number}번 이동할 모둠`}
                            value={String(group.id)}
                            options={groupOptions}
                            disabled={disabled}
                            onChange={(target) => {
                              void change(
                                () => moveStudent(state, id, Number(target)),
                                "학생을 이동했어요. 고정·분리 조건을 유지했어요.",
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>
              {state.groups.length > 0 && (
                <div className={s.row}>
                  <ComboBox
                    header="교환할 첫 학생"
                    options={studentOptions}
                    value={swapA}
                    onChange={setSwapA}
                    disabled={disabled}
                  />
                  <ComboBox
                    header="교환할 둘째 학생"
                    options={studentOptions}
                    value={swapB}
                    onChange={setSwapB}
                    disabled={disabled}
                  />
                  <Button
                    disabled={disabled || !swapA || !swapB || swapA === swapB}
                    onClick={() => {
                      const target = state.groups.find((g) => g.members.includes(swapB));
                      if (target)
                        void change(
                          () => moveStudent(state, swapA, target.id, swapB),
                          "두 학생의 모둠을 교환했어요. 고정·분리 조건을 유지했어요.",
                        );
                    }}
                  >
                    두 학생 교환
                  </Button>
                </div>
              )}
              <Caption secondary>학생 보기는 화면 복제에 사용하며 고정·제외·분리 조건은 표시하지 않아요.</Caption>
            </section>
            <section className={s.card} aria-label="학생 고정·제외 조건">
              <BodyStrong>학생 고정·제외 조건</BodyStrong>
              <StudentPage students={state.students}>
                {(visible) => (
                  <ListView
                    header="학생 조건"
                    items={visible}
                    getKey={(s) => s.id}
                    renderItem={(student) => (
                      <div className={s.item}>
                        <BodyStrong>
                          {student.number}번 {student.name}
                        </BodyStrong>
                        <CheckBox
                          content={`${student.number}번 이번 제외`}
                          checked={state.excluded.includes(student.id)}
                          disabled={disabled}
                          onChange={(excluded) => {
                            void change(
                              () => setStudentCondition(state, student.id, excluded, state.fixed[student.id] ?? 0),
                              "제외 조건을 바꿨어요. 다시 편성해 주세요.",
                            );
                          }}
                        />
                        {state.students.length > 100 ? (
                          <NumberBox
                            header={`${student.number}번 고정 모둠`}
                            description="0은 고정 안 함이에요."
                            value={state.fixed[student.id] ?? 0}
                            min={0}
                            max={Math.max(count, state.fixed[student.id] ?? 0)}
                            disabled={disabled}
                            onChange={(group) =>
                              void change(
                                () =>
                                  setStudentCondition(state, student.id, state.excluded.includes(student.id), group),
                                "학생 고정 조건을 바꿨어요. 다시 편성해 주세요.",
                              )
                            }
                          />
                        ) : (
                          <ComboBox
                            header={`${student.number}번 고정 모둠`}
                            value={String(state.fixed[student.id] ?? 0)}
                            options={[
                              { value: "0", label: "고정 안 함" },
                              ...groupOptions,
                              ...Object.values(state.fixed)
                                .filter((g) => g > count)
                                .filter((g, i, list) => list.indexOf(g) === i)
                                .map((g) => ({ value: String(g), label: `${g}모둠 · 설정 밖` })),
                            ]}
                            disabled={disabled}
                            onChange={(group) => {
                              void change(
                                () =>
                                  setStudentCondition(
                                    state,
                                    student.id,
                                    state.excluded.includes(student.id),
                                    Number(group),
                                  ),
                                "학생 고정 조건을 바꿨어요. 다시 편성해 주세요.",
                              );
                            }}
                          />
                        )}
                      </div>
                    )}
                  />
                )}
              </StudentPage>
              {Object.keys(state.locked).length > 0 && (
                <div className={s.row}>
                  {Object.keys(state.locked).map((group) => (
                    <Button
                      key={group}
                      disabled={disabled}
                      onClick={() => {
                        void change(
                          () => toggleGroupLock(state, Number(group)),
                          "모둠 고정을 풀었어요. 다시 편성해 주세요.",
                        );
                      }}
                    >
                      {group}모둠 고정 해제
                    </Button>
                  ))}
                </div>
              )}
            </section>
          </div>
          {setup}
        </>
      )}
      <SettingsExpander
        key={blocked ? "recovery" : "records"}
        header="확정 이력과 파일"
        description="당시 명단·모둠을 보존해요. 미리보기·다시 편성으로 이력을 늘리지 않아요."
        defaultExpanded={blocked}
      >
        <div className={s.row}>
          <Button
            disabled={disabled}
            onClick={() => {
              void files(false);
            }}
          >
            기록 파일 저장
          </Button>
          <Button
            disabled={busy || !loaded}
            onClick={() => {
              void files(true);
            }}
          >
            기록 파일 가져오기
          </Button>
          <Button disabled={busy || !loaded} onClick={() => setNewTask(true)}>
            새 작업
          </Button>
        </div>
        <ListView
          header="편성 확정 이력"
          items={[...state.history].reverse()}
          getKey={(h) => h.id}
          emptyText="편성 확정을 누르면 당시 모둠이 여기에 기록돼요."
          renderItem={(h) => (
            <div className={s.item}>
              <BodyStrong>
                {h.label} · {new Date(h.at).toLocaleString("ko-KR")}
              </BodyStrong>
              {h.groups.map((g) => (
                <Body key={g.id}>
                  {g.id}모둠:{" "}
                  {g.members
                    .map((id) => {
                      const student = h.students.find((s) => s.id === id);
                      return `${student?.number}번 ${student?.name}`;
                    })
                    .join(" · ")}
                </Body>
              ))}
            </div>
          )}
        />
      </SettingsExpander>
      {newTask && (
        <ContentDialog
          open
          title="새 작업을 시작할까요?"
          primaryButtonText="새 작업"
          closeButtonText="취소"
          defaultButton="close"
          onClose={(result) => {
            setNewTask(false);
            if (result === "primary") {
              const next = emptyState();
              void change(() => next, "새 작업을 시작했어요.", true).then((saved) => {
                if (saved) refreshForm(next);
              });
            }
          }}
        >
          <Body>현재 명단·조건·확정 이력을 새 작업으로 바꿔요. 필요한 기록은 먼저 파일로 저장해 주세요.</Body>
        </ContentDialog>
      )}
      {replacement !== null && (
        <ContentDialog
          open
          title="가져온 기록으로 바꿀까요?"
          primaryButtonText="가져오기"
          closeButtonText="취소"
          defaultButton="close"
          onClose={(result) => {
            const next = replacement;
            setReplacement(null);
            if (result === "primary" && next)
              void change(() => next, "기록 파일을 가져왔어요.", true).then((saved) => {
                if (saved) refreshForm(next);
              });
          }}
        >
          <Body>현재 작업을 가져온 명단·조건·확정 이력으로 바꿔요. 필요한 현재 기록은 먼저 파일로 저장해 주세요.</Body>
        </ContentDialog>
      )}
    </div>
  );
}
