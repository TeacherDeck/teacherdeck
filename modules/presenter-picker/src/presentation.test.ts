// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { emptyState, pick, parseRoster, replaceRoster } from "./logic.ts";
import { presentationPayload } from "./presentation.ts";
it("publishes the selected student without counts, exclusions or identities", () => {
  let id = 0;
  const state = replaceRoster(
    emptyState(),
    parseRoster("1\t합성가\t8\n2\t합성나\t2", [], () => `private-${++id}`),
    "합성 수업",
  );
  state.excluded = ["private-1"];
  const selected = pick(state, "private-2");
  expect(presentationPayload(selected)).toEqual({
    kind: "picker",
    title: "합성 수업",
    columns: null,
    items: [{ label: "2번 합성나", group: null, row: null, column: null }],
  });
  expect(presentationPayload(state)).toBeNull();
  expect(selected.events).toEqual([]);
});
