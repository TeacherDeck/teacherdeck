// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import type { Snapshot } from "./logic.ts";
import { presentationPayload } from "./presentation.ts";
it("uses the confirmed snapshot and preserves empty seat coordinates without teacher metadata", () => {
  const snapshot: Snapshot = {
    id: "private-snapshot",
    createdAt: "private-date",
    label: "합성 자리",
    layout: { rows: 2, columns: 2, aisles: [1], blocked: [1], frontRows: 1 },
    seats: [
      { id: "private-student", number: 1, name: "합성가" },
      null,
      null,
      { id: "private-student-2", number: 2, name: "합성나" },
    ],
  };
  expect(presentationPayload(snapshot)).toEqual({
    kind: "seats",
    title: "합성 자리",
    columns: 2,
    items: [
      { label: "1번 합성가", group: null, row: 0, column: 0 },
      { label: "", group: null, row: 0, column: 1 },
      { label: "", group: null, row: 1, column: 0 },
      { label: "2번 합성나", group: null, row: 1, column: 1 },
    ],
  });
  expect(presentationPayload(null)).toBeNull();
  expect(JSON.stringify(presentationPayload(snapshot))).not.toContain("private-");
});
