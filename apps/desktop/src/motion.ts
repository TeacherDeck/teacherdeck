// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell motion preference and helpers (design-system.md §1 셸 모션, UI-009). Motion runs only when
// both the shell setting and the OS (prefers-reduced-motion, Windows "animation effects") allow it.
import { useEffect, useState } from "react";

const KEY = "deck.shell.motion";
const REDUCED = "(prefers-reduced-motion: reduce)";

export function loadMotionPreference(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveMotionPreference(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage may be unavailable; the choice then lasts for this session only.
  }
}

/** Whether the OS asks for reduced motion, following changes. */
export function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCED);
    if (mq === undefined) return undefined;
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Resolves a Fluent token (`var(--name)`) against the element's computed style. */
function resolveToken(style: CSSStyleDeclaration, token: string): string {
  const name = /^var\((--[^),]+)\)$/.exec(token)?.[1];
  return name === undefined ? token : style.getPropertyValue(name).trim();
}

/**
 * Plays a one-off animation on an element that cannot be remounted (the module layer keeps its
 * iframes alive). Timing comes from Fluent duration/curve tokens.
 */
export function playMotion(el: HTMLElement, keyframes: Keyframe[], duration: string, easing: string): void {
  if (typeof el.animate !== "function") return;
  const style = window.getComputedStyle(el);
  const ms = Number.parseFloat(resolveToken(style, duration));
  if (!Number.isFinite(ms)) return;
  el.animate(keyframes, { duration: ms, easing: resolveToken(style, easing) || "ease-out" });
}
