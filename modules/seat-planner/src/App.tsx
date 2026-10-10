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
  ContentDialog,
  InfoBar,
  NumberBox,
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  ToggleSwitch,
  deckTokens,
  makeStyles,
  mergeClasses,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import {
  arrange,
  comparison,
  confirm,
  emptyState,
  isConfirmed,
  parseRoster,
  replaceRoster,
  resizeLayout,
  seatLabel,
  swapSeats,
  validateRules,
  type Layout,
  type SeatState,
  type Snapshot,
} from "./logic.ts";
import {
  AmbiguousStorageWrite,
  StorageCapacityError,
  exportFile,
  loadState,
  publicText,
  readBackup,
  readRoster,
  saveState,
} from "./state.ts";
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.sectionGap,
    padding: deckTokens.pagePadding,
    minWidth: 0,
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
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: deckTokens.inlineGap },
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)",
    gap: deckTokens.sectionGap,
    "@media (max-width: 800px)": { gridTemplateColumns: "minmax(0,1fr)" },
  },
  board: { overflow: "auto", maxHeight: "70vh", padding: tokens.spacingVerticalS },
  grid: { display: "grid", gap: tokens.spacingVerticalS, minWidth: "max-content" },
  seat: {
    display: "flex",
    flexDirection: "column",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    minWidth: 0,
    padding: tokens.spacingVerticalM,
  },
  name: { overflowWrap: "anywhere" },
  publicName: { fontSize: tokens.fontSizeBase600, lineHeight: tokens.lineHeightBase600 },
  publicSeat: { padding: tokens.spacingVerticalS, gap: tokens.spacingVerticalXS },
  chalk: {
    textAlign: "center",
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorBrandBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  conditions: {
    maxHeight: "60vh",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
  },
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [state, setState] = useState<SeatState>(emptyState),
    [loaded, setLoaded] = useState(false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false);
  const [roster, setRoster] = useState(""),
    [label, setLabel] = useState("이번 수업"),
    [aisles, setAisles] = useState(""),
    [editingRoster, setEditingRoster] = useState(false);
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [blockMode, setBlockMode] = useState(false),
    [teacher, setTeacher] = useState(false);
  const [pairA, setPairA] = useState(""),
    [pairB, setPairB] = useState(""),
    [resetDialog, setResetDialog] = useState(false),
    [replacement, setReplacement] = useState<SeatState | null>(null);
  const [publicSnapshot, setPublicSnapshot] = useState<Snapshot | null>(null),
    [historyId, setHistoryId] = useState(""),
    [undo, setUndo] = useState<SeatState | null>(null);
  const working = useRef(false),
    drag = useRef<number | null>(null),
    disabled = busy || blocked || !loaded;
  const last = state.history.at(-1) ?? null,
    chosen = state.history.find((h) => h.id === historyId) ?? last;
  const stats = comparison(state);
  const published = isConfirmed(state);
  const [studentFilter, setStudentFilter] = useState("");
  const [conditionPage, setConditionPage] = useState(0);
  const filteredStudents = state.students.filter((student) =>
    `${student.number} ${student.name}`.includes(studentFilter.trim()),
  );
  const lastPage = Math.max(0, Math.ceil(filteredStudents.length / 10) - 1),
    page = Math.min(conditionPage, lastPage);
  const conditionStudents = filteredStudents.slice(page * 10, (page + 1) * 10);
  let conflict = "";
  if (state.students.length)
    try {
      validateRules(state);
    } catch (failure) {
      conflict = failure instanceof Error ? failure.message : "조건을 확인해 주세요.";
    }
  function show(next: SeatState) {
    setRoster(next.students.map((student) => `${student.number}\t${student.name}`).join("\n"));
    setLabel(next.label);
    setAisles(next.layout.aisles.join(", "));
    setSelected(null);
  }
  useEffect(() => {
    let active = true;
    loadState(deck)
      .then((next) => {
        if (active) {
          setState(next);
          show(next);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setBlocked(true);
          setLoaded(true);
          setError("저장 자료를 읽지 못했어요. 기록 파일을 가져오거나 새 작업을 확인해 복구해 주세요.");
        }
      });
    return () => {
      active = false;
    };
  }, [deck]);
  async function change(operation: () => SeatState, success: string, recovery = false) {
    if (working.current || !loaded || (blocked && !recovery)) return false;
    working.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    let next: SeatState;
    try {
      next = operation();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "입력을 확인해 주세요.");
      working.current = false;
      setBusy(false);
      return false;
    }
    try {
      await saveState(deck, next);
      setUndo(blocked ? null : state);
      setState(next);
      setBlocked(false);
      setSelected(null);
      setMessage(success);
      return true;
    } catch (failure) {
      if (failure instanceof AmbiguousStorageWrite) {
        setBlocked(true);
        setError("저장 결과를 확인하지 못했어요. 저장 기록을 다시 확인한 뒤 계속해 주세요.");
      } else if (failure instanceof StorageCapacityError) setError(failure.message);
      else setError("변경 내용을 저장하지 못했어요. 이전 배치와 기록을 유지했어요. 다시 시도해 주세요.");
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function io(operation: () => Promise<void>) {
    if (working.current || !loaded) return;
    working.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch {
      setError("파일 작업을 마치지 못했어요. 파일과 저장 위치를 확인해 다시 시도해 주세요.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function updateLayout(patch: Partial<Layout>) {
    void change(() => {
      return resizeLayout(state, patch);
    }, "교실 구조를 바꿨어요. 새 배치를 만들어 주세요.");
  }
  function toggleRule(key: "excluded" | "front", id: string, on: boolean) {
    void change(
      () => ({
        ...state,
        preview: null,
        rules: { ...state.rules, [key]: on ? [...state.rules[key], id] : state.rules[key].filter((x) => x !== id) },
      }),
      "배치 조건을 바꿨어요. 새 배치를 만들어 주세요.",
    );
  }
  function clickSeat(index: number) {
    if (disabled) return;
    if (blockMode) {
      void change(
        () => ({
          ...state,
          preview: null,
          layout: {
            ...state.layout,
            blocked: state.layout.blocked.includes(index)
              ? state.layout.blocked.filter((i) => i !== index)
              : [...state.layout.blocked, index],
          },
        }),
        "비워둘 자리를 바꿨어요. 고정 조건을 확인하고 새 배치를 만들어 주세요.",
      );
      return;
    }
    if (state.layout.blocked.includes(index)) return;
    if (selected === index) {
      setSelected(null);
      return;
    }
    if (selected === null) {
      if (state.preview?.[index]) {
        setSelected(index);
        setMessage("바꿀 자리를 하나 더 눌러 주세요. 빈 자리로도 이동할 수 있어요.");
      }
      return;
    }
    void change(() => swapSeats(state, selected, index), "자리를 교환했어요. 검토한 뒤 확정해 주세요.");
  }
  function renderBoard(layout: Layout, seats: (string | null)[] | null, snapshot: Snapshot | null = null) {
    const indexes = Array.from({ length: layout.rows * layout.columns }, (_, i) => i);
    if (teacher && !snapshot) indexes.reverse();
    const columns = Array.from({ length: layout.columns }, (_, i) =>
      teacher && !snapshot ? layout.columns - 1 - i : i,
    );
    const tracks = columns
      .flatMap((column, i) =>
        i < columns.length - 1 && layout.aisles.includes(teacher && !snapshot ? column : column + 1)
          ? [layout.columns <= 6 ? "minmax(0,1fr)" : "minmax(7ch,1fr)", tokens.spacingHorizontalXXL]
          : [layout.columns <= 6 ? "minmax(0,1fr)" : "minmax(7ch,1fr)"],
      )
      .join(" ");
    const gridColumn = (column: number) =>
      columns.indexOf(column) +
      1 +
      columns.slice(0, columns.indexOf(column)).filter((c) => layout.aisles.includes(teacher && !snapshot ? c : c + 1))
        .length;
    return (
      <div className={s.board}>
        <div className={s.chalk}>
          <BodyStrong>칠판 · 교탁</BodyStrong>
        </div>
        <div
          className={s.grid}
          style={{ gridTemplateColumns: tracks, minWidth: layout.columns <= 6 ? 0 : "max-content" }}
        >
          {indexes.map((index) => {
            const student = snapshot
                ? (snapshot.seats[index] ?? null)
                : (state.students.find((student) => student.id === seats?.[index]) ?? null),
              unavailable = layout.blocked.includes(index);
            const name = student
              ? `${student.number}번 ${student.name}`
              : unavailable && !snapshot
                ? "비워둘 자리"
                : "빈 자리";
            const content = (
              <>
                <Caption>{seatLabel(index, layout.columns)}</Caption>
                <BodyStrong className={snapshot ? mergeClasses(s.name, s.publicName) : s.name}>{name}</BodyStrong>
                {!snapshot && student && state.rules.fixed[student.id] === index && <Caption>고정</Caption>}
              </>
            );
            const style = {
              gridColumn: gridColumn(index % layout.columns),
              gridRow:
                teacher && !snapshot
                  ? layout.rows - Math.floor(index / layout.columns)
                  : Math.floor(index / layout.columns) + 1,
            };
            return snapshot ? (
              <div key={index} className={mergeClasses(s.card, s.publicSeat)} style={style}>
                {content}
              </div>
            ) : (
              <Button
                key={index}
                className={s.seat}
                style={style}
                aria-label={`${seatLabel(index, layout.columns)} ${name}`}
                aria-pressed={selected === index}
                appearance={selected === index ? "primary" : "secondary"}
                disabled={disabled || (!blockMode && (unavailable || !seats))}
                onClick={() => clickSeat(index)}
                draggable={!disabled && !blockMode && Boolean(student)}
                onDragStart={() => {
                  drag.current = index;
                }}
                onDragEnd={() => {
                  drag.current = null;
                }}
                onDragOver={(event) => {
                  if (drag.current !== null && !unavailable) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = drag.current;
                  drag.current = null;
                  if (from !== null && !disabled)
                    void change(() => swapSeats(state, from, index), "자리를 교환했어요. 검토한 뒤 확정해 주세요.");
                }}
              >
                {content}
              </Button>
            );
          })}
        </div>
        <Caption>
          {teacher && !snapshot ? "교탁에서 학생을 바라보는 시점" : "학생이 칠판을 바라보는 시점"} · 칠판 앞이
          1행이에요.
        </Caption>
      </div>
    );
  }
  if (publicSnapshot)
    return (
      <div className={s.page}>
        <PageHeader title={publicSnapshot.label} description="확정한 자리 배치" />
        {error && <InfoBar severity="error" message="교사 화면으로 돌아가지 못했어요. 다시 눌러 주세요." />}
        {renderBoard(publicSnapshot.layout, null, publicSnapshot)}
        <Button
          disabled={busy}
          onClick={() =>
            void io(async () => {
              await deck.window.setFullscreen(false);
              setPublicSnapshot(null);
            })
          }
        >
          교사 화면으로 돌아가기
        </Button>
      </div>
    );
  return (
    <div className={s.page}>
      <PageHeader title="자리 배치" description="명단과 조건을 정하고, 미리보기를 살펴본 뒤 확정해요." />
      {!loaded && <ProgressRing label="저장한 배치를 불러오는 중" />}
      {error && <InfoBar severity="error" message={error} />}{" "}
      {message && <InfoBar severity="success" message={message} />}
      <div className={s.row}>
        {blocked && (
          <Button
            disabled={busy || !loaded}
            onClick={() =>
              void io(async () => {
                const next = await loadState(deck);
                setState(next);
                show(next);
                setBlocked(false);
                setUndo(null);
                setMessage("저장 기록을 다시 확인했어요.");
              })
            }
          >
            저장 기록 다시 확인
          </Button>
        )}
        <Button
          disabled={disabled}
          onClick={() =>
            void io(async () => {
              if (await exportFile(deck, state)) setMessage("자리 배치 기록을 새 폴더에 저장했어요.");
            })
          }
        >
          기록 파일 저장
        </Button>
        <Button
          disabled={busy || !loaded}
          onClick={() =>
            void io(async () => {
              const next = await readBackup(deck);
              if (next) setReplacement(next);
            })
          }
        >
          기록 파일 가져오기
        </Button>
        <Button disabled={busy || !loaded} onClick={() => setResetDialog(true)}>
          새 작업
        </Button>
        {undo && (
          <Button disabled={disabled} onClick={() => void change(() => undo, "마지막 변경을 되돌렸어요.")}>
            마지막 변경 되돌리기
          </Button>
        )}
      </div>
      {(state.students.length === 0 || editingRoster) && (
        <section className={s.card}>
          <BodyStrong>이번 작업 명단</BodyStrong>
          <Caption>번호와 이름을 한 줄씩 붙여 넣어요. 이 명단은 자리 배치 도구에만 저장돼요.</Caption>
          <TextBox header="배치 이름" value={label} onChange={setLabel} disabled={disabled} />
          <TextBox
            header="학생 명단"
            multiline
            rows={8}
            value={roster}
            onChange={setRoster}
            placeholder={"1 학생가\n2 학생나"}
            disabled={disabled}
          />
          <div className={s.row}>
            <Button
              disabled={disabled}
              onClick={() =>
                void io(async () => {
                  const text = await readRoster(deck);
                  if (text !== null) {
                    setRoster(text);
                    setMessage("명단 파일을 읽었어요. 내용을 확인한 뒤 적용해 주세요.");
                  }
                })
              }
            >
              명단 파일 읽기
            </Button>
            <Button
              appearance="primary"
              disabled={disabled}
              onClick={() =>
                void change(
                  () => replaceRoster(state, parseRoster(roster, state.students), label),
                  "명단을 적용했어요. 이전 확정 기록은 보존했어요.",
                ).then((ok) => {
                  if (ok) setEditingRoster(false);
                })
              }
            >
              명단 적용
            </Button>
            {state.students.length > 0 && (
              <Button
                disabled={busy}
                onClick={() => {
                  show(state);
                  setEditingRoster(false);
                }}
              >
                명단 수정 취소
              </Button>
            )}
          </div>
        </section>
      )}
      {state.students.length > 0 && !editingRoster && (
        <>
          <div className={s.row}>
            <BodyStrong>
              {state.label} · {state.students.length}명
            </BodyStrong>
            <Button
              disabled={disabled}
              onClick={() => {
                show(state);
                setEditingRoster(true);
              }}
            >
              명단 수정
            </Button>
          </div>
          {conflict && <InfoBar severity="warning" message={conflict} />}
          <div className={s.split}>
            <section className={s.card}>
              <div className={s.row}>
                <BodyStrong>{state.preview ? (published ? "확정한 배치" : "검토 중인 배치") : "교실 자리"}</BodyStrong>
                <Button
                  appearance="primary"
                  disabled={disabled || Boolean(conflict)}
                  onClick={() =>
                    void change(() => arrange(state), "미리보기를 만들었어요. 자리를 직접 바꾼 뒤 확정할 수 있어요.")
                  }
                >
                  새 배치 만들기
                </Button>
                <Button
                  disabled={disabled || !state.preview || Boolean(conflict) || published}
                  onClick={() =>
                    void change(() => confirm(state), "자리 배치를 확정했어요. 학생 보기로 공개할 수 있어요.")
                  }
                >
                  {published ? "확정 완료" : "이 배치 확정"}
                </Button>
              </div>
              <div className={s.row}>
                <ToggleSwitch header="교사 시점" checked={teacher} onChange={setTeacher} />
                <ToggleSwitch
                  header="비워둘 자리 지정"
                  checked={blockMode}
                  onChange={(value) => {
                    setBlockMode(value);
                    setSelected(null);
                  }}
                  disabled={disabled}
                />
              </div>
              <Caption>
                {blockMode
                  ? "자리를 눌러 사용 여부를 바꿔요. 고정 조건은 자동으로 해제하지 않아요."
                  : "학생이 있는 자리와 바꿀 자리를 차례로 누르거나 끌어 옮겨요. 빈 자리로도 이동할 수 있어요."}
              </Caption>
              {renderBoard(state.layout, state.preview)}
              {state.preview && stats.hasReference && (
                <Caption>
                  지난 확정본과 비교 ·{" "}
                  {stats.comparable
                    ? `이동 ${stats.moved}명 / 같은 자리 ${stats.same}명`
                    : "교실 구조가 달라 위치 비교를 생략했어요"}{" "}
                  · 옆자리 반복 {stats.repeatedNeighbors}쌍
                </Caption>
              )}
            </section>
            <section className={s.card}>
              <BodyStrong>교실 구조</BodyStrong>
              <NumberBox
                header="행 수"
                value={state.layout.rows}
                min={1}
                max={100}
                disabled={disabled}
                onChange={(rows) => updateLayout({ rows })}
              />
              <NumberBox
                header="열 수"
                value={state.layout.columns}
                min={1}
                max={100}
                disabled={disabled}
                onChange={(columns) => updateLayout({ columns })}
              />
              <NumberBox
                header="앞줄 범위"
                value={state.layout.frontRows}
                min={1}
                max={state.layout.rows}
                disabled={disabled}
                onChange={(frontRows) => updateLayout({ frontRows })}
              />
              <TextBox
                header="통로를 둘 열 뒤"
                value={aisles}
                onChange={setAisles}
                description="예: 2, 4를 입력하면 2열과 4열 뒤에 통로를 표시해요."
                disabled={disabled}
              />
              <Button
                disabled={disabled}
                onClick={() => {
                  const parsed = aisles.trim() ? aisles.split(/[, ]+/).map(Number) : [];
                  updateLayout({ aisles: parsed });
                }}
              >
                통로 적용
              </Button>
              <CheckBox
                content="가능하면 지난 자리 반복 줄이기"
                checked={state.rules.avoidPreviousSeat}
                disabled={disabled}
                onChange={(value) =>
                  void change(
                    () => ({ ...state, preview: null, rules: { ...state.rules, avoidPreviousSeat: value } }),
                    "반복 줄이기 조건을 바꿨어요.",
                  )
                }
              />
              <CheckBox
                content="가능하면 지난 옆자리 반복 줄이기"
                checked={state.rules.avoidPreviousNeighbor}
                disabled={disabled}
                onChange={(value) =>
                  void change(
                    () => ({ ...state, preview: null, rules: { ...state.rules, avoidPreviousNeighbor: value } }),
                    "반복 줄이기 조건을 바꿨어요.",
                  )
                }
              />
              <Caption>
                고정·제외·앞줄·분리를 먼저 지켜요. 자리와 옆자리 반복이 모두 없어지는 결과를 보장하지는 않아요.
              </Caption>
            </section>
          </div>
          <SettingsExpander
            header="학생별 고정·제외·앞줄 조건"
            description="조건은 교사 화면에만 보여요. 충돌하는 조건도 자동으로 풀지 않아요."
          >
            <TextBox
              header="학생 조건 찾기"
              value={studentFilter}
              onChange={(value) => {
                setStudentFilter(value);
                setConditionPage(0);
              }}
              description="번호 또는 이름으로 찾아요."
            />
            <div className={s.row}>
              <Button disabled={page === 0} onClick={() => setConditionPage(page - 1)}>
                이전 학생
              </Button>
              <Caption>
                {page + 1} / {lastPage + 1}쪽 · {filteredStudents.length}명
              </Caption>
              <Button disabled={page === lastPage} onClick={() => setConditionPage(page + 1)}>
                다음 학생
              </Button>
            </div>
            <div className={s.conditions}>
              {conditionStudents.map((student) => (
                <div key={student.id} className={s.card}>
                  <BodyStrong>
                    {student.number}번 {student.name}
                  </BodyStrong>
                  <div className={s.row}>
                    <CheckBox
                      content={`${student.number}번 배치 제외`}
                      checked={state.rules.excluded.includes(student.id)}
                      disabled={disabled}
                      onChange={(value) => toggleRule("excluded", student.id, value)}
                    />
                    <CheckBox
                      content={`${student.number}번 앞줄 배치`}
                      checked={state.rules.front.includes(student.id)}
                      disabled={disabled}
                      onChange={(value) => toggleRule("front", student.id, value)}
                    />
                  </div>
                  <ComboBox
                    header={`${student.number}번 고정 자리`}
                    value={state.rules.fixed[student.id] === undefined ? "" : String(state.rules.fixed[student.id])}
                    disabled={disabled}
                    options={[
                      { value: "", label: "고정 안 함" },
                      ...Array.from({ length: state.layout.rows * state.layout.columns }, (_, i) => ({
                        value: String(i),
                        label: seatLabel(i, state.layout.columns),
                      })),
                      ...(state.rules.fixed[student.id] !== undefined &&
                      (state.rules.fixed[student.id] ?? -1) >= state.layout.rows * state.layout.columns
                        ? [
                            {
                              value: String(state.rules.fixed[student.id]),
                              label: "교실 밖 고정 자리 · 변경이 필요해요",
                            },
                          ]
                        : []),
                    ]}
                    onChange={(value) =>
                      void change(() => {
                        const fixed = Object.fromEntries(
                          Object.entries(state.rules.fixed).filter(([id]) => id !== student.id),
                        );
                        if (value !== "") fixed[student.id] = Number(value);
                        return { ...state, preview: null, rules: { ...state.rules, fixed } };
                      }, "고정 조건을 바꿨어요. 새 배치를 만들어 주세요.")
                    }
                  />
                </div>
              ))}
            </div>
          </SettingsExpander>
          <SettingsExpander
            header="가까이 앉지 않을 학생"
            description="앞뒤·좌우·대각선 한 칸을 피하며, 통로가 있어도 가까운 자리로 계산해요."
          >
            <div className={s.row}>
              <ComboBox
                header="분리할 첫 학생"
                value={pairA}
                onChange={setPairA}
                disabled={disabled}
                options={[
                  { value: "", label: "학생 선택" },
                  ...state.students.map((student) => ({
                    value: student.id,
                    label: `${student.number}번 ${student.name}`,
                  })),
                ]}
              />
              <ComboBox
                header="분리할 둘째 학생"
                value={pairB}
                onChange={setPairB}
                disabled={disabled}
                options={[
                  { value: "", label: "학생 선택" },
                  ...state.students.map((student) => ({
                    value: student.id,
                    label: `${student.number}번 ${student.name}`,
                  })),
                ]}
              />
              <Button
                disabled={disabled || !pairA || !pairB}
                onClick={() =>
                  void change(() => {
                    if (
                      pairA === pairB ||
                      state.rules.separated.some((pair) => pair.includes(pairA) && pair.includes(pairB))
                    )
                      throw new Error("서로 다른 두 학생을 중복 없이 선택해 주세요.");
                    return {
                      ...state,
                      preview: null,
                      rules: { ...state.rules, separated: [...state.rules.separated, [pairA, pairB]] },
                    };
                  }, "분리 조건을 추가했어요. 새 배치를 만들어 주세요.")
                }
              >
                분리 조건 추가
              </Button>
            </div>
            {state.rules.separated.map(([a, b], index) => (
              <div key={index} className={s.row}>
                <Body>
                  {[a, b]
                    .map((id) => {
                      const student = state.students.find((student) => student.id === id);
                      return student ? `${student.number}번 ${student.name}` : "명단 밖 학생";
                    })
                    .join(" · ")}
                </Body>
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void change(
                      () => ({
                        ...state,
                        preview: null,
                        rules: { ...state.rules, separated: state.rules.separated.filter((_, i) => i !== index) },
                      }),
                      "분리 조건을 해제했어요.",
                    )
                  }
                >
                  이 분리 조건 해제
                </Button>
              </div>
            ))}
          </SettingsExpander>
          {last && (
            <section className={s.card}>
              <BodyStrong>확정 기록 · {state.history.length}개</BodyStrong>
              <ComboBox
                header="확정본 선택"
                value={chosen?.id ?? ""}
                onChange={setHistoryId}
                options={[...state.history].reverse().map((h, i) => ({
                  value: h.id,
                  label: `${state.history.length - i}. ${h.label} · ${new Date(h.createdAt).toLocaleString()}`,
                }))}
              />
              <div className={s.row}>
                <Button
                  disabled={disabled || !chosen}
                  onClick={() =>
                    void io(async () => {
                      await deck.window.setFullscreen(true);
                      setPublicSnapshot(chosen);
                    })
                  }
                >
                  학생 보기
                </Button>
                <Button
                  disabled={disabled || !chosen}
                  onClick={() =>
                    void io(async () => {
                      if (await exportFile(deck, state, chosen)) setMessage("학생용 자리 배치를 새 폴더에 저장했어요.");
                    })
                  }
                >
                  학생용 파일 저장
                </Button>
              </div>
              <TextBox
                header="복사용 학생 배치"
                multiline
                rows={6}
                value={chosen ? publicText(chosen) : ""}
                onChange={() => {}}
                readOnly
              />
              <Caption>
                확정 당시 번호와 이름만 공개해요. 고정·제외·앞줄·분리 조건과 교사용 기록은 학생 보기와 학생용 파일에
                포함하지 않아요.
              </Caption>
            </section>
          )}
        </>
      )}
      <ContentDialog
        open={resetDialog}
        title="새 작업을 시작할까요?"
        primaryButtonText="새 작업"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setResetDialog(false);
          if (result === "primary")
            void change(emptyState, "새 작업을 시작했어요.", true).then((ok) => {
              if (ok) {
                show(emptyState());
                setEditingRoster(false);
                setUndo(null);
              }
            });
        }}
      >
        <Body>현재 명단과 이력을 새 작업으로 바꿔요. 보관할 기록은 먼저 기록 파일로 저장해 주세요.</Body>
      </ContentDialog>
      <ContentDialog
        open={replacement !== null}
        title="기록 파일을 가져올까요?"
        primaryButtonText="가져오기"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          const next = replacement;
          setReplacement(null);
          if (result === "primary" && next)
            void change(() => next, "자리 배치 기록을 가져왔어요.", true).then((ok) => {
              if (ok) {
                show(next);
                setEditingRoster(false);
              }
            });
        }}
      >
        <Body>현재 작업을 선택한 파일의 명단·조건·확정 기록으로 바꿔요. 취소하면 현재 작업을 유지해요.</Body>
      </ContentDialog>
    </div>
  );
}
