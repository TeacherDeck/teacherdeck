// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell theme preference (system / light / dark). Stored in the shell's own localStorage, which is
// a per-user convenience of the shell; modules must use the storage capability instead (MOD-009).
import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "deck.shell.theme";

export function loadPreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function savePreference(p: ThemePreference): void {
  try {
    window.localStorage.setItem(KEY, p);
  } catch {
    // Storage may be unavailable; the choice then lasts for this session only.
  }
}

/**
 * Whether the window may stay transparent over Mica (design-system.md §3). Mica follows the
 * Windows theme, so a light page over dark Mica (or the reverse) loses contrast; an explicit choice
 * that differs from Windows falls back to the opaque background (UI-004, UI-005).
 */
export function micaFor(available: boolean, mode: "light" | "dark", systemMode: "light" | "dark"): boolean {
  return available && mode === systemMode;
}

/** Resolves the preference against the OS color scheme and follows OS changes. */
export function useColorMode(pref: ThemePreference): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (mq === undefined) return undefined;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return pref === "system" ? (systemDark ? "dark" : "light") : pref;
}
