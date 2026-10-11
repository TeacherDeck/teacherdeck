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
  Display,
  InfoBar,
  ListView,
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  available,
  complete,
  emptyState,
  nextRound,
  parseRoster,
  pick,
  replaceRoster,
  setExcluded,
  skip,
  totalCounts,
  undoCompletion,
  type PickerState,
} from "./logic.ts";
import { loadState, readBackup, saveState, writeBackup } from "./state.ts";
import { SchoolRoster } from "./SchoolRoster.tsx";
import { StudentPage } from "./StudentPage.tsx";

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
  result: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalXXL,
    overflowWrap: "anywhere",
  },
  student: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    paddingBlock: tokens.spacingVerticalXS,
    minWidth: 0,
    flexGrow: 1,
  },
  name: { overflowWrap: "anywhere", whiteSpace: "normal" },
});

export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [state, setState] = useState<PickerState>(emptyState);
  const [roster, setRoster] = useState("");
  const [label, setLabel] = useState("이번 수업");
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");
  const [publicView, setPublicView] = useState(false);
  const [resetDialog, setResetDialog] = useState(false);
  const [replacement, setReplacement] = useState<PickerState | null>(null);
  const counts = useMemo(() => totalCounts(state), [state]);
  const working = useRef(false);
  const disabled = busy || blocked || !loaded;
  const pool = available(state);
  const manualOptions = [
    { value: "", label: "자동 · 총횟수가 적은 학생부터" },
    ...pool.map((student) => ({ value: student.id, label: `${student.number}번 ${student.name}` })),
  ];
  function showRoster(next: PickerState) {
    setRoster(next.students.map((student) => `${student.number}\t${student.name}\t${student.baseCount}`).join("\n"));
    setLabel(next.label);
    setManual("");
  }
  useEffect(() => {
    let active = true;
    loadState(deck)
      .then((next) => {
        if (active) {
          setState(next);
          showRoster(next);
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
  async function change(operation: () => PickerState, success: string, recovery = false) {
    if (working.current || busy || !loaded || (blocked && !recovery)) return false;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    let next: PickerState;
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
      setManual("");
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
  async function fileAction(importing: boolean) {
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
    setError("");
    try {
      await deck.window.setFullscreen(show);
      setPublicView(show);
    } catch {
      setError("화면을 바꾸지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  const result = (
    <div className={s.result} aria-live="polite">
      <BodyStrong>{state.label}</BodyStrong>
      <Caption>이번 발표자</Caption>
      {state.pending ? (
        <>
          <BodyStrong>{state.pending.number}번</BodyStrong>
          <Display className={s.name}>{state.pending.name}</Display>
        </>
      ) : (
        <Body>발표자를 뽑아 주세요.</Body>
      )}
    </div>
  );
  const rosterForm = (
    <SettingsExpander
      header="이번 작업 명단"
      description="공통 등록 없이 번호·이름·기존횟수를 붙여넣어 사용해요."
      key={state.students.length ? "registered" : "empty"}
      defaultExpanded={!state.students.length}
    >
      <TextBox header="작업 이름" value={label} onChange={setLabel} disabled={disabled} />
      <TextBox
        header="학생 명단"
        description="한 줄에 번호와 이름을 적어요. 엑셀의 번호·이름·기존횟수 세 열을 그대로 붙여넣을 수도 있어요. 기존횟수는 여기서 완료한 기록 이전의 횟수예요."
        value={roster}
        onChange={setRoster}
        multiline
        rows={5}
        disabled={disabled}
      />
      <div className={s.row}>
        <Button
          disabled={disabled || !roster.trim()}
          onClick={() => {
            void change(
              () => replaceRoster(state, parseRoster(roster, state.students), label),
              state.students.length
                ? "명단을 적용했어요. 이전 발표 기록은 보존하고 새 라운드를 시작했어요."
                : "명단을 적용했어요. 바로 발표자를 뽑아 주세요.",
            );
          }}
        >
          명단 적용
        </Button>
        <Button
          disabled={disabled}
          onClick={() => {
            showRoster(state);
          }}
        >
          편집 취소
        </Button>
      </div>
    </SettingsExpander>
  );
  if (publicView)
    return (
      <div className={s.page}>
        {result}
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
        title="발표자 뽑기"
        description="지정·제외 조건을 먼저 지키고, 실제 발표 완료 횟수로 균등하게 뽑아요."
      />
      <SchoolRoster deck={deck} disabled={disabled} hasRoster={state.students.length > 0} previous={state.students} onApply={async (snapshot, students) => {
        const next = replaceRoster(state, students, snapshot.context.label);
        const saved = await change(() => next, "공통 명부를 불러왔어요. 기존 확정 기록은 유지해요.");
        if (saved) { showRoster(next); }
        return saved;
      }} />
      {!loaded && <ProgressRing label="저장한 기록을 불러오는 중" />}
      {error && <InfoBar severity="error" message={error} />}
      {message && <InfoBar severity="success" message={message} />}
      {!state.students.length && rosterForm}
      {state.students.length > 0 && (
        <div className={s.workspace}>
          <section className={s.card} aria-label="발표자 선정">
            {result}
            <ComboBox
              header="발표자 지정"
              options={manualOptions}
              value={manual}
              onChange={setManual}
              disabled={disabled || !pool.length}
            />
            <Caption secondary>직접 지정은 횟수 균등보다 우선해요. 이번 제외·완료 학생은 지정할 수 없어요.</Caption>
            <div className={s.row}>
              <Button
                appearance="primary"
                disabled={disabled || !pool.length}
                onClick={() => {
                  void change(() => pick(state, manual), "발표자를 선정했어요. 발표를 마치면 완료를 눌러 주세요.");
                }}
              >
                {state.pending ? "다시 뽑기" : "발표자 뽑기"}
              </Button>
              <Button
                disabled={disabled || !state.pending}
                onClick={() => {
                  void change(
                    () => complete(state, crypto.randomUUID(), new Date().toISOString()),
                    "발표 완료를 한 번 기록했어요.",
                  );
                }}
              >
                발표 완료
              </Button>
              <Button
                disabled={disabled || !state.pending}
                onClick={() => {
                  void change(() => skip(state), "이번 라운드에서 건너뛰었어요. 발표 횟수는 그대로예요.");
                }}
              >
                이번에는 건너뛰기
              </Button>
            </div>
            <Caption>
              {state.round}라운드 · 남은 대상 {pool.length}명 / 전체 {state.students.length}명
            </Caption>
            <div className={s.row}>
              <Button
                disabled={disabled || !state.students.length}
                onClick={() => {
                  void change(() => nextRound(state), "새 라운드를 시작했어요. 총횟수와 이번 제외는 유지했어요.");
                }}
              >
                새 라운드
              </Button>
              <Button
                disabled={disabled || !state.events.length}
                onClick={() => {
                  void change(() => undoCompletion(state), "마지막 발표 완료를 되돌렸어요.");
                }}
              >
                마지막 완료 되돌리기
              </Button>
              <Button
                disabled={disabled || !state.pending}
                onClick={() => {
                  void switchView(true);
                }}
              >
                학생에게 보여주기
              </Button>
            </div>
            <Caption secondary>학생 보기는 화면 복제에서 사용해요. 교사용 횟수·제외 정보는 표시하지 않아요.</Caption>
          </section>
          <section className={s.card} aria-label="참여 학생과 횟수">
            <BodyStrong>참여 학생과 총횟수</BodyStrong>
            <StudentPage students={state.students}>
              {(visible) => (
                <ListView
                  header="학생 명단"
                  items={visible}
                  getKey={(student) => student.id}
                  emptyText="아래에서 명단을 붙여넣고 적용해 주세요."
                  renderItem={(student) => (
                    <div className={s.student}>
                      <BodyStrong>
                        {student.number}번 {student.name} · {counts.get(student.id) ?? 0}회
                      </BodyStrong>
                      <div className={s.row}>
                        <CheckBox
                          content={`${student.number}번 이번 제외`}
                          checked={state.excluded.includes(student.id)}
                          disabled={disabled}
                          onChange={(excluded) => {
                            void change(
                              () => setExcluded(state, student.id, excluded),
                              excluded ? "이번 대상에서 제외했어요." : "이번 대상에 포함했어요.",
                            );
                          }}
                        />
                        {state.skipped.includes(student.id) && <Caption>이번 라운드 건너뜀</Caption>}
                        {state.events.some((e) => e.round === state.round && e.studentId === student.id) && (
                          <Caption>이번 라운드 완료</Caption>
                        )}
                      </div>
                    </div>
                  )}
                />
              )}
            </StudentPage>
          </section>
        </div>
      )}
      {state.students.length > 0 && rosterForm}
      <SettingsExpander
        key={blocked ? "recovery" : "records"}
        header="완료 기록과 파일"
        description="완료 시점의 이름·번호를 보존해요. 파일은 이 도구의 기록 형식이에요."
        defaultExpanded={blocked}
      >
        <div className={s.row}>
          <Button
            disabled={disabled}
            onClick={() => {
              void fileAction(false);
            }}
          >
            기록 파일 저장
          </Button>
          <Button
            disabled={busy || !loaded}
            onClick={() => {
              void fileAction(true);
            }}
          >
            기록 파일 가져오기
          </Button>
          <Button
            disabled={busy || !loaded}
            onClick={() => {
              setResetDialog(true);
            }}
          >
            새 작업
          </Button>
        </div>
        <ListView
          header="발표 완료 기록"
          items={[...state.events].reverse()}
          getKey={(event) => event.id}
          emptyText="발표를 마치고 완료를 누르면 여기에 기록돼요."
          renderItem={(event) => (
            <Body>
              {event.round}라운드 · {event.number}번 {event.name} ·{" "}
              {new Date(event.completedAt).toLocaleString("ko-KR")}
            </Body>
          )}
        />
      </SettingsExpander>
      <ContentDialog
        open={resetDialog}
        title="새 작업을 시작할까요?"
        primaryButtonText="새 작업"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setResetDialog(false);
          if (result === "primary") {
            const next = emptyState();
            void change(() => next, "새 작업을 시작했어요.", true).then((saved) => {
              if (saved) showRoster(next);
            });
          }
        }}
      >
        <Body>현재 명단·총횟수·완료 기록을 새 작업으로 바꿔요. 필요한 기록은 먼저 파일로 저장해 주세요.</Body>
      </ContentDialog>
      <ContentDialog
        open={replacement !== null}
        title="가져온 기록으로 바꿀까요?"
        primaryButtonText="가져오기"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          const next = replacement;
          setReplacement(null);
          if (result === "primary" && next)
            void change(() => next, "기록 파일을 가져왔어요.", true).then((saved) => {
              if (saved) showRoster(next);
            });
        }}
      >
        <Body>현재 작업을 가져온 명단·완료 기록으로 바꿔요. 필요한 현재 기록은 먼저 파일로 저장해 주세요.</Body>
      </ContentDialog>
    </div>
  );
}
