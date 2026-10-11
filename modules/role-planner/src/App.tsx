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
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  Subtitle,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applySetup,
  changePerformer,
  complete,
  conditions,
  emptyState,
  nextCycle,
  parseJobs,
  parseRoster,
  setCondition,
  totalCounts,
  undoCompletion,
  type RoleState,
} from "./logic.ts";
import { loadState, readBackup, saveState, writeBackup } from "./state.ts";
import { SchoolRoster } from "./SchoolRoster.tsx";
import { StudentPage } from "./StudentPage.tsx";
import { generateInWorker } from "./planner-client.ts";
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.sectionGap,
    padding: deckTokens.pagePadding,
    minWidth: 0,
  },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  workspace: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
    gap: deckTokens.sectionGap,
    "@media (max-width: 760px)": { gridTemplateColumns: "minmax(0, 1fr)" },
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
    paddingBlock: tokens.spacingVerticalS,
    minWidth: 0,
    flexGrow: 1,
  },
  publicGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
    gap: deckTokens.sectionGap,
  },
  wrap: { overflowWrap: "anywhere", whiteSpace: "normal" },
});

export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [state, setState] = useState<RoleState>(emptyState),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [roster, setRoster] = useState(""),
    [jobsText, setJobsText] = useState("진행\t1\n기록\t1\n자료\t1"),
    [label, setLabel] = useState("이번 배정"),
    [publicView, setPublicView] = useState(false),
    [replacement, setReplacement] = useState<RoleState | null>(null),
    [newTask, setNewTask] = useState(false);
  const counts = useMemo(() => totalCounts(state), [state]);
  const [generating, setGenerating] = useState(false);
  const [replaceFrom, setReplaceFrom] = useState(""),
    [replaceTo, setReplaceTo] = useState("");
  const planner = useRef<AbortController | null>(null);
  useEffect(() => () => planner.current?.abort(), []);
  const working = useRef(false);
  const disabled = busy || blocked || !loaded,
    performed = state.events.some((e) => e.cycle === state.cycle);
  const issues = state.students.length ? conditions(state) : [];
  function refreshForm(next: RoleState) {
    setRoster(next.students.map((s) => `${s.number}\t${s.name}\t${s.baseCount}`).join("\n"));
    setJobsText(next.jobs.map((j) => `${j.title}\t${j.capacity}`).join("\n"));
    setLabel(next.label);
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
  async function change(operation: () => RoleState | Promise<RoleState>, success: string, recovery = false) {
    if (working.current || busy || !loaded || (blocked && !recovery)) return false;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let next: RoleState;
    try {
      next = await operation();
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError")
        setMessage("배정을 취소했어요. 이전 배정은 유지했어요.");
      else setError(failure instanceof Error ? failure.message : "입력을 확인해 주세요.");
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
      header="이번 작업 명단과 역할"
      description="공통 등록 없이 명단과 역할별 필요인원을 적어 사용해요."
      defaultExpanded={!state.students.length}
    >
      <TextBox header="배정 이름" value={label} onChange={setLabel} disabled={disabled} />
      <TextBox
        header="학생 명단"
        description="번호·이름·기존횟수를 엑셀에서 붙여넣거나, 한 줄에 번호와 이름을 적어요."
        value={roster}
        onChange={setRoster}
        multiline
        rows={5}
        disabled={disabled}
      />
      <TextBox
        header="역할과 필요인원"
        description="한 줄에 역할 이름과 필요한 인원을 적어요. 예: 자료 2. 참여 학생 수 안에서 필요한 인원만 배정해요."
        value={jobsText}
        onChange={setJobsText}
        multiline
        rows={4}
        disabled={disabled}
      />
      <div className={s.row}>
        <Button
          appearance="primary"
          disabled={disabled || !roster.trim() || !jobsText.trim()}
          onClick={() => {
            void change(
              () => applySetup(state, parseRoster(roster, state.students), parseJobs(jobsText, state.jobs), label),
              state.students.length
                ? "명단·역할을 적용했어요. 이전 수행 기록은 보존하고 새 배정을 시작했어요."
                : "명단·역할을 적용했어요. 바로 역할을 배정해 주세요.",
            );
          }}
        >
          명단·역할 적용
        </Button>
        <Button disabled={disabled} onClick={() => refreshForm(state)}>
          편집 취소
        </Button>
      </div>
    </SettingsExpander>
  );
  const publicResult = (
    <>
      <Subtitle className={s.wrap}>{state.label}</Subtitle>
      <div className={s.publicGrid}>
        {state.jobs.map((job) => (
          <section className={s.card} key={job.id}>
            <Subtitle className={s.wrap}>{job.title}</Subtitle>
            {state.draft
              .filter((a) => a.jobId === job.id)
              .map((a) => {
                const student = state.students.find((s) => s.id === a.studentId);
                return (
                  <Subtitle className={s.wrap} key={a.studentId}>
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
        title="역할·당번 나누기"
        description="고정·제외 조건을 먼저 지키고, 필요한 인원만 총 수행횟수가 낮은 대상부터 배정해요."
      />
      <SchoolRoster
        deck={deck}
        disabled={disabled}
        hasRoster={state.students.length > 0}
        previous={state.students}
        onApply={async (snapshot, students) => {
          const next = applySetup(state, students, state.jobs, snapshot.context.label);
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
              disabled={disabled || performed}
              onClick={() => {
                void change(async () => {
                  const controller = new AbortController();
                  planner.current = controller;
                  setGenerating(true);
                  try {
                    return await generateInWorker(state, crypto.randomUUID(), controller.signal);
                  } finally {
                    planner.current = null;
                    setGenerating(false);
                  }
                }, "역할을 배정했어요. 실제로 수행한 학생만 완료로 기록해 주세요.");
              }}
            >
              {state.draft.length ? "다시 배정" : "역할 배정"}
            </Button>
            {generating && <Button onClick={() => planner.current?.abort()}>배정 취소</Button>}
            <Button
              disabled={disabled}
              onClick={() => {
                void change(() => nextCycle(state), "새 배정을 시작했어요. 총횟수·고정·제외 조건은 유지했어요.");
              }}
            >
              새 배정
            </Button>
            <Button
              disabled={disabled || !state.events.length}
              onClick={() => {
                void change(() => undoCompletion(state), "마지막 수행 완료를 되돌렸어요.");
              }}
            >
              마지막 완료 되돌리기
            </Button>
            <Button
              disabled={disabled || !state.draft.length}
              onClick={() => {
                void switchView(true);
              }}
            >
              학생에게 보여주기
            </Button>
          </div>
          <Caption>
            {state.cycle}번째 배정 · 필요인원 {state.jobs.reduce((sum, j) => sum + j.capacity, 0)}명 / 참여{" "}
            {state.students.filter((s) => !state.excluded.includes(s.id)).length}명
          </Caption>
          {performed && (
            <InfoBar message="이번 배정에 수행 기록이 있어요. 조건·담당자를 바꾸려면 완료를 되돌리거나 새 배정으로 넘어가 주세요." />
          )}
          {issues.length > 0 && <InfoBar severity="warning" message={issues.join(" ")} />}
          <div className={s.workspace}>
            <section className={s.card} aria-label="역할별 배정">
              <BodyStrong>역할별 배정</BodyStrong>
              {state.students.length > 100 && state.draft.length > 0 && (
                <div className={s.row}>
                  <ComboBox
                    header="바꿀 담당자"
                    value={replaceFrom}
                    disabled={disabled || performed}
                    options={[
                      { value: "", label: "배정된 학생 선택" },
                      ...state.draft.map((a) => {
                        const student = state.students.find((s) => s.id === a.studentId),
                          job = state.jobs.find((j) => j.id === a.jobId);
                        return { value: a.studentId, label: `${student?.number}번 ${student?.name} · ${job?.title}` };
                      }),
                    ]}
                    onChange={setReplaceFrom}
                  />
                  <ComboBox
                    header="새 담당자"
                    value={replaceTo}
                    disabled={disabled || performed}
                    options={[
                      { value: "", label: "학생 선택" },
                      ...state.students
                        .filter((s) => !state.excluded.includes(s.id))
                        .map((s) => ({ value: s.id, label: `${s.number}번 ${s.name}` })),
                    ]}
                    onChange={setReplaceTo}
                  />
                  <Button
                    disabled={disabled || performed || !replaceFrom || !replaceTo || replaceFrom === replaceTo}
                    onClick={() =>
                      void change(
                        () => changePerformer(state, replaceFrom, replaceTo),
                        "담당자를 바꿨어요. 고정·제외 조건은 유지했어요.",
                      )
                    }
                  >
                    담당자 교환
                  </Button>
                </div>
              )}
              {!state.draft.length && <Body>고정·제외 조건을 확인하고 역할 배정을 눌러 주세요.</Body>}
              <StudentPage
                label="배정 학생"
                students={state.students.filter((student) => state.draft.some((a) => a.studentId === student.id))}
              >
                {(visible) => (
                  <>
                    {state.jobs.map((job) => (
                      <section key={job.id} className={s.card} aria-label={job.title}>
                        <BodyStrong>
                          {job.title} · {job.capacity}명
                        </BodyStrong>
                        {state.draft
                          .filter((a) => a.jobId === job.id && visible.some((student) => student.id === a.studentId))
                          .map((a) => {
                            const student = state.students.find((s) => s.id === a.studentId),
                              done = state.events.some((e) => e.cycle === state.cycle && e.studentId === a.studentId);
                            return (
                              <div key={a.studentId} className={s.item}>
                                <BodyStrong>
                                  {student?.number}번 {student?.name}
                                </BodyStrong>
                                <div className={s.row}>
                                  {state.students.length <= 100 && (
                                    <ComboBox
                                      header={`${student?.number}번 담당자 교환`}
                                      value={a.studentId}
                                      disabled={disabled || performed}
                                      options={state.students
                                        .filter((s) => !state.excluded.includes(s.id))
                                        .map((s) => ({ value: s.id, label: `${s.number}번 ${s.name}` }))}
                                      onChange={(id) => {
                                        void change(
                                          () => changePerformer(state, a.studentId, id),
                                          "담당자를 바꿨어요. 고정·제외 조건은 유지했어요.",
                                        );
                                      }}
                                    />
                                  )}
                                  <Button
                                    disabled={disabled || done}
                                    onClick={() => {
                                      void change(
                                        () =>
                                          complete(state, a.studentId, crypto.randomUUID(), new Date().toISOString()),
                                        "실제 수행 완료를 한 번 기록했어요.",
                                      );
                                    }}
                                  >
                                    {done ? "수행 완료됨" : "수행 완료"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                      </section>
                    ))}
                  </>
                )}
              </StudentPage>
              <Caption secondary>
                교환 대상이 이미 다른 역할을 맡고 있으면 서로 바꿔요. 학생 보기는 화면 복제에 사용하며 횟수·고정·제외
                조건은 표시하지 않아요.
              </Caption>
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
                          {student.number}번 {student.name} · {counts.get(student.id) ?? 0}회
                        </BodyStrong>
                        <CheckBox
                          content={`${student.number}번 이번 제외`}
                          checked={state.excluded.includes(student.id)}
                          disabled={disabled || performed}
                          onChange={(excluded) => {
                            void change(
                              () => setCondition(state, student.id, excluded, state.fixed[student.id] ?? ""),
                              "제외 조건을 바꿨어요. 다시 배정해 주세요.",
                            );
                          }}
                        />
                        <ComboBox
                          header={`${student.number}번 고정 역할`}
                          value={state.fixed[student.id] ?? ""}
                          disabled={disabled || performed}
                          options={[
                            { value: "", label: "고정 안 함" },
                            ...state.jobs.map((j) => ({ value: j.id, label: j.title })),
                          ]}
                          onChange={(job) => {
                            void change(
                              () => setCondition(state, student.id, state.excluded.includes(student.id), job),
                              "고정 조건을 바꿨어요. 다시 배정해 주세요.",
                            );
                          }}
                        />
                      </div>
                    )}
                  />
                )}
              </StudentPage>
            </section>
          </div>
          {setup}
        </>
      )}
      <SettingsExpander
        key={blocked ? "recovery" : "records"}
        header="수행 기록과 파일"
        description="실제로 완료한 배정만 집계하고 당시 이름·번호·역할을 보존해요."
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
          header="수행 완료 기록"
          items={[...state.events].reverse()}
          getKey={(e) => e.id}
          emptyText="역할을 배정하고 실제 수행 완료를 누르면 기록돼요."
          renderItem={(e) => (
            <Body>
              {e.cycle}번째 · {e.number}번 {e.name} · {e.jobTitle} · {new Date(e.completedAt).toLocaleString("ko-KR")}
            </Body>
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
          <Body>현재 명단·고정·제외·완료 기록을 새 작업으로 바꿔요. 필요한 기록은 먼저 파일로 저장해 주세요.</Body>
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
          <Body>현재 작업을 가져온 명단·배정·완료 기록으로 바꿔요. 필요한 현재 기록은 먼저 파일로 저장해 주세요.</Body>
        </ContentDialog>
      )}
    </div>
  );
}
