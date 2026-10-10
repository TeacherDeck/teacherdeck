// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { GroupState } from "./logic.ts";
/** Repeated historic identity and names share a dictionary; no history is dropped. */
export function packRecords(state: GroupState): unknown {
  const strings: string[] = [],
    indexes = new Map<string, number>();
  function index(value: string): number {
    const found = indexes.get(value);
    if (found !== undefined) return found;
    const next = strings.length;
    strings.push(value);
    indexes.set(value, next);
    return next;
  }
  const history = state.history.map((h) => [
    index(h.id),
    index(h.at),
    index(h.label),
    h.students.map((s) => [index(s.id), s.number, index(s.name)]),
    h.groups.map((g) => [g.id, g.members.map(index)]),
  ]);
  return { format: "deck-group-history-v1", strings, state: { ...state, history } };
}
function fail(): never {
  throw new Error("확정 이력의 압축 자료를 확인해 주세요.");
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
export function unpackRecords(value: unknown): unknown {
  const raw = object(value);
  if (raw["format"] !== "deck-group-history-v1") return value;
  const strings = list(raw["strings"], 50000);
  if (strings.some((s) => typeof s !== "string" || s.length > 80)) fail();
  function text(value: unknown): string {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= strings.length) fail();
    const found = strings[value];
    if (typeof found !== "string") fail();
    return found;
  }
  const state = object(raw["state"]);
  const history = list(state["history"], 20).map((value) => {
    const h = list(value, 5);
    if (h.length !== 5) fail();
    return {
      id: text(h[0]),
      at: text(h[1]),
      label: text(h[2]),
      students: list(h[3], 1000).map((value) => {
        const s = list(value, 3);
        if (s.length !== 3) fail();
        return { id: text(s[0]), number: s[1], name: text(s[2]) };
      }),
      groups: list(h[4], 1000).map((value) => {
        const g = list(value, 2);
        if (g.length !== 2) fail();
        return { id: g[0], members: list(g[1], 1000).map(text) };
      }),
    };
  });
  return { ...state, history };
}
