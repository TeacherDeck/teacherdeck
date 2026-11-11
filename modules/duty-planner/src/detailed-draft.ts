// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
export interface DetailedDraft {
  blockLabel: string;
  start: string;
  end: string;
  day: number;
  block: string;
  task: string;
  rooms: string;
  required: number;
  selected: string;
  teacher: string;
  manual: string[];
  actual: string[];
}
export const emptyDetailedDraft = (): DetailedDraft => ({
  blockLabel: "1교시",
  start: "09:00",
  end: "09:50",
  day: 1,
  block: "",
  task: "시험감독",
  rooms: "",
  required: 1,
  selected: "",
  teacher: "",
  manual: [],
  actual: [],
});
export function readDetailedDraft(value: unknown): DetailedDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORKSPACE_INVALID");
  const item = value as Record<string, unknown>;
  if (
    ["blockLabel", "start", "end", "block", "task", "rooms", "selected", "teacher"].some(
      (key) => typeof item[key] !== "string",
    ) ||
    !Number.isInteger(item["day"]) ||
    typeof item["day"] !== "number" ||
    item["day"] < 1 ||
    item["day"] > 31 ||
    !Number.isInteger(item["required"]) ||
    typeof item["required"] !== "number" ||
    item["required"] < 1 ||
    item["required"] > 3 ||
    ["manual", "actual"].some(
      (key) => !Array.isArray(item[key]) || (item[key] as unknown[]).some((entry) => typeof entry !== "string"),
    )
  )
    throw new Error("WORKSPACE_INVALID");
  return item as unknown as DetailedDraft;
}
