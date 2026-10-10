// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Keep pure logic in plain functions so it can be unit-tested without the host (MOD-015).

export interface Student {
  id: string;
  number: number;
  name: string;
  baseCount: number;
}
export interface Completion {
  id: string;
  studentId: string;
  number: number;
  name: string;
  completedAt: string;
  round: number;
}
export interface PickerState {
  version: 1;
  label: string;
  students: Student[];
  excluded: string[];
  skipped: string[];
  round: number;
  pending: Student | null;
  events: Completion[];
}
export const MAX_EVENTS = 10000;
function hasControl(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32);
}
export function emptyState(): PickerState {
  return {
    version: 1,
    label: "이번 수업",
    students: [],
    excluded: [],
    skipped: [],
    round: 1,
    pending: null,
    events: [],
  };
}
export function totalCount(state: PickerState, studentId: string): number {
  return totalCounts(state).get(studentId) ?? 0;
}
export function totalCounts(state: PickerState): Map<string, number> {
  const counts = new Map(state.students.map((s) => [s.id, s.baseCount]));
  for (const event of state.events) counts.set(event.studentId, (counts.get(event.studentId) ?? 0) + 1);
  return counts;
}
/** MOD-015: reuse identity by number+name inside this task, never name alone. */
export function parseRoster(
  text: string,
  previous: Student[] = [],
  newId: () => string = () => crypto.randomUUID(),
): Student[] {
  if (text.length > 100000) throw new Error("명단은 100,000자 이내로 입력해 주세요.");
  const numbers = new Set<number>();
  const students: Student[] = [];
  for (const line of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s["trim"]())
    .filter(Boolean)) {
    if (/^(번호|학번|출석번호)[\t, ]+(이름|성명)([\t, ]+(기존횟수|횟수))?$/.test(line)) continue;
    const fields = line.split(/[\t,]+/).map((s) => s["trim"]());
    const first = fields[0] ?? "";
    const match = first.match(/^(\d+)[. ]+(.+)$/);
    let number: number;
    let name: string;
    let count: string | undefined;
    if (fields.length > 1) {
      number = Number(first);
      name = fields[1] ?? "";
      count = fields[2];
      if (fields.length > 3) throw new Error("명단은 번호·이름·기존횟수 순서로 입력해 주세요.");
    } else if (match) {
      number = Number(match[1]);
      name = match[2] ?? "";
    } else {
      number = 1;
      while (numbers.has(number)) number++;
      name = first;
    }
    if (!Number.isInteger(number) || number < 1 || number > 999999 || numbers.has(number))
      throw new Error("번호가 중복되거나 범위를 벗어났어요. 서로 다른 번호를 입력해 주세요.");
    if (!name || name.length > 40 || hasControl(name)) throw new Error("이름은 1~40자로 입력해 주세요.");
    const old = previous.find((s) => s["number"] === number && s["name"] === name);
    const baseCount = count === undefined || count === "" ? (old?.baseCount ?? 0) : Number(count);
    if (!Number.isInteger(baseCount) || baseCount < 0 || baseCount > 100000)
      throw new Error("기존횟수는 0~100,000의 정수로 입력해 주세요.");
    students.push({ id: old?.id ?? newId(), number, name, baseCount });
    numbers.add(number);
  }
  if (!students.length || students.length > 1000) throw new Error("학생을 1~1,000명 입력해 주세요.");
  return students.sort((a, b) => a.number - b.number);
}
export function replaceRoster(state: PickerState, students: Student[], label: string): PickerState {
  const ids = new Set(students.map((s) => s["id"]));
  const nextLabel = label.trim();
  if (!nextLabel || nextLabel.length > 80) throw new Error("작업 이름은 1~80자로 입력해 주세요.");
  return {
    ...state,
    label: nextLabel,
    students,
    excluded: state.excluded.filter((id) => ids.has(id)),
    skipped: [],
    pending: null,
    round: state.students.length || state.events.length ? state.round + 1 : state.round,
  };
}
export function available(state: PickerState): Student[] {
  const completed = new Set(state.events.filter((e) => e["round"] === state.round).map((e) => e["studentId"]));
  return state.students.filter(
    (s) => !state.excluded.includes(s["id"]) && !state.skipped.includes(s["id"]) && !completed.has(s["id"]),
  );
}
/** Teacher choice outranks total-count balancing, but never bypasses exclusion. */
export function pick(state: PickerState, manualId = "", random: () => number = Math.random): PickerState {
  const eligible = available(state);
  let pool: Student[];
  if (manualId) {
    pool = eligible.filter((s) => s["id"] === manualId);
    if (!pool.length) throw new Error("직접 지정한 학생은 이번 대상이 아니에요. 제외·완료 상태를 확인해 주세요.");
  } else {
    const counts = totalCounts(state);
    const min = Math.min(...eligible.map((s) => counts.get(s.id) ?? 0));
    pool = eligible.filter((s) => (counts.get(s.id) ?? 0) === min);
    const different = pool.filter((s) => s["id"] !== state.pending?.id);
    if (different.length) pool = different;
  }
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error("뽑기를 처리하지 못했어요. 다시 시도해 주세요.");
  const selected = pool[Math.floor(value * pool.length)];
  if (!selected) throw new Error("이번 대상이 모두 끝났어요. 새 라운드를 시작하거나 제외 설정을 바꿔 주세요.");
  return { ...state, pending: { ...selected } };
}
export function setExcluded(state: PickerState, studentId: string, excluded: boolean): PickerState {
  if (!state.students.some((s) => s["id"] === studentId))
    throw new Error("학생을 찾지 못했어요. 명단을 다시 적용해 주세요.");
  return {
    ...state,
    excluded: excluded ? [...new Set([...state.excluded, studentId])] : state.excluded.filter((id) => id !== studentId),
    pending: excluded && state.pending?.id === studentId ? null : state.pending,
  };
}
export function skip(state: PickerState): PickerState {
  if (!state.pending) throw new Error("먼저 발표자를 뽑아 주세요.");
  return { ...state, skipped: [...new Set([...state.skipped, state.pending.id])], pending: null };
}
export function complete(state: PickerState, eventId: string, completedAt: string): PickerState {
  if (state.events.some((e) => e["id"] === eventId)) return state;
  if (!state.pending || !available(state).some((s) => s["id"] === state.pending?.id))
    throw new Error("발표할 학생이 없어요. 먼저 발표자를 뽑아 주세요.");
  if (state.events.length >= MAX_EVENTS)
    throw new Error("완료 기록이 10,000건이에요. 기록을 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  if (!eventId || Number.isNaN(Date.parse(completedAt)))
    throw new Error("완료 기록을 만들지 못했어요. 다시 시도해 주세요.");
  return {
    ...state,
    events: [
      ...state.events,
      {
        id: eventId,
        studentId: state.pending.id,
        number: state.pending.number,
        name: state.pending.name,
        completedAt,
        round: state.round,
      },
    ],
    pending: null,
  };
}
export function undoCompletion(state: PickerState): PickerState {
  if (!state.events.length) throw new Error("되돌릴 발표 완료 기록이 없어요.");
  return { ...state, events: state.events.slice(0, -1), pending: null };
}
export function nextRound(state: PickerState): PickerState {
  return { ...state, round: state.round + 1, skipped: [], pending: null };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("저장 자료를 읽지 못했어요. 파일 형식을 확인해 주세요.");
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || !value.trim().length || hasControl(value))
    throw new Error("저장 자료의 글자 형식을 확인해 주세요.");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error("저장 자료의 숫자 범위를 확인해 주세요.");
  return value;
}
function student(value: unknown): Student {
  const s = record(value);
  return {
    id: boundedString(s["id"], 80),
    number: integer(s["number"], 1, 999999),
    name: boundedString(s["name"], 40),
    baseCount: integer(s["baseCount"], 0, 100000),
  };
}
/** Reject corrupt state instead of replacing saved work with empty defaults. */
export function decodeState(value: unknown): PickerState {
  const raw = record(value);
  if (
    raw["version"] !== 1 ||
    !Array.isArray(raw["students"]) ||
    raw["students"].length > 1000 ||
    !Array.isArray(raw["events"]) ||
    raw["events"].length > MAX_EVENTS
  )
    throw new Error("저장 자료의 버전·개수를 확인해 주세요.");
  const students = raw["students"].map(student);
  const ids = new Set(students.map((s) => s["id"]));
  if (ids.size !== students.length || new Set(students.map((s) => s["number"])).size !== students.length)
    throw new Error("저장 명단의 번호·식별자가 중복됐어요.");
  const idList = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length > 1000) throw new Error("저장 대상 목록을 확인해 주세요.");
    return v.map((x) => {
      const id = boundedString(x, 80);
      if (!ids.has(id)) throw new Error("저장 대상의 학생을 찾지 못했어요.");
      return id;
    });
  };
  const round = integer(raw["round"], 1, Number.MAX_SAFE_INTEGER - 1);
  const events = raw["events"].map((v) => {
    const e = record(v);
    const completedAt = boundedString(e["completedAt"], 40);
    if (Number.isNaN(Date.parse(completedAt))) throw new Error("완료 시각을 확인해 주세요.");
    return {
      id: boundedString(e["id"], 80),
      studentId: boundedString(e["studentId"], 80),
      number: integer(e["number"], 1, 999999),
      name: boundedString(e["name"], 40),
      completedAt,
      round: integer(e["round"], 1, round),
    };
  });
  if (new Set(events.map((e) => e["id"])).size !== events.length) throw new Error("완료 기록이 중복됐어요.");
  const pending = raw["pending"] === null ? null : student(raw["pending"]);
  const result: PickerState = {
    version: 1,
    label: boundedString(raw["label"], 80),
    students,
    excluded: idList(raw["excluded"]),
    skipped: idList(raw["skipped"]),
    round,
    pending,
    events,
  };
  if (
    pending &&
    !available(result).some(
      (s) =>
        s["id"] === pending.id &&
        s["name"] === pending.name &&
        s["number"] === pending.number &&
        s["baseCount"] === pending.baseCount,
    )
  )
    throw new Error("선정된 학생의 저장 정보를 확인해 주세요.");
  if (
    new Set(result.excluded).size !== result.excluded.length ||
    new Set(result.skipped).size !== result.skipped.length
  )
    throw new Error("대상 목록이 중복됐어요.");
  return result;
}
