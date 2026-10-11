// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { calendar, eligibleSlot, validPast, type PlanInput, type PlanResult } from "./planner.ts";

export interface DutyBlock {
  id: string;
  label: string;
  start: number;
  end: number;
}
export interface DutyJob {
  id: string;
  day: number;
  block: string;
  task: string;
  room: string;
  required: number;
  fixed: string[];
  excluded: string[];
}
export interface DetailedState {
  version: 1;
  blocks: DutyBlock[];
  jobs: DutyJob[];
  assignments: Record<string, string[]>;
  manual: Record<string, string[]>;
  actual: Record<string, string[]>;
}
export const MAX_JOBS = 120;
export function emptyDetailed(): DetailedState {
  return { version: 1, blocks: [], jobs: [], assignments: {}, manual: {}, actual: {} };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const label = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 100;
const id = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(v);
const minute = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1440;
const unique = (v: unknown, ids: Set<string>, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= max &&
  new Set(v).size === v.length &&
  v.every((x) => typeof x === "string" && ids.has(x));
/** Stored drafts may contain unresolved constraints, but never unknown teacher/job references. */
export function sanitizeDetailed(v: unknown, teachers: Set<string>, days: number): DetailedState | null {
  if (
    !object(v) ||
    v["version"] !== 1 ||
    !Array.isArray(v["blocks"]) ||
    v["blocks"].length > 24 ||
    !Array.isArray(v["jobs"]) ||
    v["jobs"].length > MAX_JOBS
  )
    return null;
  const blocks = new Set<string>(),
    jobs = new Set<string>();
  for (const b of v["blocks"]) {
    if (
      !object(b) ||
      !id(b["id"]) ||
      blocks.has(b["id"]) ||
      !label(b["label"]) ||
      !minute(b["start"]) ||
      !minute(b["end"]) ||
      b["start"] >= b["end"]
    )
      return null;
    blocks.add(b["id"]);
  }
  for (const j of v["jobs"]) {
    if (
      !object(j) ||
      !id(j["id"]) ||
      jobs.has(j["id"]) ||
      typeof j["day"] !== "number" ||
      !Number.isInteger(j["day"]) ||
      j["day"] < 1 ||
      j["day"] > days ||
      typeof j["block"] !== "string" ||
      !blocks.has(j["block"]) ||
      !label(j["task"]) ||
      typeof j["room"] !== "string" ||
      j["room"].length > 100 ||
      typeof j["required"] !== "number" ||
      !Number.isInteger(j["required"]) ||
      j["required"] < 1 ||
      j["required"] > 3 ||
      !unique(j["fixed"], teachers, 500) ||
      !unique(j["excluded"], teachers, 500)
    )
      return null;
    jobs.add(j["id"]);
  }
  for (const field of ["assignments", "manual", "actual"]) {
    const rows = v[field];
    if (!object(rows) || Object.entries(rows).some(([key, row]) => !jobs.has(key) || !unique(row, teachers, 3)))
      return null;
  }
  const actual = v["actual"] as Record<string, string[]>;
  for (const j of v["jobs"] as DutyJob[]) {
    if ((actual[j.id]?.length ?? 0) > j.required) return null;
  }
  if (overlappingAssignments(v as unknown as DetailedState, actual)) return null;
  return structuredClone(v) as unknown as DetailedState;
}
export function parseTime(text: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
export function timeLabel(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function detailedCounts(d: DetailedState, rows = d.assignments): Record<string, number> {
  const result: Record<string, number> = {};
  for (const row of Object.values(rows)) for (const teacher of row) result[teacher] = (result[teacher] ?? 0) + 1;
  return result;
}
function overlappingAssignments(d: DetailedState, rows: Record<string, string[]>): boolean {
  const occupied = new Map<string, DutyBlock[]>();
  for (const job of d.jobs) {
    const block = d.blocks.find((b) => b.id === job.block);
    if (!block) continue;
    for (const teacher of rows[job.id] ?? []) {
      const key = `${teacher}/${job.day}`,
        previous = occupied.get(key) ?? [];
      if (previous.some((b) => b.start < block.end && block.start < b.end)) return true;
      occupied.set(key, [...previous, block]);
    }
  }
  return false;
}
/** Recheck visible results after edits without running the optimizer on the UI thread. */
export function detailedIssues(input: PlanInput, d: DetailedState, rows = d.assignments, actual = false): string[] {
  const issues: string[] = [],
    used = new Set<string>();
  const days = calendar(input);
  if (overlappingAssignments(d, rows))
    issues.push("세부 업무의 시각이 겹쳐 같은 교사가 두 번 들어 있어요. 시간대와 담당자를 조정해 주세요.");
  for (const j of d.jobs) {
    const row = rows[j.id] ?? [],
      day = days.find((x) => x.day === j.day);
    if (!row.length) continue;
    if (new Set(row).size !== row.length || row.length > j.required || (!actual && row.length !== j.required))
      issues.push(`${j.day}일 세부 인원을 확인해 주세요.`);
    if (!actual && j.fixed.some((t) => !row.includes(t))) issues.push(`${j.day}일 세부 고정이 빠져 있어요.`);
    row.forEach((id, slot) => {
      const t = input.teachers.find((x) => x.id === id),
        key = `${id}/${j.day}/${j.block}`;
      if (
        !t ||
        !day ||
        (!actual &&
          (day.excluded ||
            t.participating === false ||
            t.excluded.includes(j.day) ||
            t.weekdays.includes(day.weekday) ||
            j.excluded.includes(id) ||
            !eligibleSlot(t, day.weekday, slot)))
      )
        issues.push(`${j.day}일 세부 배정과 교사·날짜 조건이 겹쳐요.`);
      if (used.has(key)) issues.push(`${j.day}일 같은 시간에 같은 교사가 두 번 배정됐어요.`);
      used.add(key);
    });
  }
  if (!actual)
    for (const teacher of input.teachers)
      for (const day of teacher.fixed) {
        const jobs = d.jobs.filter((j) => j.day === day);
        if (
          jobs.length &&
          jobs.every((j) => (rows[j.id]?.length ?? 0) === j.required) &&
          !jobs.some((j) => rows[j.id]?.includes(teacher.id))
        )
          issues.push(`${day}일 날짜 고정 교사가 세부 배정에서 빠져 있어요.`);
      }
  return [...new Set(issues)];
}
export function setDetailedManual(input: PlanInput, d: DetailedState, key: string, row: string[]): DetailedState {
  const job = d.jobs.find((j) => j.id === key);
  if (!job || row.length !== job.required || row.some((id) => !id)) throw new Error("DETAILED_INVALID");
  const next = { ...d, manual: { ...d.manual, [key]: row }, assignments: { ...d.assignments, [key]: row } };
  if (detailedIssues(input, next).length) throw new Error("DETAILED_CONFLICT");
  return next;
}
export function setDetailedActual(
  input: PlanInput,
  d: DetailedState,
  key: string,
  row: string[],
  now = new Date(),
): DetailedState {
  const job = d.jobs.find((j) => j.id === key);
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = calendar(input).find((x) => x.day === job?.day)?.date;
  if (!job || !date || date > today || row.length > job.required) throw new Error("DETAILED_ACTUAL_INVALID");
  const next = { ...d, actual: { ...d.actual, [key]: row } };
  if (detailedIssues(input, next, next.actual, true).length) throw new Error("DETAILED_ACTUAL_CONFLICT");
  return next;
}
interface Edge {
  to: number;
  reverse: number;
  capacity: number;
  cost: bigint;
}
/** Convex min-cost flow with teacher/date/time capacity, job pins and date lower bounds. */
export function planDetailed(input: PlanInput, d: DetailedState): PlanResult {
  const fail = (message: string): PlanResult => ({ assignments: {}, issues: [message] });
  const days = calendar(input);
  if (
    !days.length ||
    !input.teachers.length ||
    input.teachers.length > 500 ||
    input.teachers.some((t) => !validPast(t.past)) ||
    new Set(input.teachers.map((t) => t.id)).size !== input.teachers.length ||
    !sanitizeDetailed(d, new Set(input.teachers.map((t) => t.id)), days.length)
  )
    return fail("세부 편성의 날짜·시간대·업무·명단을 확인해 주세요.");
  if (!d.jobs.length) return fail("시간대와 업무를 추가한 뒤 세부 배정을 눌러 주세요.");
  for (let a = 0; a < d.blocks.length; a++)
    for (let b = a + 1; b < d.blocks.length; b++) {
      const x = d.blocks[a],
        y = d.blocks[b];
      if (
        x &&
        y &&
        x.start < y.end &&
        y.start < x.end &&
        d.jobs.some((j) => j.block === x.id && d.jobs.some((k) => k.day === j.day && k.block === y.id))
      )
        return fail(
          "같은 날짜의 시간대가 겹쳐요. 같은 시각의 시험실·업무는 하나의 시간대를 함께 쓰고, 다른 시간대는 겹치지 않게 수정해 주세요.",
        );
    }
  const eligible = (ti: number, j: DutyJob, slot: number) => {
    const t = input.teachers[ti],
      day = days.find((x) => x.day === j.day);
    return (
      !!t &&
      !!day &&
      !day.excluded &&
      t.participating !== false &&
      !t.excluded.includes(j.day) &&
      !t.weekdays.includes(day.weekday) &&
      !j.excluded.includes(t.id) &&
      eligibleSlot(t, day.weekday, slot)
    );
  };
  const rows: Record<string, string[]> = {};
  const used = new Set<string>(),
    fixedCounts = input.teachers.map(() => 0);
  const coveredDates = new Set<string>();
  const sorted = [...d.jobs].sort(
    (a, b) =>
      a.day - b.day ||
      (d.blocks.find((x) => x.id === a.block)?.start ?? 0) - (d.blocks.find((x) => x.id === b.block)?.start ?? 0) ||
      a.id.localeCompare(b.id),
  );
  for (const j of sorted) {
    const day = days.find((x) => x.day === j.day);
    const direct = d.manual[j.id];
    const selected = direct ?? j.fixed;
    if (direct && (direct.length !== j.required || j.fixed.some((t) => !direct.includes(t))))
      return fail(`${j.day}일 직접 배정은 필요한 인원과 모든 고정을 포함해야 해요.`);
    if (selected.length > j.required) return fail(`${j.day}일 고정 인원이 필요한 인원을 넘어요.`);
    if (day?.excluded) {
      if (selected.length) return fail(`${j.day}일 날짜 제외와 세부 고정·직접 배정이 겹쳐요.`);
      rows[j.id] = [];
      continue;
    }
    // Job pins may have slot-specific weekday conditions; solve their slot placement first.
    const row = Array.from({ length: j.required }, () => "");
    const place = (index: number): boolean => {
      const teacher = selected[index];
      if (teacher === undefined) return true;
      const ti = input.teachers.findIndex((t) => t.id === teacher);
      for (let slot = 0; slot < row.length; slot++) {
        if (row[slot] || (direct && slot !== index) || !eligible(ti, j, slot)) continue;
        row[slot] = teacher;
        if (place(index + 1)) return true;
        row[slot] = "";
      }
      return false;
    };
    if (!place(0)) return fail(`${j.day}일 세부 고정·직접 배정이 교사 제외·순번 조건과 겹쳐요.`);
    for (const teacher of selected) {
      const key = `${teacher}/${j.day}/${j.block}`;
      if (used.has(key)) return fail(`${j.day}일 같은 시간대에 같은 교사가 두 번 고정·직접 배정됐어요.`);
      used.add(key);
      coveredDates.add(`${teacher}/${j.day}`);
      const ti = input.teachers.findIndex((t) => t.id === teacher);
      fixedCounts[ti] = (fixedCounts[ti] ?? 0) + 1;
    }
    rows[j.id] = direct ? row : row.map(() => "");
  }
  const graph: Edge[][] = [[]];
  const node = () => {
    graph.push([]);
    return graph.length - 1;
  };
  const add = (from: number, to: number, capacity: number, cost = 0n) => {
    const edge = { to, reverse: graph[to]?.length ?? 0, capacity, cost };
    graph[from]?.push(edge);
    graph[to]?.push({ to: from, reverse: (graph[from]?.length ?? 1) - 1, capacity: 0, cost: -cost });
    return edge;
  };
  const sink = node(),
    teachers = input.teachers.map(() => node());
  const dates = new Map<string, number>(),
    blocks = new Map<string, number>();
  const capacities = input.teachers.map(() => 0);
  const links: { edge: Edge; job: string; slot: number; teacher: string }[] = [];
  let needed = 0,
    datePins = 0,
    jobPins = 0;
  const pins = new Map<string, number>();
  for (const j of sorted) {
    if (d.manual[j.id] || !rows[j.id]?.length) continue;
    for (const teacher of j.fixed) {
      const pin = node();
      pins.set(`${j.id}/${teacher}`, pin);
      add(0, pin, 1);
      jobPins++;
    }
  }
  for (const j of sorted) {
    const row = rows[j.id];
    if (!row?.length) continue;
    row.forEach((value, slot) => {
      if (value) return;
      needed++;
      const target = node();
      add(target, sink, 1);
      input.teachers.forEach((t, ti) => {
        if (!eligible(ti, j, slot)) return;
        const pin = pins.get(`${j.id}/${t.id}`);
        if (pin !== undefined) {
          links.push({ edge: add(pin, target, 1), job: j.id, slot, teacher: t.id });
          return;
        }
        if (used.has(`${t.id}/${j.day}/${j.block}`)) return;
        const dateKey = `${t.id}/${j.day}`,
          blockKey = `${dateKey}/${j.block}`;
        let date = dates.get(dateKey);
        if (date === undefined) {
          date = node();
          dates.set(dateKey, date);
          add(teachers[ti] ?? 0, date, d.blocks.length);
        }
        let block = blocks.get(blockKey);
        if (block === undefined) {
          block = node();
          blocks.set(blockKey, block);
          add(date, block, 1);
          capacities[ti] = (capacities[ti] ?? 0) + 1;
        }
        const rotation = (ti + input.teachers.length - (j.day % input.teachers.length)) % input.teachers.length;
        links.push({ edge: add(block, target, 1, BigInt(rotation)), job: j.id, slot, teacher: t.id });
      });
    });
  }
  for (let ti = 0; ti < input.teachers.length; ti++) {
    const t = input.teachers[ti];
    if (!t) continue;
    for (const day of new Set(t.fixed)) {
      // Basic dates without a detailed job remain the basic calendar's responsibility.
      if (!d.jobs.some((j) => j.day === day)) continue;
      const key = `${t.id}/${day}`;
      if (coveredDates.has(key)) continue;
      const date = dates.get(key);
      if (date === undefined)
        return fail(`${day}일 날짜 고정을 지킬 세부 업무가 없어요. 날짜·시간대·교사 제외 조건을 확인해 주세요.`);
      add(0, date, 1);
      datePins++;
      fixedCounts[ti] = (fixedCounts[ti] ?? 0) + 1;
    }
  }
  if (datePins + jobPins > needed) return fail("고정 교사가 남은 세부 인원을 넘어요. 고정 조건을 조정해 주세요.");
  const totalUnits = sorted.reduce((sum, j) => sum + (rows[j.id]?.length ? j.required : 0), 0);
  const monthlyUnit = BigInt(totalUnits * input.teachers.length + 1);
  const primaryUnit = BigInt(totalUnits ** 2 + 1) * monthlyUnit;
  for (let flow = 0; flow < needed; flow++) {
    if (flow === datePins + jobPins)
      input.teachers.forEach((t, ti) => {
        // Global totals dominate monthly totals, which dominate all rotation tie scores.
        for (let k = 0; k < Math.min(needed, capacities[ti] ?? 0); k++) {
          const fixed = fixedCounts[ti] ?? 0;
          add(
            0,
            teachers[ti] ?? 0,
            1,
            BigInt(2 * Math.round(t.past * 10) + 20 * (fixed + k) + 10) * primaryUnit +
              BigInt(2 * (fixed + k) + 1) * monthlyUnit,
          );
        }
      });
    const distance: (bigint | null)[] = graph.map(() => null),
      queued = graph.map(() => false);
    const parent = graph.map(() => ({ from: -1, edge: -1 })),
      queue = [0];
    distance[0] = 0n;
    queued[0] = true;
    for (let head = 0; head < queue.length; head++) {
      const from = queue[head];
      if (from === undefined) continue;
      queued[from] = false;
      graph[from]?.forEach((edge, ei) => {
        const next = (distance[from] ?? 0n) + edge.cost;
        const previous = distance[edge.to];
        if (edge.capacity > 0 && (previous === null || previous === undefined || next < previous)) {
          distance[edge.to] = next;
          parent[edge.to] = { from, edge: ei };
          if (!queued[edge.to]) {
            queued[edge.to] = true;
            queue.push(edge.to);
          }
        }
      });
    }
    if (distance[sink] === null)
      return fail(
        "교사 조건을 지키면서 세부 인원을 채울 수 없어요. 같은 시간의 시험실·필요 인원이나 교사 제외·고정을 조정해 주세요.",
      );
    for (let at = sink; at !== 0;) {
      const p = parent[at],
        edge = p && graph[p.from]?.[p.edge];
      if (!p || !edge) break;
      edge.capacity--;
      const reverse = graph[at]?.[edge.reverse];
      if (reverse) reverse.capacity++;
      at = p.from;
    }
  }
  for (const link of links)
    if (!link.edge.capacity) {
      const row = rows[link.job];
      if (row) row[link.slot] = link.teacher;
    }
  return { assignments: rows, issues: [] };
}
