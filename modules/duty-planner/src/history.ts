// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo } from "@deck/sdk";
import { calendar, counts } from "./planner.ts";
import { initialState, sanitizeState, saveState, type PlannerState } from "./state.ts";
import { HOLIDAYS } from "./holidays.ts";
import { saveLedgerMonth } from "./ledger.ts";
import { detailedCounts, emptyDetailed, timeLabel } from "./detailed.ts";
const PREFIX = "planner.month.";
export function monthKey(state: PlannerState): string {
  return `${state.input.year}-${String(state.input.month).padStart(2, "0")}`;
}
export type Months = Record<string, PlannerState>;
export async function loadMonths(deck: Pick<Deck, "storage">): Promise<Months> {
  const months: Months = {};
  for (const key of await deck.storage.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const state = sanitizeState(await deck.storage.get(key));
    if (!state || PREFIX + monthKey(state) !== key) throw new Error("STORED_DATA_INVALID");
    months[monthKey(state)] = state;
  }
  return months;
}
export function selectCurrent(saved: PlannerState | null, months: Months): PlannerState | null {
  return saved ? (months[monthKey(saved)] ?? saved) : null;
}
export async function saveMonth(deck: Pick<Deck, "storage">, state: PlannerState): Promise<void> {
  if (!sanitizeState(state)) throw new Error("STATE_INVALID");
  if (new TextEncoder().encode(JSON.stringify(state)).length > 256 * 1024) throw new Error("STORAGE_SIZE_LIMIT");
  if (await saveLedgerMonth(deck, state)) return;
  await deck.storage.set(PREFIX + monthKey(state), state);
  await saveState(deck, state);
}
export function switchMonth(state: PlannerState, months: Months, year: number, month: number): PlannerState {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return (
    months[key] ?? {
      ...initialState(new Date(year, month - 1, 1)),
      ...(state.detailed ? { detailed: { ...emptyDetailed(), blocks: structuredClone(state.detailed.blocks) } } : {}),
      input: {
        ...initialState(new Date(year, month - 1, 1)).input,
        perDay: state.input.perDay,
        weekends: state.input.weekends,
        teachers: state.input.teachers.map((t) => ({ ...t, fixed: [], excluded: [] })),
      },
    }
  );
}
export function performanceCounts(state: PlannerState): Record<string, number> {
  const validDays = new Set(calendar({ ...state.input, holidays: HOLIDAYS }).map((d) => String(d.day)));
  const basic = counts(
    state.input,
    Object.fromEntries(Object.entries(state.actual ?? {}).filter(([day]) => validDays.has(day))),
  );
  const detailed = state.detailed ? detailedCounts(state.detailed, state.detailed.actual) : {};
  return Object.fromEntries(state.input.teachers.map((t) => [t.id, (basic[t.id] ?? 0) + (detailed[t.id] ?? 0)]));
}
export function cumulativeInput(state: PlannerState, months: Months) {
  const totals = new Map<string, number>();
  for (const [key, month] of Object.entries(months)) {
    if (key === monthKey(state) || !month.closed) continue;
    const actual = performanceCounts(month);
    for (const t of month.input.teachers) totals.set(t.name, (totals.get(t.name) ?? 0) + (actual[t.id] ?? 0));
  }
  return {
    ...state.input,
    teachers: state.input.teachers.map((t) => ({ ...t, past: t.past + (totals.get(t.name) ?? 0) })),
  };
}
export function recordAssigned(state: PlannerState, selected: number[], now = new Date()): PlannerState {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (state.closed) throw new Error("MONTH_ALREADY_CLOSED");
  const actual = { ...state.actual };
  for (const d of calendar({ ...state.input, holidays: HOLIDAYS }))
    if (selected.includes(d.day)) {
      if (d.date > today) throw new Error("FUTURE_PERFORMANCE");
      if (!d.excluded) actual[String(d.day)] = (state.assignments[String(d.day)] ?? []).filter(Boolean);
    }
  return { ...state, actual };
}
export function closeMonth(state: PlannerState): PlannerState {
  if (state.closed) throw new Error("MONTH_ALREADY_CLOSED");
  return { ...state, closed: true };
}
export function encodeBackup(months: Months): string {
  return JSON.stringify(
    { format: Object.values(months).some((s) => s.detailed) ? "teacherdeck-duty-v2" : "teacherdeck-duty-v1", months },
    null,
    2,
  );
}
export function decodeBackup(text: string): Months | null {
  try {
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) return null;
    const v: unknown = JSON.parse(text);
    if (
      typeof v !== "object" ||
      !v ||
      !("format" in v) ||
      (v.format !== "teacherdeck-duty-v1" && v.format !== "teacherdeck-duty-v2") ||
      !("months" in v) ||
      typeof v.months !== "object" ||
      !v.months ||
      Array.isArray(v.months)
    )
      return null;
    const result: Months = {};
    for (const [key, value] of Object.entries(v.months)) {
      const s = sanitizeState(value);
      if (!s || key !== monthKey(s)) return null;
      result[key] = s;
    }
    return Object.keys(result).length && Object.keys(result).length <= 2412 ? result : null;
  } catch {
    return null;
  }
}
const escape = (text: string) => `"${text.replaceAll('"', '""')}"`;
export function exportCsv(state: PlannerState): string {
  if (state.detailed?.jobs.length) {
    const names = (ids: string[]) =>
      ids.map((id) => state.input.teachers.find((t) => t.id === id)?.name ?? "").join(" · ");
    return (
      "\uFEFF" +
      [
        [
          "날짜",
          "업무",
          "시간대",
          "시작",
          "종료",
          "시험실·장소",
          "필요 인원",
          "담당자",
          "실제 수행자",
          "구분",
          "요일",
          "고사일",
          "메모",
        ],
        ...calendar({ ...state.input, holidays: HOLIDAYS }).map((day) => [
          day.date,
          "기본 지도일",
          "",
          "",
          "",
          "",
          String(state.input.exam?.includes(day.day) ? 1 : state.input.perDay),
          names(state.assignments[String(day.day)] ?? []),
          names(state.actual?.[String(day.day)] ?? []),
          day.excluded ? "제외" : "기본",
          "일월화수목금토"[day.weekday] ?? "",
          state.input.exam?.includes(day.day) ? "고사" : "",
          state.memo?.[String(day.day)] ?? "",
        ]),
        ...state.detailed.jobs.map((job) => {
          const block = state.detailed?.blocks.find((b) => b.id === job.block);
          return [
            `${monthKey(state)}-${String(job.day).padStart(2, "0")}`,
            job.task,
            block?.label ?? "",
            timeLabel(block?.start ?? 0),
            timeLabel(block?.end ?? 0),
            job.room,
            String(job.required),
            names(state.detailed?.assignments[job.id] ?? []),
            names(state.detailed?.actual[job.id] ?? []),
            "세부",
            "일월화수목금토"[new Date(Date.UTC(state.input.year, state.input.month - 1, job.day)).getUTCDay()] ?? "",
            state.input.exam?.includes(job.day) ? "고사" : "",
            state.memo?.[String(job.day)] ?? "",
          ];
        }),
      ]
        .map((row) => row.map(escape).join(","))
        .join("\r\n")
    );
  }
  return (
    "\uFEFF" +
    [
      ["날짜", "요일", "제외", "고사일", "담당자", "실제 수행자", "메모"],
      ...calendar({ ...state.input, holidays: HOLIDAYS }).map((d) => [
        d.date,
        "일월화수목금토"[d.weekday] ?? "",
        d.excluded ? "제외" : "",
        state.input.exam?.includes(d.day) ? "고사" : "",
        (state.assignments[String(d.day)] ?? [])
          .map((id) => state.input.teachers.find((t) => t.id === id)?.name ?? "")
          .join(" · "),
        (state.actual?.[String(d.day)] ?? [])
          .map((id) => state.input.teachers.find((t) => t.id === id)?.name ?? "")
          .join(" · "),
        state.memo?.[String(d.day)] ?? "",
      ]),
    ]
      .map((row) => row.map(escape).join(","))
      .join("\r\n")
  );
}
export function exportLegacy(months: Months): string {
  if (
    new Set(Object.values(months).map((s) => s.input.year)).size > 1 ||
    Object.values(months).some((s) => !!s.detailed?.jobs.length) ||
    Object.values(months).some((s) =>
      [...Object.values(s.assignments), ...Object.values(s.actual ?? {})].some((row) => row.length > 2),
    )
  )
    throw new Error("LEGACY_FORMAT_LIMIT");
  const totals = new Map<string, number>();
  const records = Object.values(months).map((s) => {
    for (const t of s.input.teachers)
      if (t.participating !== false) totals.set(t.name, Math.max(totals.get(t.name) ?? 0, t.past));
    return {
      sheetName: `${s.input.month}월 데이터`,
      data: calendar({ ...s.input, holidays: HOLIDAYS })
        .filter(
          (d) =>
            !s.legacyDays ||
            s.legacyDays.includes(d.day) ||
            !d.excluded ||
            (s.assignments[String(d.day)]?.length ?? 0) > 0 ||
            (s.actual?.[String(d.day)]?.length ?? 0) > 0 ||
            !!s.memo?.[String(d.day)],
        )
        .map((d) => {
          const names = (s.assignments[String(d.day)] ?? []).map(
            (id) => s.input.teachers.find((t) => t.id === id)?.name ?? "",
          );
          return {
            date: d.date.slice(5).replace("-", "/"),
            dayKor: "일월화수목금토"[d.weekday],
            exclude: d.excluded,
            exam: s.input.exam?.includes(d.day) ?? false,
            final1: names[0] || (s.legacyMissing?.[String(d.day)]?.includes(0) ? "배정불가" : ""),
            final2: names[1] || (s.legacyMissing?.[String(d.day)]?.includes(1) ? "배정불가" : ""),
            memo: s.memo?.[String(d.day)] ?? "",
          };
        }),
    };
  });
  for (const s of Object.values(months).filter((s) => s.closed)) {
    const actual = performanceCounts(s);
    for (const t of s.input.teachers)
      if (t.participating !== false) totals.set(t.name, (totals.get(t.name) ?? 0) + (actual[t.id] ?? 0));
  }
  return JSON.stringify({ months: records, counts: [...totals].map(([name, count]) => ({ name, count })) }, null, 2);
}
export async function writeExport(
  deck: Deck,
  name: string,
  text: string,
  source?: FileHandleInfo,
  chooseFolder = false,
): Promise<boolean> {
  const location =
    source && !chooseFolder
      ? { sourceHandle: source.handle }
      : await deck.fs.pickFolder().then((folder) => (folder ? { parentHandle: folder.handle } : null));
  if (!location) return false;
  const output = await deck.fs.openOutputFolder(location);
  try {
    await deck.fs.writeBlob({
      batchId: output.batchId,
      suggestedName: name,
      blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
    });
  } finally {
    await deck.fs.closeOutputFolder({ batchId: output.batchId });
  }
  return true;
}
export async function readBackup(
  deck: Deck,
  provided?: FileHandleInfo,
  onSource?: (file: FileHandleInfo) => void,
): Promise<string | null> {
  const file = provided ?? (await deck.fs.pickFiles({ multiple: false }))[0];
  if (!file) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle })) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error("BACKUP_SIZE_LIMIT");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  onSource?.(file);
  return text;
}
