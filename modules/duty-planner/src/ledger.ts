// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { sanitizeState, type PlannerState } from "./state.ts";
export const ACTIVE_LEDGER = "planner.ledger.active";
interface Index {
  version: 1;
  generation: string;
  current: string;
  months: string[];
}
type Storage = Pick<Deck, "storage">;
function key(state: PlannerState) {
  return `${state.input.year}-${String(state.input.month).padStart(2, "0")}`;
}
function recordKey(index: Index, month: string) {
  return `planner.ledger.${index.generation}.${month}`;
}
async function readIndex(deck: Storage): Promise<Index | null> {
  const value: unknown = await deck.storage.get(ACTIVE_LEDGER);
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("generation" in value) ||
    typeof value.generation !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(value.generation) ||
    !("current" in value) ||
    typeof value.current !== "string" ||
    !("months" in value) ||
    !Array.isArray(value.months) ||
    !value.months.length ||
    value.months.length > 2412 ||
    !value.months.every((m: unknown) => typeof m === "string" && /^(19\d{2}|20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(m)) ||
    new Set(value.months).size !== value.months.length ||
    !value.months.includes(value.current)
  )
    throw new Error("STORED_DATA_INVALID");
  return { version: 1, generation: value.generation, current: value.current, months: value.months as string[] };
}
export async function loadLedger(
  deck: Storage,
): Promise<{ months: Record<string, PlannerState>; current: PlannerState } | null> {
  const index = await readIndex(deck);
  if (!index) return null;
  const months: Record<string, PlannerState> = {};
  for (const month of index.months) {
    const state = sanitizeState(await deck.storage.get(recordKey(index, month)));
    if (!state || key(state) !== month) throw new Error("STORED_DATA_INVALID");
    months[month] = state;
  }
  const current = months[index.current];
  if (!current) throw new Error("STORED_DATA_INVALID");
  return { months, current };
}
/** Staged records never replace the prior ledger until one small pointer write succeeds. */
export async function replaceLedger(
  deck: Storage,
  months: Record<string, PlannerState>,
  current: string,
): Promise<void> {
  const entries = Object.entries(months);
  if (!entries.length || entries.length > 2412 || !Object.hasOwn(months, current)) throw new Error("STATE_INVALID");
  for (const [month, state] of entries) {
    if (!sanitizeState(state) || key(state) !== month) throw new Error("STATE_INVALID");
    if (new TextEncoder().encode(JSON.stringify(state)).length > 256 * 1024) throw new Error("STORAGE_SIZE_LIMIT");
  }
  const index: Index = {
    version: 1,
    generation: crypto.randomUUID(),
    current,
    months: entries.map(([month]) => month),
  };
  const created: string[] = [];
  try {
    for (const [month, state] of entries) {
      const address = recordKey(index, month);
      created.push(address);
      await deck.storage.set(address, state);
    }
    await deck.storage.set(ACTIVE_LEDGER, index);
  } catch (error) {
    // These are fresh staging keys owned by this attempt, never prior user records.
    await Promise.allSettled(created.map((address) => deck.storage.delete(address)));
    throw error;
  }
}
/** Returns false for an unmigrated legacy store. */
export async function saveLedgerMonth(deck: Storage, state: PlannerState): Promise<boolean> {
  const ledger = await loadLedger(deck);
  if (!ledger) return false;
  await saveLedgerMonths(deck, { ...ledger.months, [key(state)]: state }, key(state));
  return true;
}
/** Commit all edited months together; remove only superseded healthy staging records. */
export async function saveLedgerMonths(
  deck: Storage,
  months: Record<string, PlannerState>,
  current: string,
): Promise<void> {
  const prior = await readIndex(deck);
  await replaceLedger(deck, months, current);
  if (prior) await Promise.allSettled(prior.months.map((month) => deck.storage.delete(recordKey(prior, month))));
}
