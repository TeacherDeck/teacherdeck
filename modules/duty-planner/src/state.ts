// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { validPast, type PlanInput, type Teacher } from "./planner.ts";
export const STATE_KEY = "planner.v1";
export interface PlannerState {
  input: PlanInput;
  assignments: Record<string, string[]>;
  actual?: Record<string, string[]>;
  memo?: Record<string, string>;
  closed?: boolean;
}
export function initialState(now = new Date()): PlannerState {
  return {
    input: {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      perDay: 1,
      weekends: true,
      excluded: [],
      teachers: [],
      manual: {},
      holidays: {},
      exam: [],
    },
    assignments: {},
    actual: {},
    memo: {},
    closed: false,
  };
}
function object(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function ints(v: unknown, low: number, high: number): v is number[] {
  return (
    Array.isArray(v) &&
    v.length <= high - low + 1 &&
    v["every"]((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= low && n <= high)
  );
}
function teacher(v: unknown): v is Teacher {
  return (
    object(v) &&
    typeof v["id"] === "string" &&
    v["id"].length <= 120 &&
    typeof v["name"] === "string" &&
    v["name"].length > 0 &&
    v["name"].length <= 100 &&
    typeof v["past"] === "number" &&
    validPast(v["past"]) &&
    (v["slotWeekdays"] === undefined ||
      (Array.isArray(v["slotWeekdays"]) &&
        v["slotWeekdays"].length <= 3 &&
        v["slotWeekdays"].every((x) => ints(x, 0, 6)))) &&
    ints(v["excluded"], 1, 31) &&
    ints(v["fixed"], 1, 31) &&
    ints(v["weekdays"], 0, 6) &&
    (v["participating"] === undefined || typeof v["participating"] === "boolean")
  );
}
function assignments(v: unknown, ids: Set<string>): v is Record<string, string[]> {
  return (
    object(v) &&
    Object.entries(v).every(
      ([k, values]) =>
        /^([1-9]|[12][0-9]|3[01])$/.test(k) &&
        Array.isArray(values) &&
        values.length <= 3 &&
        values.every((id: unknown) => typeof id === "string" && ids.has(id)) &&
        new Set(values).size === values.length,
    )
  );
}
export function sanitizeState(value: unknown): PlannerState | null {
  if (!object(value) || !object(value["input"])) return null;
  const i = value["input"];
  if (
    typeof i["year"] !== "number" ||
    !Number.isInteger(i["year"]) ||
    i["year"] < 1900 ||
    i["year"] > 2100 ||
    typeof i["month"] !== "number" ||
    !Number.isInteger(i["month"]) ||
    i["month"] < 1 ||
    i["month"] > 12 ||
    typeof i["perDay"] !== "number" ||
    !Number.isInteger(i["perDay"]) ||
    i["perDay"] < 1 ||
    i["perDay"] > 3 ||
    typeof i["weekends"] !== "boolean" ||
    !ints(i["excluded"], 1, 31) ||
    !Array.isArray(i["teachers"]) ||
    i["teachers"].length > 500 ||
    !i["teachers"].every(teacher)
  )
    return null;
  const teachers = i["teachers"] as Teacher[];
  const ids = new Set(teachers.map((t) => t.id));
  if (
    ids.size !== teachers.length ||
    new Set(teachers.map((t) => t.name)).size !== teachers.length ||
    !assignments(i["manual"], ids) ||
    !assignments(value["assignments"], ids) ||
    (value["actual"] !== undefined && !assignments(value["actual"], ids)) ||
    (i["exam"] !== undefined && !ints(i["exam"], 1, 31)) ||
    (value["closed"] !== undefined && typeof value["closed"] !== "boolean") ||
    (value["memo"] !== undefined &&
      (!object(value["memo"]) ||
        Object.entries(value["memo"]).some(
          ([k, v]) => !/^([1-9]|[12][0-9]|3[01])$/.test(k) || typeof v !== "string" || v.length > 2000,
        )))
  )
    return null;
  // Holiday tables are bundled code, never trusted from a stored draft.
  return {
    input: {
      year: i["year"],
      month: i["month"],
      perDay: i["perDay"],
      weekends: i["weekends"],
      excluded: i["excluded"],
      teachers,
      manual: i["manual"],
      holidays: {},
      exam: (i["exam"] as number[] | undefined) ?? [],
    },
    assignments: value["assignments"],
    actual: (value["actual"] as Record<string, string[]> | undefined) ?? {},
    memo: (value["memo"] as Record<string, string> | undefined) ?? {},
    closed: (value["closed"] as boolean | undefined) ?? false,
  };
}
export async function loadState(deck: Pick<Deck, "storage">): Promise<PlannerState | null> {
  const value = await deck.storage.get(STATE_KEY);
  if (value === null) return null;
  const state = sanitizeState(value);
  if (!state) throw new Error("STORED_DATA_INVALID");
  return state;
}
export async function saveState(deck: Pick<Deck, "storage">, state: PlannerState): Promise<void> {
  if (new TextEncoder().encode(JSON.stringify(state)).length > 256 * 1024) throw new Error("STORAGE_SIZE_LIMIT");
  if (!sanitizeState(state)) throw new Error("STATE_INVALID");
  await deck.storage.set(STATE_KEY, state);
}
