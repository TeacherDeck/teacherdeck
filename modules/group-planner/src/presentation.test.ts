// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { applySetup, emptyState, generate, parseRoster } from "./logic.ts";
import { presentationPayload } from "./presentation.ts";
it("preserves all 1000 public members without exposing grouping constraints", () => {
  let id = 0;
  const students = parseRoster(
    Array.from({ length: 1000 }, (_, i) => `${i + 1} 합성${i + 1}`).join("\n"),
    [],
    () => `private-${++id}`,
  );
  const state = applySetup(emptyState(), students, "합성 모둠", [], "size", 4);
  state.fixed = { "private-1": 1 };
  const grouped = generate(state, () => 0.5);
  const result = presentationPayload(grouped);
  expect(result?.items).toHaveLength(1000);
  expect(result?.items.map((i) => i.label).sort()).toEqual(students.map((s) => `${s.number}번 ${s.name}`).sort());
  expect(result?.items.every((i) => Object.keys(i).sort().join(",") === "column,group,label,row")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private-");
  expect(grouped.history).toEqual([]);
  expect(presentationPayload(state)).toBeNull();
});
