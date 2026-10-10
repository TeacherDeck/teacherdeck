// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface Teacher {
  id: string;
  name: string;
  past: number;
  excluded: number[];
  weekdays: number[];
  fixed: number[];
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
    if (
      !name ||
      name.length > 100 ||
      names.has(name) ||
      extra.length > 0 ||
      !Number.isSafeInteger(past) ||
      past < 0 ||
      past > 100000
    )
      return null;
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
    input.teachers.some((t) => !Number.isSafeInteger(t.past) || t.past < 0 || t.past > 100000)
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
  const eligible = (t: Teacher, d: Day) => !t.excluded.includes(d.day) && !t.weekdays.includes(d.weekday);
  for (const d of days) {
    const fixed = input.teachers.filter((t) => t.fixed.includes(d.day)).map((t) => t.id);
    const manual = input.manual[String(d.day)];
    const selected = [...new Set([...(manual ?? []), ...fixed])];
    if (
      manual !== undefined &&
      (new Set(manual).size !== manual.length || selected.length !== manual.length || manual.length !== input.perDay)
    )
      issues.push(`${d.day}일 직접 배정은 하루 인원과 모든 고정 배정을 포함해야 해요.`);
    if (selected.length > input.perDay)
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
    assignments[String(d.day)] = d.excluded ? [] : selected;
  }
  if (issues.length) return { assignments: {}, issues };
  const teacherOffset = 1;
  const dayOffset = teacherOffset + input.teachers.length;
  const sink = dayOffset + days.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (from: number, to: number, capacity: number, cost: number): Edge => {
    const forward: Edge = { to, reverse: graph[to]?.length ?? 0, capacity, cost };
    const reverse: Edge = { to: from, reverse: graph[from]?.length ?? 0, capacity: 0, cost: -cost };
    graph[from]?.push(forward);
    graph[to]?.push(reverse);
    return forward;
  };
  const links: { edge: Edge; day: string; id: string }[] = [];
  let needed = 0;
  days.forEach((d, index) => {
    const slots = d.excluded ? 0 : input.perDay - (assignments[String(d.day)]?.length ?? 0);
    needed += slots;
    add(dayOffset + index, sink, slots, 0);
    if (slots === 0) return;
    input.teachers.forEach((t, ti) => {
      if (eligible(t, d) && !assignments[String(d.day)]?.includes(t.id))
        links.push({ edge: add(teacherOffset + ti, dayOffset + index, 1, 0), day: String(d.day), id: t.id });
    });
  });
  input.teachers.forEach((t, ti) => {
    for (let k = 0; k < days.length; k++)
      add(0, teacherOffset + ti, 1, (2 * (t.past + (fixedCounts[ti] ?? 0) + k) + 1) * 1000000 + ti);
  });
  for (let flow = 0; flow < needed; flow++) {
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
  for (const link of links) if (link.edge.capacity === 0) assignments[link.day]?.push(link.id);
  return { assignments, issues };
}
export function counts(input: PlanInput, assignments: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(
    input.teachers.map((t) => [t.id, Object.values(assignments).filter((ids) => ids.includes(t.id)).length]),
  );
}
