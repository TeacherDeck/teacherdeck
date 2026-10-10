// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Keep pure logic in plain functions so it can be unit-tested without the host (MOD-015).

export interface Student {
  id: string;
  number: number;
  name: string;
}
export interface Group {
  id: number;
  members: string[];
}
export interface Snapshot {
  id: string;
  at: string;
  label: string;
  students: Student[];
  groups: Group[];
}
export interface GroupState {
  version: 1;
  label: string;
  students: Student[];
  excluded: string[];
  mode: "count" | "size";
  value: number;
  fixed: Record<string, number>;
  locked: Record<string, string[]>;
  pairs: [string, string][];
  groups: Group[];
  history: Snapshot[];
}
export function emptyState(): GroupState {
  return {
    version: 1,
    label: "이번 활동",
    students: [],
    excluded: [],
    mode: "size",
    value: 4,
    fixed: {},
    locked: {},
    pairs: [],
    groups: [],
    history: [],
  };
}
function control(v: string): boolean {
  return [...v].some((c) => c.charCodeAt(0) < 32);
}
export function parseRoster(
  text: string,
  previous: Student[] = [],
  newId: () => string = () => crypto.randomUUID(),
): Student[] {
  if (text.length > 100000) throw new Error("명단은 100,000자 이내로 입력해 주세요.");
  const students: Student[] = [],
    seen = new Set<number>();
  for (const line of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (/^(번호|학번|출석번호)[\t, ]+(이름|성명)$/.test(line)) continue;
    const m = line.match(/^(\d+)[.\t, ]+(.+)$/);
    let number: number, name: string;
    if (m) {
      number = Number(m[1]);
      name = (m[2] ?? "").trim();
    } else {
      number = 1;
      while (seen.has(number)) number++;
      name = line;
    }
    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > 999999 ||
      seen.has(number) ||
      !name ||
      name.length > 40 ||
      control(name)
    )
      throw new Error("번호는 서로 다르게, 이름은 1~40자로 적어 주세요.");
    seen.add(number);
    students.push({ id: previous.find((s) => s.number === number && s.name === name)?.id ?? newId(), number, name });
  }
  if (!students.length || students.length > 1000) throw new Error("학생을 1~1,000명 입력해 주세요.");
  return students.sort((a, b) => a.number - b.number);
}
export function parsePairs(text: string, students: Student[]): [string, string][] {
  if (text.length > 5000) throw new Error("분리 조건은 5,000자 이내로 입력해 주세요.");
  const pairs: [string, string][] = [],
    seen = new Set<string>();
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const cols = line.split(/[\t, ]+/);
    if (cols.length !== 2) throw new Error("한 줄에 분리할 학생 번호 두 개를 적어 주세요.");
    const a = students.find((s) => s.number === Number(cols[0])),
      b = students.find((s) => s.number === Number(cols[1]));
    if (!a || !b || a.id === b.id) throw new Error("분리 조건에는 명단에 있는 서로 다른 두 번호를 적어 주세요.");
    const key = JSON.stringify([a.id, b.id].sort());
    if (!seen.has(key)) {
      pairs.push([a.id, b.id]);
      seen.add(key);
    }
  }
  if (pairs.length > 200) throw new Error("분리 조건은 200쌍 이하로 적어 주세요.");
  return pairs;
}
export function participants(state: GroupState): Student[] {
  return state.students.filter((s) => !state.excluded.includes(s.id));
}
export function groupCount(state: GroupState): number {
  return state.mode === "count" ? state.value : Math.ceil(participants(state).length / state.value);
}
export function applySetup(
  state: GroupState,
  students: Student[],
  label: string,
  pairs: [string, string][],
  mode: "count" | "size",
  value: number,
): GroupState {
  if (!label.trim() || label.length > 80 || !Number.isInteger(value) || value < 1 || value > 1000)
    throw new Error("활동 이름과 1~1,000 사이의 모둠 수·인원을 확인해 주세요.");
  const ids = new Set(students.map((s) => s.id));
  return {
    ...state,
    label: label.trim(),
    students,
    pairs,
    mode,
    value,
    excluded: state.excluded.filter((id) => ids.has(id)),
    fixed: Object.fromEntries(Object.entries(state.fixed).filter(([id]) => ids.has(id))),
    locked: Object.fromEntries(
      Object.entries(state.locked).map(([group, members]) => [group, members.filter((id) => ids.has(id))]),
    ),
    groups: [],
  };
}
export function conditionErrors(state: GroupState): string[] {
  const errors: string[] = [],
    active = new Set(participants(state).map((s) => s.id)),
    count = groupCount(state),
    placed = new Map<string, number>();
  if (!active.size) errors.push("참여 학생이 없어요. 명단·제외 설정을 확인해 주세요.");
  if (count < 1 || count > 1000 || count > active.size) errors.push("모둠 수는 참여 학생 수 이하로 정해 주세요.");
  for (const [group, members] of Object.entries(state.locked)) {
    const number = Number(group);
    if (!Number.isInteger(number) || number < 1 || number > count)
      errors.push("고정 모둠이 새 설정에 없어요. 모둠 고정을 풀거나 모둠 수를 바꿔 주세요.");
    for (const id of members) {
      if (!active.has(id)) errors.push("고정 모둠에 제외된 학생이 있어요. 모둠 고정 또는 제외를 바꿔 주세요.");
      if (placed.has(id)) errors.push("한 학생이 두 모둠에 고정됐어요.");
      placed.set(id, number);
    }
  }
  for (const [id, group] of Object.entries(state.fixed)) {
    if (!active.has(id)) errors.push("고정 학생이 제외됐어요. 고정 또는 제외 설정을 바꿔 주세요.");
    if (group < 1 || group > count)
      errors.push("고정 모둠 번호가 새 설정에 없어요. 고정을 풀거나 모둠 수를 바꿔 주세요.");
    if (placed.has(id) && placed.get(id) !== group) errors.push("학생 고정과 모둠 고정이 충돌해요.");
    if (state.locked[String(group)] && !state.locked[String(group)]?.includes(id))
      errors.push("고정 모둠에는 새 학생을 넣을 수 없어요. 모둠 고정을 먼저 풀어 주세요.");
    placed.set(id, group);
  }
  for (const [a, b] of state.pairs)
    if (active.has(a) && active.has(b) && placed.has(a) && placed.get(a) === placed.get(b))
      errors.push("고정과 학생 분리 조건이 충돌해요.");
  if (Object.keys(state.locked).length === count && placed.size < active.size)
    errors.push("모든 모둠이 고정되어 남은 학생을 넣을 수 없어요. 모둠 고정을 풀어 주세요.");
  return [...new Set(errors)];
}
export function groupErrors(state: GroupState, groups: Group[] = state.groups): string[] {
  const errors = conditionErrors(state),
    active = new Set(participants(state).map((s) => s.id)),
    flat = groups.flatMap((g) => g.members);
  if (
    groups.length !== groupCount(state) ||
    new Set(groups.map((g) => g.id)).size !== groups.length ||
    groups.some((g) => g.id < 1 || g.id > groupCount(state))
  )
    errors.push("모둠 번호·개수를 확인해 주세요.");
  if (new Set(flat).size !== flat.length) errors.push("한 학생이 두 모둠에 들어갔어요.");
  if (flat.some((id) => !active.has(id)) || [...active].some((id) => !flat.includes(id)))
    errors.push("참여 학생이 빠지거나 제외 학생이 들어갔어요.");
  for (const [id, group] of Object.entries(state.fixed))
    if (!groups.find((g) => g.id === group)?.members.includes(id)) errors.push("학생 고정 조건이 바뀌었어요.");
  for (const [group, members] of Object.entries(state.locked)) {
    const actual = groups.find((g) => g.id === Number(group))?.members ?? [];
    if (actual.length !== members.length || members.some((id) => !actual.includes(id)))
      errors.push("고정 모둠의 구성원이 바뀌었어요.");
  }
  for (const [a, b] of state.pairs)
    if (groups.some((g) => g.members.includes(a) && g.members.includes(b)))
      errors.push("분리 학생이 같은 모둠에 있어요.");
  return [...new Set(errors)];
}
/** Bounded search preserves all teacher constraints. Balance is a preference after fixed groups. */
export function generate(state: GroupState, random: () => number = Math.random, budgetMs = 30): GroupState {
  const errors = conditionErrors(state);
  if (errors.length) throw new Error(errors.join(" "));
  const count = groupCount(state),
    groups: Group[] = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      members: [...(state.locked[String(i + 1)] ?? [])],
    })),
    assigned = new Set(groups.flatMap((g) => g.members));
  for (const [id, group] of Object.entries(state.fixed))
    if (!assigned.has(id)) {
      groups.find((g) => g.id === group)?.members.push(id);
      assigned.add(id);
    }
  const graph = new Map(participants(state).map((s) => [s.id, new Set<string>()]));
  for (const [a, b] of state.pairs) {
    graph.get(a)?.add(b);
    graph.get(b)?.add(a);
  }
  const remaining = participants(state)
      .filter((s) => !assigned.has(s.id))
      .map((s) => s.id)
      .sort((a, b) => (graph.get(b)?.size ?? 0) - (graph.get(a)?.size ?? 0)),
    deadline = Date.now() + Math.max(1, Math.min(budgetMs, 30));
  // Unconstrained rosters need no backtracking, even when several classes are combined.
  if (!state.pairs.length) {
    const unlocked = groups.filter((g) => !state.locked[String(g.id)]);
    for (let i = remaining.length - 1; i > 0; i--) {
      const value = random();
      if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("편성을 다시 시도해 주세요.");
      const j = Math.floor(value * (i + 1));
      const a = remaining[i],
        b = remaining[j];
      if (a === undefined || b === undefined) throw new Error("편성을 다시 시도해 주세요.");
      remaining[i] = b;
      remaining[j] = a;
    }
    for (const id of remaining) {
      const group = unlocked.reduce((best, g) => (g.members.length < best.members.length ? g : best));
      group.members.push(id);
    }
    return { ...state, groups };
  }
  // Most classroom separation graphs are sparse. Greedy coloring avoids deep search
  // for large rosters; any failure restarts from untouched teacher-fixed groups.
  const greedy = groups.map((g) => ({ ...g, members: [...g.members] }));
  const unlocked = greedy.filter((g) => !state.locked[String(g.id)]);
  for (let i = unlocked.length - 1; i > 0; i--) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("편성을 다시 시도해 주세요.");
    const j = Math.floor(value * (i + 1)),
      a = unlocked[i],
      b = unlocked[j];
    if (!a || !b) throw new Error("편성을 다시 시도해 주세요.");
    unlocked[i] = b;
    unlocked[j] = a;
  }
  const placement = new Map(greedy.flatMap((g) => g.members.map((id) => [id, g.id] as const)));
  let succeeded = true;
  for (const id of remaining) {
    const forbidden = new Set([...(graph.get(id) ?? [])].map((neighbor) => placement.get(neighbor)));
    let best: Group | undefined;
    for (const group of unlocked)
      if (!forbidden.has(group.id) && (!best || group.members.length < best.members.length)) best = group;
    if (!best) {
      succeeded = false;
      break;
    }
    best.members.push(id);
    placement.set(id, best.id);
  }
  if (succeeded) return { ...state, groups: greedy };
  let timeout = false,
    nodes = 0;
  const options = (id: string) =>
    groups.filter((g) => !state.locked[String(g.id)] && !g.members.some((other) => graph.get(id)?.has(other)));
  function search(left: string[]): boolean {
    if (!left.length) return true;
    if (++nodes > 20000 || Date.now() > deadline) {
      timeout = true;
      return false;
    }
    let chosen = left[0] ?? "",
      best = options(chosen);
    for (const id of left.length > 100 ? [] : left) {
      const candidate = options(id);
      if (
        candidate.length < best.length ||
        (candidate.length === best.length && (graph.get(id)?.size ?? 0) > (graph.get(chosen)?.size ?? 0))
      ) {
        chosen = id;
        best = candidate;
      }
    }
    if (!best.length) return false;
    const tied = best
      .map((group) => {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("편성을 다시 시도해 주세요.");
        return { group, value };
      })
      .sort((a, b) => a.group.members.length - b.group.members.length || a.value - b.value);
    const rest = left.filter((id) => id !== chosen);
    const empty = new Set<number>();
    for (const { group } of tied) {
      if (!group.members.length && !Object.values(state.fixed).includes(group.id)) {
        if (empty.has(0)) continue;
        empty.add(0);
      }
      group.members.push(chosen);
      if (search(rest)) return true;
      group.members.pop();
      if (timeout) return false;
    }
    return false;
  }
  if (!search(remaining))
    throw new Error(
      timeout
        ? "주어진 시간 안에 조건을 만족하는 편성을 찾지 못했어요. 다시 시도하거나 고정·분리 조건을 조정해 주세요."
        : "고정·분리 조건을 함께 만족할 수 없어요. 조건을 확인해 주세요.",
    );
  const issues = groupErrors(state, groups);
  if (issues.length) throw new Error(issues.join(" "));
  return { ...state, groups };
}
export function setStudentCondition(state: GroupState, id: string, excluded: boolean, group: number): GroupState {
  if (!state.students.some((s) => s.id === id) || !Number.isInteger(group) || group < 0 || group > 1000)
    throw new Error("학생·모둠 번호를 확인해 주세요.");
  const fixed = Object.fromEntries(Object.entries(state.fixed).filter(([sid]) => sid !== id));
  if (group) fixed[id] = group;
  return {
    ...state,
    excluded: excluded ? [...new Set([...state.excluded, id])] : state.excluded.filter((sid) => sid !== id),
    fixed,
    groups: [],
  };
}
export function toggleGroupLock(state: GroupState, group: number): GroupState {
  const key = String(group);
  if (state.locked[key])
    return { ...state, locked: Object.fromEntries(Object.entries(state.locked).filter(([id]) => id !== key)) };
  const found = state.groups.find((g) => g.id === group);
  if (!found || !found.members.length) throw new Error("먼저 편성한 모둠을 골라 주세요.");
  return { ...state, locked: { ...state.locked, [key]: [...found.members] } };
}
export function moveStudent(state: GroupState, id: string, group: number, swapId = ""): GroupState {
  const original = state.groups.find((g) => g.members.includes(id)),
    target = state.groups.find((g) => g.id === group);
  if (!original || !target) throw new Error("이동할 학생·모둠을 확인해 주세요.");
  if (original.id === group) return state;
  if (swapId && !target.members.includes(swapId)) throw new Error("교환할 학생이 선택 모둠에 없어요.");
  const groups = state.groups.map((g) => ({ ...g, members: g.members.filter((sid) => sid !== id && sid !== swapId) }));
  groups.find((g) => g.id === group)?.members.push(id);
  if (swapId) groups.find((g) => g.id === original.id)?.members.push(swapId);
  const errors = groupErrors(state, groups);
  if (errors.length) throw new Error(errors.join(" "));
  return { ...state, groups };
}
export function confirm(state: GroupState, id: string, at: string): GroupState {
  const errors = groupErrors(state);
  if (errors.length) throw new Error(errors.join(" "));
  const last = state.history.at(-1),
    key = JSON.stringify({ students: state.students, groups: state.groups });
  if (last && JSON.stringify({ students: last.students, groups: last.groups }) === key)
    throw new Error("이미 확정한 편성이에요. 새 이력을 추가하지 않았어요.");
  if (state.history.length >= 20) throw new Error("확정 기록이 20건이에요. 파일로 보관한 뒤 새 작업을 시작해 주세요.");
  if (!id || Number.isNaN(Date.parse(at))) throw new Error("확정 시각을 확인해 주세요.");
  return {
    ...state,
    history: [
      ...state.history,
      {
        id,
        at,
        label: state.label,
        students: state.students.map((s) => ({ ...s })),
        groups: state.groups.map((g) => ({ ...g, members: [...g.members] })),
      },
    ],
  };
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("기록 자료 형식을 확인해 주세요.");
  return v as Record<string, unknown>;
}
function str(v: unknown, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || control(v))
    throw new Error("기록 자료의 글자를 확인해 주세요.");
  return v;
}
function id(v: unknown): string {
  const value = str(v, 80);
  if (["__proto__", "constructor", "prototype"].includes(value)) throw new Error("기록 자료의 식별자를 확인해 주세요.");
  return value;
}
function num(v: unknown, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
    throw new Error("기록 자료의 숫자를 확인해 주세요.");
  return v;
}
function list(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Error("기록 자료의 개수를 확인해 주세요.");
  return v;
}
function studentsOf(v: unknown): Student[] {
  const students = list(v, 1000).map((v) => {
    const s = obj(v);
    return { id: id(s["id"]), number: num(s["number"], 1, 999999), name: str(s["name"], 40) };
  });
  if (
    new Set(students.map((s) => s.id)).size !== students.length ||
    new Set(students.map((s) => s.number)).size !== students.length
  )
    throw new Error("기록 명단이 중복됐어요.");
  return students;
}
function groupsOf(v: unknown): Group[] {
  return list(v, 1000).map((v) => {
    const g = obj(v);
    return { id: num(g["id"], 1, 1000), members: list(g["members"], 1000).map(id) };
  });
}
export function decodeState(v: unknown): GroupState {
  const raw = obj(v);
  if (raw["version"] !== 1 || (raw["mode"] !== "count" && raw["mode"] !== "size"))
    throw new Error("기록 파일 버전·편성 방식을 확인해 주세요.");
  const students = studentsOf(raw["students"]),
    ids = new Set(students.map((s) => s.id)),
    excluded = list(raw["excluded"], 1000).map(id);
  if (excluded.some((sid) => !ids.has(sid)) || new Set(excluded).size !== excluded.length)
    throw new Error("제외 명단을 확인해 주세요.");
  const fixed = Object.fromEntries(Object.entries(obj(raw["fixed"])).map(([sid, g]) => [id(sid), num(g, 1, 1000)])),
    locked = Object.fromEntries(
      Object.entries(obj(raw["locked"])).map(([g, members]) => [
        String(num(Number(g), 1, 1000)),
        list(members, 1000).map(id),
      ]),
    );
  if (Object.keys(obj(raw["locked"])).some((key) => key !== String(Number(key))))
    throw new Error("고정 모둠 번호를 확인해 주세요.");
  if (
    Object.keys(fixed).length > 1000 ||
    Object.keys(locked).length > 1000 ||
    Object.keys(fixed).some((sid) => !ids.has(sid)) ||
    Object.values(locked).some(
      (members) => members.some((sid) => !ids.has(sid)) || new Set(members).size !== members.length,
    )
  )
    throw new Error("학생·모둠 고정 정보를 확인해 주세요.");
  const pairs: [string, string][] = list(raw["pairs"], 200).map((v) => {
    const pair = list(v, 2),
      a = id(pair[0]),
      b = id(pair[1]);
    if (pair.length !== 2 || a === b || !ids.has(a) || !ids.has(b)) throw new Error("학생 분리 조건을 확인해 주세요.");
    return [a, b];
  });
  const history = list(raw["history"], 20).map((v) => {
    const h = obj(v),
      at = str(h["at"], 40),
      students = studentsOf(h["students"]),
      groups = groupsOf(h["groups"]),
      known = new Set(students.map((s) => s.id)),
      flat = groups.flatMap((g) => g.members);
    if (
      Number.isNaN(Date.parse(at)) ||
      new Set(groups.map((g) => g.id)).size !== groups.length ||
      new Set(flat).size !== flat.length ||
      flat.some((sid) => !known.has(sid))
    )
      throw new Error("확정 이력의 형식을 확인해 주세요.");
    return { id: id(h["id"]), at, label: str(h["label"], 80), students, groups };
  });
  if (new Set(history.map((h) => h.id)).size !== history.length) throw new Error("확정 이력이 중복됐어요.");
  const state: GroupState = {
    version: 1,
    label: str(raw["label"], 80),
    students,
    excluded,
    mode: raw["mode"],
    value: num(raw["value"], 1, 1000),
    fixed,
    locked,
    pairs,
    groups: groupsOf(raw["groups"]),
    history,
  };
  if (state.groups.length && groupErrors(state).length) throw new Error("저장 편성의 조건을 확인해 주세요.");
  return state;
}
