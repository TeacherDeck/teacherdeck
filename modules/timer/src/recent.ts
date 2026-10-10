// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Recently started durations and the time-up sound setting, persisted with the storage capability
// (MOD-009: never localStorage).
import type { Deck } from "@deck/sdk";
import { MAX_DURATION_MS } from "./timer.ts";

export const RECENT_KEY = "recent.v1";
export const MAX_RECENT = 5;

/** Newest first, no repeats, only sane values (stored data may be old or edited). */
export function sanitize(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const list = value.filter(
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v * 1000 <= MAX_DURATION_MS,
  );
  return [...new Set(list)].slice(0, MAX_RECENT);
}

export async function loadRecent(deck: Pick<Deck, "storage">): Promise<number[]> {
  return sanitize(await deck.storage.get(RECENT_KEY));
}

/** Moves `seconds` to the front (keeps at most MAX_RECENT) and persists the list. */
export async function pushRecent(deck: Pick<Deck, "storage">, current: number[], seconds: number): Promise<number[]> {
  const next = sanitize([seconds, ...current]);
  await deck.storage.set(RECENT_KEY, next);
  return next;
}

export const SOUND_KEY = "sound.v1";

/** Time-up sound on/off; on unless the teacher turned it off. */
export async function loadSound(deck: Pick<Deck, "storage">): Promise<boolean> {
  return (await deck.storage.get(SOUND_KEY)) !== false;
}

export async function saveSound(deck: Pick<Deck, "storage">, on: boolean): Promise<void> {
  await deck.storage.set(SOUND_KEY, on);
}
