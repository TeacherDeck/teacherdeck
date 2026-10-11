// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Deck home lists kept in the shell's own localStorage (design-system.md §1): favorite tools and the
// tools already seen (to badge new ones). Only module ids are stored, never files or user data
// (PRV-003). Modules use the storage capability instead (MOD-009).

const FAVORITES = "deck.shell.favorites";
const SEEN = "deck.shell.seen";

function readIds(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

function writeIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage may be unavailable; the lists then last for this session only.
  }
}

export const loadFavorites = (): string[] => readIds(FAVORITES) ?? [];
export const saveFavorites = (ids: string[]): void => writeIds(FAVORITES, ids);

/** Stars or unstars `id`; new favorites go last. */
export function withFavoriteToggled(favorites: string[], id: string): string[] {
  return favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
}

/**
 * Returns the ids that were not installed at the previous launch and records the current set. The
 * very first launch has nothing to compare with, so nothing counts as new.
 */
export function takeFreshModules(ids: string[]): string[] {
  const seen = readIds(SEEN);
  writeIds(SEEN, [...new Set([...(seen ?? []), ...ids])]);
  return seen === null ? [] : ids.filter((id) => !seen.includes(id));
}
