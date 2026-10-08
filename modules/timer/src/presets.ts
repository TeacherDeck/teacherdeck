// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Preset durations persisted with the storage capability (MOD-009: never localStorage).
import type { Deck } from "@deck/sdk";
import { MAX_DURATION_MS } from "./timer.ts";

export const PRESETS_KEY = "presets.v1";
export const DEFAULT_PRESETS_SEC = [60, 180, 300, 600];
export const MAX_PRESETS = 8;

/** Accepts only sane values; anything else falls back to defaults (stored data may be old or edited). */
export function sanitize(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_PRESETS_SEC;
  const list = value.filter(
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v * 1000 <= MAX_DURATION_MS,
  );
  return list.length === 0 ? DEFAULT_PRESETS_SEC : [...new Set(list)].sort((a, b) => a - b).slice(0, MAX_PRESETS);
}

export async function loadPresets(deck: Pick<Deck, "storage">): Promise<number[]> {
  return sanitize(await deck.storage.get(PRESETS_KEY));
}

/** Adds a preset (keeps at most MAX_PRESETS, sorted) and persists it. */
export async function addPreset(deck: Pick<Deck, "storage">, current: number[], seconds: number): Promise<number[]> {
  const next = sanitize([...current, seconds]);
  await deck.storage.set(PRESETS_KEY, next);
  return next;
}
