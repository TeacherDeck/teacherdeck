// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { applySetup, emptyState, generate, parseRoster } from "./logic.ts";
import { presentationPayload } from "./presentation.ts";
it("publishes role labels and assigned names without private conditions or history", () => {
  let id = 0;
  const state = applySetup(
    emptyState(),
    parseRoster("1\t합성가\t8\n2\t합성나\t2", [], () => `private-${++id}`),
    [{ id: "private-job", title: "진행", capacity: 1 }],
    "합성 배정",
  );
  state.fixed = { "private-1": "private-job" };
  const assigned = generate(state, "private-draft", () => 0.5);
  expect(presentationPayload(assigned)).toEqual({
    kind: "roles",
    title: "합성 배정",
    columns: null,
    items: [{ label: "1번 합성가", group: "진행", row: null, column: null }],
  });
  expect(presentationPayload(state)).toBeNull();
  expect(assigned.events).toEqual([]);
});
