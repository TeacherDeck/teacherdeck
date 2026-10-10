// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Teacher {
  id: string;
  name: string;
  past: number;
  excluded: number[];
  weekdays: number[];
  fixed: number[];
  participating?: boolean;
  slotWeekdays?: number[][];
}
export interface PlanInput {
  year: number;
  month: number;
  perDay: number;
  weekends: boolean;
  excluded: number[];
  teachers: Teacher[];
  manual: Record<string, string[]>;
  holidays: Record<string, string>;
  exam?: number[];
}
export interface Day {
  day: number;
  weekday: number;
  date: string;
  excluded: boolean;
  reason: string;
}
export interface PlanResult {
  assignments: Record<string, string[]>;
  issues: string[];
}
export const MAX_TEACHERS = 500;
export function eligibleSlot(teacher: Teacher, weekday: number, slot: number): boolean {
  return teacher.slotWeekdays?.[slot]?.includes(weekday) ?? true;
}
export function averagePast(teachers: Teacher[]): number {
  const participating = teachers.filter((t) => t.participating !== false);
  return participating.length
    ? Math.round((participating.reduce((sum, t) => sum + t.past, 0) / participating.length) * 10) / 10
    : 0;
}
export function validPast(value: number): boolean {
  return (
    Number.isFinite(value) && value >= 0 && value <= 100000 && Math.abs(value * 10 - Math.round(value * 10)) < 1e-7
  );
}
export function slotsForDay(input: PlanInput, day: number): number {
  return input.exam?.includes(day) ? 1 : input.perDay;
}
export function calendar(input: PlanInput): Day[] {
  if (
    !Number.isInteger(input.year) ||
    input.year < 1900 ||
    input.year > 2100 ||
    !Number.isInteger(input.month) ||
    input.month < 1 ||
    input.month > 12
  )
    return [];
  const length = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  return Array.from({ length }, (_, index) => {
    const day = index + 1;
    const weekday = new Date(Date.UTC(input.year, input.month - 1, day)).getUTCDay();
    const date = `${input.year}-${String(input.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const holiday = input.holidays[date];
    const reason = input.excluded.includes(day)
      ? "직접 제외"
      : (holiday ?? (input.weekends && (weekday === 0 || weekday === 6) ? "주말" : ""));
    return { day, weekday, date, excluded: reason !== "", reason };
  });
}
export function parseDays(text: string): number[] | null {
  if (text.trim() === "") return [];
  const parts = text
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 1 && n <= 31)
    ? [...new Set(parts)].sort((a, b) => a - b)
    : null;
}
export function parseRoster(text: string, previous: Teacher[]): Teacher[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0 || lines.length > MAX_TEACHERS) return null;
  const names = new Set<string>();
  const teachers: Teacher[] = [];
  for (const line of lines) {
    const [name = "", count = "0", ...extra] = line.split(/[\t,]/).map((s) => s.trim());
    const past = Number(count);
    if (!name || name.length > 100 || names.has(name) || extra.length > 0 || !validPast(past)) return null;
    names.add(name);
    const old = previous.find((t) => t.name === name);
    let nextId = teachers.length;
    while ([...previous, ...teachers].some((t) => t.id === `teacher-${nextId}`)) nextId++;
    teachers.push({
      id: old?.id ?? `teacher-${nextId}`,
      name,
      past,
      excluded: old?.excluded ?? [],
      weekdays: old?.weekdays ?? [],
      fixed: old?.fixed ?? [],
      participating: old?.participating ?? true,
      ...(old?.slotWeekdays ? { slotWeekdays: old.slotWeekdays } : {}),
    });
  }
  return teachers;
}
interface Edge {
  to: number;
  reverse: number;
  capacity: number;
  cost: number;
}
/** Exact convex min-cost flow: squared cumulative totals, under all fixed/excluded constraints. */
export function plan(input: PlanInput): PlanResult {
  const assignments: Record<string, string[]> = {};
  const issues: string[] = [];
  const days = calendar(input);
  if (
    !days.length ||
    !Number.isInteger(input.perDay) ||
    input.perDay < 1 ||
    input.perDay > 3 ||
    !input.teachers.length ||
    input.teachers.length > MAX_TEACHERS
  )
    return { assignments, issues: ["연도·월·하루 인원·명단을 확인해 주세요."] };
  if (
    new Set(input.teachers.map((t) => t.id)).size !== input.teachers.length ||
    input.teachers.some((t) => !validPast(t.past))
  )
    return { assignments, issues: ["명단의 식별자와 과거 횟수를 확인해 주세요."] };
  const fixedCounts = input.teachers.map(() => 0);
  if (
    input.teachers.some((t) => t.fixed.some((d) => !days.some((day) => day.day === d))) ||
    Object.keys(input.manual).some((key) => !days.some((d) => String(d.day) === key))
  )
    return {
      assignments: {},
      issues: ["이 달에 없는 날짜의 고정·직접 배정이 있어요. 해당 날짜 조건을 수정해 주세요."],
    };
  const eligible = (t: Teacher, d: Day) =>
    t.participating !== false && !t.excluded.includes(d.day) && !t.weekdays.includes(d.weekday);
  for (const d of days) {
    const fixed = input.teachers.filter((t) => t.fixed.includes(d.day)).map((t) => t.id);
    const manual = input.manual[String(d.day)];
    const selected = [...new Set([...(manual ?? []), ...fixed])];
    if (
      manual !== undefined &&
      (new Set(manual).size !== manual.length ||
        selected.length !== manual.length ||
        manual.length !== slotsForDay(input, d.day))
    )
      issues.push(`${d.day}일 직접 배정은 하루 인원과 모든 고정 배정을 포함해야 해요.`);
    if (selected.length > slotsForDay(input, d.day))
      issues.push(`${d.day}일 고정 배정이 하루 인원을 넘어요. 고정 조건을 조정해 주세요.`);
    if (d.excluded && selected.length)
      issues.push(`${d.day}일 제외와 고정·직접 배정이 겹쳐요. 조건을 직접 조정해 주세요.`);
    for (const id of selected) {
      const index = input.teachers.findIndex((t) => t.id === id);
      const teacher = input.teachers[index];
      if (!teacher) issues.push(`${d.day}일 명단에 없는 배정이 있어요. 직접 배정을 수정해 주세요.`);
      else if (!eligible(teacher, d))
        issues.push(`${d.day}일 교사 제외 조건과 고정·직접 배정이 겹쳐요. 조건을 조정해 주세요.`);
      else fixedCounts[index] = (fixedCounts[index] ?? 0) + 1;
    }
    const slotted = Array.from({ length: slotsForDay(input, d.day) }, () => "");
    function place(index: number): boolean {
      const id = selected[index];
      if (id === undefined) return true;
      const t = input.teachers.find((x) => x.id === id);
      if (!t) return false;
      for (let slot = 0; slot < slotted.length; slot++) {
        if (slotted[slot] || (manual && slot !== index) || !eligibleSlot(t, d.weekday, slot)) continue;
        slotted[slot] = id;
        if (place(index + 1)) return true;
        slotted[slot] = "";
      }
      return false;
    }
    if (!d.excluded && !place(0))
      issues.push(`${d.day}일 순번별 허용 요일과 고정·직접 배정이 겹쳐요. 순번 조건을 조정해 주세요.`);
    assignments[String(d.day)] = d.excluded ? [] : manual ? slotted : slotted.map(() => "");
  }
  if (issues.length) return { assignments: {}, issues };
  const teacherOffset = 1;
  const dayOffset = teacherOffset + input.teachers.length;
  const sink = dayOffset + days.length * input.perDay;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, capacity: number, cost: number): Edge => {
    const forward: Edge = { to, reverse: graph[to]?.length ?? 0, capacity, cost };
    const reverse: Edge = { to: from, reverse: graph[from]?.length ?? 0, capacity: 0, cost: -cost };
    graph[from]?.push(forward);
    graph[to]?.push(reverse);
    return forward;
  };
  const links: { edge: Edge; day: string; id: string; slot: number }[] = [];
  let needed = 0;
  let fixedFlow = 0;
  days.forEach((d, index) => {
    if (d.excluded) return;
    const empty = Array.from({ length: slotsForDay(input, d.day) }, (_, slot) => slot).filter(
      (slot) => !assignments[String(d.day)]?.[slot],
    );
    needed += empty.length;
    for (const slot of empty) add(dayOffset + index * input.perDay + slot, sink, 1, 0);
    input.teachers.forEach((t, ti) => {
      if (!eligible(t, d) || assignments[String(d.day)]?.includes(t.id)) return;
      const allowed = empty.filter((slot) => eligibleSlot(t, d.weekday, slot));
      if (!allowed.length) return;
      const node = graph.length;
      graph.push([]); // capacity one per teacher and date, even across multiple slots
      if (t.fixed.includes(d.day) && !input.manual[String(d.day)]) {
        add(0, node, 1, 0);
        fixedFlow++;
      } else add(teacherOffset + ti, node, 1, 0);
      const rotation = (ti + input.teachers.length - (d.day % input.teachers.length)) % input.teachers.length;
      for (const slot of allowed)
        links.push({
          edge: add(node, dayOffset + index * input.perDay + slot, 1, rotation),
          day: String(d.day),
          id: t.id,
          slot,
        });
    });
  });
  function addAutomaticCapacity() {
    input.teachers.forEach((t, ti) => {
      for (let k = 0; k < days.length; k++) {
        const primary = 2 * Math.round(t.past * 10) + 20 * ((fixedCounts[ti] ?? 0) + k) + 10;
        const monthly = 2 * ((fixedCounts[ti] ?? 0) + k) + 1;
        add(0, teacherOffset + ti, 1, primary * 1000000000 + monthly * 100000);
      }
    });
  }
  for (let flow = 0; flow < needed; flow++) {
    // Fill every fixed lower-bound unit first; later residual paths may move its slot without releasing its date.
    if (flow === fixedFlow) addAutomaticCapacity();
    const distance = graph.map(() => Infinity);
    const parent: { node: number; edge: number }[] = graph.map(() => ({ node: -1, edge: -1 }));
    const queued = graph.map(() => false);
    const queue = [0];
    distance[0] = 0;
    queued[0] = true;
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];
      if (node === undefined) continue;
      queued[node] = false;
      graph[node]?.forEach((edge, ei) => {
        const next = (distance[node] ?? Infinity) + edge.cost;
        if (edge.capacity > 0 && next < (distance[edge.to] ?? Infinity)) {
          distance[edge.to] = next;
          parent[edge.to] = { node, edge: ei };
          if (!queued[edge.to]) {
            queued[edge.to] = true;
            queue.push(edge.to);
          }
        }
      });
    }
    if (!Number.isFinite(distance[sink]))
      return {
        assignments: {},
        issues: [
          "제외 조건을 지키면서 모든 날짜를 채울 수 없어요. 하루 인원을 줄이거나 교사 제외 조건을 조정해 주세요.",
        ],
      };
    for (let node = sink; node !== 0;) {
      const p = parent[node];
      if (!p || p.node < 0) break;
      const edge = graph[p.node]?.[p.edge];
      if (!edge) break;
      edge.capacity--;
      const reverse = graph[node]?.[edge.reverse];
      if (reverse) reverse.capacity++;
      node = p.node;
    }
  }
  for (const link of links)
    if (link.edge.capacity === 0) {
      const row = assignments[link.day];
      if (row) row[link.slot] = link.id;
    }
  function gapPenalty(): number {
    let score = 0;
    const previous = new Map<string, number>();
    for (const d of days)
      for (const id of assignments[String(d.day)] ?? []) {
        const last = previous.get(id);
        if (last !== undefined) score += Math.max(0, 7 - (d.day - last)) ** 2;
        previous.set(id, d.day);
      }
    return score;
  }
  let penalty = gapPenalty();
  const free = days.flatMap((d) =>
    input.manual[String(d.day)]
      ? []
      : (assignments[String(d.day)] ?? []).flatMap((id, slot) =>
          input.teachers.find((t) => t.id === id)?.fixed.includes(d.day) ? [] : [{ d, slot }],
        ),
  );
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < free.length; a++)
      for (let b = a + 1; b < free.length; b++) {
        const x = free[a],
          y = free[b];
        if (!x || !y || x.d.day === y.d.day) continue;
        const rowX = assignments[String(x.d.day)],
          rowY = assignments[String(y.d.day)];
        if (!rowX || !rowY) continue;
        const idX = rowX[x.slot],
          idY = rowY[y.slot];
        const tX = input.teachers.find((t) => t.id === idX),
          tY = input.teachers.find((t) => t.id === idY);
        if (
          !tX ||
          !tY ||
          idX === idY ||
          rowX.includes(tY.id) ||
          rowY.includes(tX.id) ||
          !eligible(tX, y.d) ||
          !eligible(tY, x.d) ||
          !eligibleSlot(tX, y.d.weekday, y.slot) ||
          !eligibleSlot(tY, x.d.weekday, x.slot)
        )
          continue;
        rowX[x.slot] = tY.id;
        rowY[y.slot] = tX.id;
        const next = gapPenalty();
        if (next < penalty) penalty = next;
        else {
          rowX[x.slot] = tX.id;
          rowY[y.slot] = tY.id;
        }
      }
  return { assignments, issues };
}
export function counts(input: PlanInput, assignments: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(
    input.teachers.map((t) => [t.id, Object.values(assignments).filter((ids) => ids.includes(t.id)).length]),
  );
}
