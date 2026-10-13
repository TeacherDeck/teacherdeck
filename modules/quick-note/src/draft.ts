// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Item } from "./logic.ts";
export function readDraft(value: unknown): Item {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_DRAFT");
  const source = value as Record<string, unknown>;
  if (
    typeof source["id"] !== "string" ||
    !source["id"] ||
    source["id"].length > 80 ||
    typeof source["title"] !== "string" ||
    source["title"].length > 120 ||
    typeof source["body"] !== "string" ||
    source["body"].length > 4000 ||
    typeof source["pinned"] !== "boolean" ||
    !["neutral", "yellow", "blue", "green"].includes(String(source["tone"])) ||
    typeof source["archived"] !== "boolean" ||
    typeof source["updatedAt"] !== "string" ||
    source["updatedAt"].length > 40 ||
    !Number.isFinite(Date.parse(source["updatedAt"]))
  )
    throw new Error("INVALID_DRAFT");
  return JSON.parse(JSON.stringify(value)) as Item;
}
