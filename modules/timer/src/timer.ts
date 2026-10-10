// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Pure timer state machine (MOD-015: unit-tested without the host). Time is derived from
// monotonic performance.now() timestamps, never wall-clock time. A delayed tick includes
// all elapsed monotonic time. On supported Windows WebView2, sleep counts toward the duration.
// The timer is not resumed after application restart.

export type Status = "idle" | "running" | "paused" | "finished";

export interface TimerState {
  readonly status: Status;
  readonly durationMs: number;
  /** When the current running stretch started (ms), or null when not running. */
  readonly startedAt: number | null;
  /** Elapsed time from earlier running stretches. */
  readonly elapsedMs: number;
}

export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function create(durationMs: number): TimerState {
  const d = Math.min(Math.max(0, Math.round(durationMs)), MAX_DURATION_MS);
  return { status: "idle", durationMs: d, startedAt: null, elapsedMs: 0 };
}

function elapsed(s: TimerState, now: number): number {
  return s.elapsedMs + (s.startedAt === null ? 0 : Math.max(0, now - s.startedAt));
}

export function remaining(s: TimerState, now: number): number {
  return Math.max(0, s.durationMs - elapsed(s, now));
}

export function start(s: TimerState, now: number): TimerState {
  if (s.status === "running" || s.durationMs === 0) return s;
  const base = s.status === "finished" ? create(s.durationMs) : s;
  return { ...base, status: "running", startedAt: now };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", startedAt: null, elapsedMs: elapsed(s, now) };
}

/** Space key: start ↔ pause. */
export function toggle(s: TimerState, now: number): TimerState {
  return s.status === "running" ? pause(s, now) : start(s, now);
}

/** R key: back to the full duration. */
export function reset(s: TimerState): TimerState {
  return create(s.durationMs);
}

/** Moves a running timer to `finished` once time is up. */
export function tick(s: TimerState, now: number): TimerState {
  if (s.status === "running" && remaining(s, now) === 0) {
    return { ...s, status: "finished", startedAt: null, elapsedMs: s.durationMs };
  }
  return s;
}

/** `m:ss` or `h:mm:ss`, rounding up so 0:00 appears only when time is really up. */
export function format(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
