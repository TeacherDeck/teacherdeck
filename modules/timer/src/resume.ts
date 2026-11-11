// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { MAX_DURATION_MS, type TimerState } from "./timer.ts";
/** Only deliberately paused/stopped states can survive an iframe or app restart. */
export function readTimer(value: unknown): TimerState {
  if (!value || typeof value !== "object") throw new Error("INVALID_TIMER");
  const item = value as Record<string, unknown>;
  if (
    !["idle", "paused", "finished"].includes(String(item["status"])) ||
    item["startedAt"] !== null ||
    typeof item["durationMs"] !== "number" ||
    !Number.isFinite(item["durationMs"]) ||
    item["durationMs"] < 0 ||
    item["durationMs"] > MAX_DURATION_MS ||
    typeof item["elapsedMs"] !== "number" ||
    !Number.isFinite(item["elapsedMs"]) ||
    item["elapsedMs"] < 0 ||
    item["elapsedMs"] > item["durationMs"]
  )
    throw new Error("INVALID_TIMER");
  return {
    status: item["status"] as TimerState["status"],
    durationMs: item["durationMs"],
    elapsedMs: item["elapsedMs"],
    startedAt: null,
  };
}
