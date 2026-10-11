// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error("배치 자료의 범위를 확인해 주세요.");
  return value;
}
function hasControl(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32);
}
function findStudent(students: Student[], id: string): Student {
  const found = students.find((s) => s.id === id);
  if (!found) throw new Error("명단에 없는 학생이에요.");
  return found;
}
export interface Student {
  id: string;
  number: number;
  name: string;
}
export interface Layout {
  rows: number;
  columns: number;
  aisles: number[];
  blocked: number[];
  frontRows: number;
}
export interface Rules {
  fixed: Record<string, number>;
  excluded: string[];
  front: string[];
  separated: [string, string][];
  avoidPreviousSeat: boolean;
  avoidPreviousNeighbor: boolean;
}
export interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
  layout: Layout;
  seats: (Student | null)[];
}
export interface SeatState {
  version: 1;
  label: string;
  students: Student[];
  layout: Layout;
  rules: Rules;
  preview: (string | null)[] | null;
  history: Snapshot[];
}
export function emptyState(): SeatState {
  return {
    version: 1,
    label: "이번 수업",
    students: [],
    layout: { rows: 5, columns: 6, aisles: [], blocked: [], frontRows: 1 },
    rules: { fixed: {}, excluded: [], front: [], separated: [], avoidPreviousSeat: true, avoidPreviousNeighbor: true },
    preview: null,
    history: [],
  };
}
export function parseRoster(
  text: string,
  previous: Student[] = [],
  newId: () => string = () => crypto.randomUUID(),
): Student[] {
  if (text.length > 250000) throw new Error("명단은 250,000자 이내로 입력해 주세요.");
  const result: Student[] = [];
  for (const line of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (/^(번호|학번|출석번호)[\t, ]+(이름|성명)$/.test(line)) continue;
    const match = /^(\d+)[\t,. ]+(.+)$/.exec(line);
    if (!match) throw new Error("학생마다 번호와 이름을 한 줄에 입력해 주세요.");
    const number = Number(match[1]);
    const name = (match[2] ?? "").trim();
    if (!Number.isInteger(number) || number < 1 || number > 999999 || result.some((s) => s.number === number))
      throw new Error("중복된 번호나 잘못된 번호를 확인해 주세요.");
    if (!name || name.length > 80 || name.includes(",") || hasControl(name))
      throw new Error("이름은 80자 이내로 입력해 주세요.");
    result.push({ id: previous.find((s) => s.number === number && s.name === name)?.id ?? newId(), number, name });
  }
  if (!result.length || result.length > 1000) throw new Error("명단은 1~1000명으로 입력해 주세요.");
  return result;
}
export function replaceRoster(state: SeatState, students: Student[], label: string): SeatState {
  if (label.trim().length > 80 || hasControl(label)) throw new Error("배치 이름은 80자 이내로 입력해 주세요.");
  const ids = new Set(students.map((s) => s.id));
  return {
    ...state,
    label: label.trim() || "이번 수업",
    students,
    preview: null,
    rules: {
      ...state.rules,
      fixed: Object.fromEntries(Object.entries(state.rules.fixed).filter(([id]) => ids.has(id))),
      excluded: state.rules.excluded.filter((id) => ids.has(id)),
      front: state.rules.front.filter((id) => ids.has(id)),
      separated: state.rules.separated.filter(([a, b]) => ids.has(a) && ids.has(b)),
    },
  };
}
export function seatLabel(seat: number, columns: number): string {
  return `${Math.floor(seat / columns) + 1}행 ${(seat % columns) + 1}열`;
}
export function resizeLayout(state: SeatState, patch: Partial<Layout>): SeatState {
  let layout = { ...state.layout, ...patch },
    fixed = { ...state.rules.fixed };
  if (patch.columns !== undefined && patch.columns !== state.layout.columns) {
    const columns = patch.columns,
      translate = (seat: number) => {
        const row = Math.floor(seat / state.layout.columns),
          column = seat % state.layout.columns;
        if (column >= columns)
          throw new Error("새 열 수에서 고정하거나 비워둘 자리가 사라져요. 해당 조건을 먼저 직접 바꿔 주세요.");
        return row * columns + column;
      };
    fixed = Object.fromEntries(Object.entries(fixed).map(([id, seat]) => [id, translate(seat)]));
    layout = { ...layout, blocked: state.layout.blocked.map(translate) };
  }
  validateLayout(layout);
  return { ...state, layout, rules: { ...state.rules, fixed }, preview: null };
}
export function neighboring(a: number, b: number, layout: Layout): boolean {
  const ar = Math.floor(a / layout.columns),
    br = Math.floor(b / layout.columns),
    ac = a % layout.columns,
    bc = b % layout.columns;
  // Original hard separation includes diagonal proximity even across an aisle.
  return a !== b && Math.max(Math.abs(ar - br), Math.abs(ac - bc)) <= 1;
}
function neighborPairs(layout: Layout, seats: (string | null)[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    const a = seats[i],
      b = seats[i + 1];
    if (a && b && i % layout.columns < layout.columns - 1 && !layout.aisles.includes((i % layout.columns) + 1))
      pairs.add([a, b].sort().join("|"));
  }
  return pairs;
}
export function isConfirmed(state: SeatState): boolean {
  const latest = state.history.at(-1);
  return Boolean(
    latest &&
    state.preview &&
    JSON.stringify(latest.layout) === JSON.stringify(state.layout) &&
    JSON.stringify(latest.seats) ===
      JSON.stringify(state.preview.map((id) => (id === null ? null : state.students.find((s) => s.id === id)))),
  );
}
export function comparison(state: SeatState): {
  same: number;
  moved: number;
  repeatedNeighbors: number;
  comparable: boolean;
  hasReference: boolean;
} {
  const last = state.history.at(isConfirmed(state) ? -2 : -1);
  if (!last || !state.preview)
    return { same: 0, moved: 0, repeatedNeighbors: 0, comparable: false, hasReference: false };
  const sameSize = last.layout.rows === state.layout.rows && last.layout.columns === state.layout.columns;
  let same = 0,
    moved = 0;
  if (sameSize)
    state.preview.forEach((id, i) => {
      if (!id) return;
      const previous = last.seats.findIndex((s) => s?.id === id);
      if (previous < 0) return;
      if (previous === i) same++;
      else moved++;
    });
  const oldPairs = neighborPairs(
    last.layout,
    last.seats.map((s) => s?.id ?? null),
  );
  return {
    same,
    moved,
    comparable: sameSize,
    hasReference: true,
    repeatedNeighbors: [...neighborPairs(state.layout, state.preview)].filter((p) => oldPairs.has(p)).length,
  };
}
export function validateLayout(layout: Layout): void {
  if (
    ![layout.rows, layout.columns, layout.frontRows].every(Number.isInteger) ||
    layout.rows < 1 ||
    layout.rows > 100 ||
    layout.columns < 1 ||
    layout.columns > 100 ||
    layout.rows * layout.columns > 1000 ||
    layout.frontRows < 1 ||
    layout.frontRows > layout.rows
  )
    throw new Error("행과 열은 1~100, 전체 자리는 1000개 이하로 설정해 주세요. 앞줄 범위는 전체 행 이내예요.");
  const count = layout.rows * layout.columns;
  if (
    new Set(layout.blocked).size !== layout.blocked.length ||
    layout.blocked.some((n) => !Number.isInteger(n) || n < 0 || n >= count)
  )
    throw new Error("비워둘 자리가 교실 범위를 벗어났어요. 행과 열 또는 비워둘 자리를 확인해 주세요.");
  if (
    new Set(layout.aisles).size !== layout.aisles.length ||
    layout.aisles.some((n) => !Number.isInteger(n) || n < 1 || n >= layout.columns)
  )
    throw new Error("통로는 마지막 열을 제외한 열 번호로 입력해 주세요.");
}
export function validateRules(state: SeatState): void {
  validateLayout(state.layout);
  const { rules, layout } = state,
    ids = new Set(state.students.map((s) => s.id));
  const references = [...Object.keys(rules.fixed), ...rules.excluded, ...rules.front, ...rules.separated.flat()];
  if (references.some((id) => !ids.has(id))) throw new Error("명단에 없는 학생의 조건이 있어요.");
  if ([rules.excluded, rules.front].some((list) => new Set(list).size !== list.length))
    throw new Error("중복된 학생 조건을 확인해 주세요.");
  const fixedSeats = Object.values(rules.fixed);
  if (new Set(fixedSeats).size !== fixedSeats.length)
    throw new Error("같은 자리에 두 학생이 고정되어 있어요. 고정 자리를 바꿔 주세요.");
  for (const [id, seat] of Object.entries(rules.fixed)) {
    if (rules.excluded.includes(id))
      throw new Error("고정한 학생이 배치 제외에도 선택되어 있어요. 두 조건 중 하나를 직접 바꿔 주세요.");
    if (!Number.isInteger(seat) || seat < 0 || seat >= layout.rows * layout.columns || layout.blocked.includes(seat))
      throw new Error("고정 자리가 비워둘 자리이거나 교실 밖이에요. 고정 조건을 확인해 주세요.");
    if (rules.front.includes(id) && seat >= layout.frontRows * layout.columns)
      throw new Error("앞줄 학생이 뒷줄에 고정되어 있어요. 고정 자리나 앞줄 범위를 바꿔 주세요.");
  }
  const active = state.students.filter((s) => !rules.excluded.includes(s.id));
  if (!active.length) throw new Error("배치할 학생이 없어요. 명단과 제외 조건을 확인해 주세요.");
  if (active.length > layout.rows * layout.columns - layout.blocked.length)
    throw new Error("학생 수보다 사용 가능한 자리가 적어요. 행·열 또는 비워둘 자리를 바꿔 주세요.");
  const availableFront = Array.from({ length: layout.frontRows * layout.columns }, (_, i) => i).filter(
    (i) => !layout.blocked.includes(i) && !fixedSeats.includes(i),
  ).length;
  const pendingFront = active.filter((s) => rules.front.includes(s.id) && rules.fixed[s.id] === undefined).length;
  if (pendingFront > availableFront)
    throw new Error("앞줄 조건을 지킬 자리가 부족해요. 앞줄 범위나 고정 조건을 바꿔 주세요.");
  const seen = new Set<string>();
  for (const [a, b] of rules.separated) {
    const key = [a, b].sort().join("|");
    if (a === b || seen.has(key)) throw new Error("떨어뜨릴 학생은 서로 다른 두 학생으로 한 번만 지정해 주세요.");
    seen.add(key);
    if (
      rules.fixed[a] !== undefined &&
      rules.fixed[b] !== undefined &&
      neighboring(rules.fixed[a] ?? -1, rules.fixed[b] ?? -1, layout)
    )
      throw new Error("떨어뜨릴 두 학생이 이웃 자리에 고정되어 있어요. 고정 자리를 바꿔 주세요.");
  }
}
export function validateSeats(state: SeatState, seats: (string | null)[]): void {
  validateRules(state);
  if (seats.length !== state.layout.rows * state.layout.columns) throw new Error("배치 크기가 교실과 맞지 않아요.");
  const assigned = seats.filter((id): id is string => id !== null);
  const excluded = new Set(state.rules.excluded),
    active = new Set(state.students.filter((s) => !excluded.has(s.id)).map((s) => s.id));
  if (
    new Set(assigned).size !== assigned.length ||
    assigned.length !== active.size ||
    assigned.some((id) => !active.has(id))
  )
    throw new Error("학생이 중복되거나 빠진 배치예요. 다시 배치해 주세요.");
  for (let seat = 0; seat < seats.length; seat++) {
    const id = seats[seat];
    if (!id) continue;
    if (state.layout.blocked.includes(seat)) throw new Error("비워둘 자리는 사용할 수 없어요.");
    if (state.rules.fixed[id] !== undefined && state.rules.fixed[id] !== seat)
      throw new Error("고정 학생은 다른 자리로 옮길 수 없어요.");
    if (state.rules.front.includes(id) && seat >= state.layout.frontRows * state.layout.columns)
      throw new Error("앞줄 학생은 앞줄 범위 안에서만 옮길 수 있어요.");
  }
  const positions = new Map(seats.map((id, index) => [id, index]));
  for (const [a, b] of state.rules.separated) {
    const as = positions.get(a) ?? -1,
      bs = positions.get(b) ?? -1;
    if (as >= 0 && bs >= 0 && neighboring(as, bs, state.layout))
      throw new Error("떨어뜨릴 두 학생은 앞뒤·좌우·대각선 이웃 자리에 둘 수 없어요.");
  }
}
function shuffle<T>(values: T[], random: () => number): T[] {
  const list = [...values];
  for (let i = list.length - 1; i > 0; i--) {
    const sample = random();
    if (!(sample >= 0 && sample < 1)) throw new Error("배치 난수를 확인해 주세요.");
    const j = Math.floor(sample * (i + 1));
    [list[i], list[j]] = [at(list, j), at(list, i)];
  }
  return list;
}
export function arrange(state: SeatState, random: () => number = Math.random, budget = 5000): SeatState {
  validateRules(state);
  const { layout, rules } = state;
  const seats: (string | null)[] = Array.from({ length: layout.rows * layout.columns }, () => null);
  for (const [id, seat] of Object.entries(rules.fixed)) seats[seat] = id;
  const pending = shuffle(
    state.students.filter((s) => !rules.excluded.includes(s.id) && rules.fixed[s.id] === undefined),
    random,
  ).sort((a, b) => Number(rules.front.includes(b.id)) - Number(rules.front.includes(a.id)));
  const cells = shuffle(
    seats.map((_, i) => i).filter((i) => !layout.blocked.includes(i) && !seats[i]),
    random,
  );
  // Large unconstrained classes use linear queues instead of permutation search.
  if (!rules.separated.length) {
    const frontCells = cells.filter((i) => i < layout.frontRows * layout.columns),
      backCells = cells.filter((i) => i >= layout.frontRows * layout.columns);
    const taken = new Set<number>();
    let nextFront = 0;
    for (const student of pending.filter((s) => rules.front.includes(s.id))) {
      const seat = at(frontCells, nextFront++);
      seats[seat] = student.id;
      taken.add(seat);
    }
    const remaining = [...frontCells.filter((i) => !taken.has(i)), ...backCells];
    let next = 0;
    for (const student of pending.filter((s) => !rules.front.includes(s.id))) seats[at(remaining, next++)] = student.id;
  }
  let checks = 0;
  const frontChoices = cells.filter((seat) => seat < layout.frontRows * layout.columns);
  const positions = new Map(Object.entries(rules.fixed));
  const partners = new Map<string, string[]>();
  for (const [a, b] of rules.separated) {
    partners.set(a, [...(partners.get(a) ?? []), b]);
    partners.set(b, [...(partners.get(b) ?? []), a]);
  }
  function search(index: number): boolean {
    if (index === pending.length) return true;
    const student = at(pending, index);
    for (const seat of rules.front.includes(student.id) ? frontChoices : cells) {
      if (seats[seat]) continue;
      if (++checks > budget) throw new Error("SEARCH_LIMIT");
      if (rules.front.includes(student.id) && seat >= layout.frontRows * layout.columns) continue;
      if (
        (partners.get(student.id) ?? []).some((other) => {
          const at = positions.get(other) ?? -1;
          return at >= 0 && neighboring(seat, at, layout);
        })
      )
        continue;
      seats[seat] = student.id;
      positions.set(student.id, seat);
      if (search(index + 1)) return true;
      seats[seat] = null;
      positions.delete(student.id);
    }
    return false;
  }
  try {
    if (rules.separated.length && !search(0))
      throw new Error("현재 조건으로 배치할 수 없어요. 고정·앞줄·분리 조건을 직접 확인해 주세요.");
  } catch (error) {
    if (error instanceof Error && error.message === "SEARCH_LIMIT")
      throw new Error(
        "조건 탐색 한도에 도달했어요. 다시 배치하거나 조건을 직접 조정해 주세요. 조건은 그대로 유지했어요.",
        { cause: error },
      );
    throw error;
  }
  validateSeats(state, seats);
  // Soft preferences may improve an allocation; all hard constraints remain mandatory.
  const old = state.history.at(-1);
  if (old && (rules.avoidPreviousSeat || rules.avoidPreviousNeighbor)) {
    const previousPairs = neighborPairs(
      old.layout,
      old.seats.map((s) => s?.id ?? null),
    );
    const sameSize = old.layout.rows === layout.rows && old.layout.columns === layout.columns;
    const score = () =>
      (rules.avoidPreviousSeat && sameSize
        ? seats.reduce<number>((n, id, i) => n + (id && old.seats[i]?.id === id ? 100 : 0), 0)
        : 0) +
      (rules.avoidPreviousNeighbor
        ? [...neighborPairs(layout, seats)].filter((pair) => previousPairs.has(pair)).length * 35
        : 0);
    let best = score();
    const movable = cells.filter((i) => !seats[i] || rules.fixed[seats[i] ?? ""] === undefined);
    for (let attempt = 0; attempt < (state.students.length > 100 ? 20 : 200) && movable.length > 1; attempt++) {
      const a = at(movable, Math.floor(random() * movable.length)),
        b = at(movable, Math.floor(random() * movable.length));
      if (a === b) continue;
      [seats[a], seats[b]] = [at(seats, b), at(seats, a)];
      let valid = true;
      try {
        validateSeats(state, seats);
      } catch {
        valid = false;
      }
      const next = valid ? score() : Infinity;
      if (next <= best) best = next;
      else [seats[a], seats[b]] = [at(seats, b), at(seats, a)];
    }
  }
  return { ...state, preview: seats };
}
export function swapSeats(state: SeatState, a: number, b: number): SeatState {
  const current = state.preview;
  if (!current || ![a, b].every((n) => Number.isInteger(n) && n >= 0 && n < current.length))
    throw new Error("먼저 미리보기를 만들어 주세요.");
  if (state.layout.blocked.includes(a) || state.layout.blocked.includes(b))
    throw new Error("비워둘 자리는 교환할 수 없어요.");
  if (!current[a] && !current[b]) throw new Error("먼저 학생이 있는 자리를 선택해 주세요.");
  const preview = [...current];
  [preview[a], preview[b]] = [at(preview, b), at(preview, a)];
  validateSeats(state, preview);
  return { ...state, preview };
}
export function confirm(
  state: SeatState,
  id: string = crypto.randomUUID(),
  createdAt = new Date().toISOString(),
): SeatState {
  if (!state.preview) throw new Error("먼저 배치 미리보기를 만들어 주세요.");
  validateSeats(state, state.preview);
  const latest = state.history.at(-1);
  if (
    latest &&
    JSON.stringify(latest.layout) === JSON.stringify(state.layout) &&
    JSON.stringify(latest.seats) ===
      JSON.stringify(state.preview.map((id) => (id === null ? null : state.students.find((s) => s.id === id))))
  )
    throw new Error("이미 확정한 배치예요. 새 이력은 추가하지 않았어요.");
  if (state.history.length >= 100) throw new Error("확정 기록이 100개예요. 파일로 보관하고 새 작업을 시작해 주세요.");
  const snapshot: Snapshot = {
    id,
    createdAt,
    label: state.label,
    layout: structuredClone(state.layout),
    seats: state.preview.map((id) => (id === null ? null : { ...findStudent(state.students, id) })),
  };
  return { ...state, history: [...state.history, snapshot] };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("자리 배치 자료 형식을 확인해 주세요.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 100): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || hasControl(value))
    throw new Error("자리 배치 글자 자료를 확인해 주세요.");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error("자리 배치 숫자 자료를 확인해 주세요.");
  return value;
}
function array(value: unknown, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("자리 배치 목록 크기를 확인해 주세요.");
  return value;
}
function identity(value: unknown): string {
  const id = text(value);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id))
    throw new Error("학생 식별자를 확인해 주세요.");
  return id;
}
function student(value: unknown): Student {
  const o = object(value);
  return { id: identity(o["id"]), number: integer(o["number"], 1, 999999), name: text(o["name"], 80) };
}
function layout(value: unknown): Layout {
  const o = object(value);
  const result = {
    rows: integer(o["rows"], 1, 100),
    columns: integer(o["columns"], 1, 100),
    frontRows: integer(o["frontRows"], 1, 100),
    aisles: array(o["aisles"]).map((n) => integer(n, 1, 99)),
    blocked: array(o["blocked"]).map((n) => integer(n, 0, 999)),
  };
  validateLayout(result);
  return result;
}
export function decodeState(value: unknown): SeatState {
  const o = object(value);
  if (o["version"] !== 1) throw new Error("지원하는 자리 배치 자료가 아니에요.");
  const students = array(o["students"]).map(student);
  if (
    new Set(students.map((s) => s.id)).size !== students.length ||
    new Set(students.map((s) => s.number)).size !== students.length
  )
    throw new Error("중복 학생 자료를 확인해 주세요.");
  const r = object(o["rules"]);
  const fixed = Object.fromEntries(
    Object.entries(object(r["fixed"])).map(([id, n]) => [identity(id), integer(n, 0, 999)]),
  );
  if (typeof r["avoidPreviousSeat"] !== "boolean" || typeof r["avoidPreviousNeighbor"] !== "boolean")
    throw new Error("반복 조건을 확인해 주세요.");
  const rules: Rules = {
    fixed,
    avoidPreviousSeat: r["avoidPreviousSeat"],
    avoidPreviousNeighbor: r["avoidPreviousNeighbor"],
    excluded: array(r["excluded"]).map((id) => text(id)),
    front: array(r["front"]).map((id) => text(id)),
    separated: array(r["separated"]).map((pair) => {
      const p = array(pair, 2);
      if (p.length !== 2) throw new Error("분리 조건을 확인해 주세요.");
      return [text(p[0]), text(p[1])];
    }),
  };
  const state: SeatState = {
    version: 1,
    label: text(o["label"], 80),
    students,
    layout: layout(o["layout"]),
    rules,
    preview: o["preview"] === null ? null : array(o["preview"]).map((id) => (id === null ? null : identity(id))),
    history: array(o["history"], 100).map((value) => {
      const h = object(value);
      const l = layout(h["layout"]);
      const seats = array(h["seats"]).map((s) => (s === null ? null : student(s)));
      if (
        seats.length !== l.rows * l.columns ||
        l.blocked.some((i) => seats[i] !== null) ||
        new Set(seats.filter((s): s is Student => s !== null).map((s) => s.id)).size !== seats.filter(Boolean).length ||
        new Set(seats.filter((s): s is Student => s !== null).map((s) => s.number)).size !==
          seats.filter(Boolean).length
      )
        throw new Error("확정 배치 자료를 확인해 주세요.");
      const createdAt = text(h["createdAt"]);
      if (!Number.isFinite(Date.parse(createdAt))) throw new Error("확정 날짜를 확인해 주세요.");
      return { id: text(h["id"]), label: text(h["label"], 80), createdAt, layout: l, seats };
    }),
  };
  if (new Set(state.history.map((h) => h.id)).size !== state.history.length)
    throw new Error("중복 확정 기록을 확인해 주세요.");
  // Conflicting teacher choices remain editable and survive storage; only actual allocations must pass rules.
  const ids = new Set(students.map((s) => s.id));
  if (
    [...Object.keys(rules.fixed), ...rules.excluded, ...rules.front, ...rules.separated.flat()].some(
      (id) => !ids.has(id),
    )
  )
    throw new Error("학생 조건 자료를 확인해 주세요.");
  if (state.preview) validateSeats(state, state.preview);
  return state;
}
