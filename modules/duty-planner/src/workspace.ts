// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { decodeBackup, encodeBackup, type Months } from "./history.ts";
import { readDetailedDraft, type DetailedDraft } from "./detailed-draft.ts";
import { sanitizeState, type PlannerState } from "./state.ts";

const ACTIVE = "workspace.active.v1";
const MAX_BYTES = 5 * 1024 * 1024;
export interface Workspace {
  state: PlannerState;
  months: Months;
  roster: string;
  timetableText: string;
  newName: string;
  backupText: string;
  legacyYear: number | null;
  replacementPending: boolean;
  teacherId: string;
  selectedDay: string;
  manualSelection: string[];
  actualSlots: Record<string, string[]>;
  detailedDraft: DetailedDraft;
}
interface Index {
  generation: string;
  count: number;
}
function index(value: unknown): Index | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    !("generation" in value) ||
    typeof value.generation !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(value.generation) ||
    !("count" in value) ||
    !Number.isInteger(value.count) ||
    typeof value.count !== "number" ||
    value.count < 1 ||
    value.count > 112
  )
    throw new Error("WORKSPACE_INVALID");
  return { generation: value.generation, count: value.count };
}
function address(value: Index, part: number) {
  return `workspace.${value.generation}.${part}`;
}
function validate(value: unknown): Workspace {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORKSPACE_INVALID");
  const item = value as Record<string, unknown>;
  const state = sanitizeState(item["state"]);
  const months =
    item["months"] && typeof item["months"] === "object" ? decodeBackup(encodeBackup(item["months"] as Months)) : null;
  if (
    !state ||
    !months ||
    ["roster", "timetableText", "newName", "backupText", "teacherId", "selectedDay"].some(
      (key) => typeof item[key] !== "string",
    ) ||
    (item["legacyYear"] !== null &&
      (typeof item["legacyYear"] !== "number" || !Number.isInteger(item["legacyYear"]))) ||
    typeof item["replacementPending"] !== "boolean" ||
    !Array.isArray(item["manualSelection"]) ||
    !item["actualSlots"] ||
    typeof item["actualSlots"] !== "object" ||
    Array.isArray(item["actualSlots"]) ||
    Object.entries(item["actualSlots"]).some(
      ([key, slots]) =>
        !/^\d{4}-\d{2}:([1-9]|[12][0-9]|3[01])$/.test(key) ||
        !Array.isArray(slots) ||
        slots.length > 3 ||
        slots.some((id: unknown) => typeof id !== "string"),
    ) ||
    item["manualSelection"].length > 3 ||
    item["manualSelection"].some((id: unknown) => typeof id !== "string")
  )
    throw new Error("WORKSPACE_INVALID");
  return { ...(item as unknown as Workspace), state, months, detailedDraft: readDetailedDraft(item["detailedDraft"]) };
}
export async function loadWorkspace(deck: Pick<Deck, "storage">): Promise<Workspace | null> {
  const active = index(await deck.storage.get(ACTIVE));
  if (!active) return null;
  let text = "";
  for (let part = 0; part < active.count; part++) {
    const chunk = await deck.storage.get(address(active, part));
    if (typeof chunk !== "string" || chunk.length > 50000) throw new Error("WORKSPACE_INVALID");
    text += chunk;
  }
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("WORKSPACE_TOO_LARGE");
  return validate(JSON.parse(text));
}
/** Publish one pointer only after every bounded chunk succeeds; keep the previous draft on failure. */
export async function saveWorkspace(deck: Pick<Deck, "storage">, value: Workspace): Promise<void> {
  const text = JSON.stringify(validate(value));
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("WORKSPACE_TOO_LARGE");
  const prior = index(await deck.storage.get(ACTIVE));
  const next: Index = { generation: crypto.randomUUID(), count: Math.ceil(text.length / 50000) };
  const created: string[] = [];
  try {
    for (let part = 0; part < next.count; part++) {
      const key = address(next, part);
      created.push(key);
      await deck.storage.set(key, text.slice(part * 50000, (part + 1) * 50000));
    }
    await deck.storage.set(ACTIVE, next);
  } catch (error) {
    await Promise.allSettled(created.map((key) => deck.storage.delete(key)));
    throw error;
  }
  if (prior)
    await Promise.allSettled(
      Array.from({ length: prior.count }, (_, part) => deck.storage.delete(address(prior, part))),
    );
}
