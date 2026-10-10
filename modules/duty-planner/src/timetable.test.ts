// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { parseTimetable } from "./timetable.ts";
it("maps flattened timetable fourth periods to opposite first/second-slot eligibility and preserves existing settings", () => {
  const prior = [{ id: "A", name: "교사A", past: 2.6, fixed: [1], excluded: [], weekdays: [], participating: false }];
  const parsed = parseTimetable(
    "교사명\t요일\t교시\t교과/교실\n교사A\t월\t4\t합성교과\n교사B\t화\t2\t합성교과",
    prior,
    3.1,
  );
  expect(parsed?.[0]).toMatchObject({
    id: "A",
    past: 2.6,
    fixed: [1],
    participating: false,
    slotWeekdays: [[2, 3, 4, 5], [1], [0, 1, 2, 3, 4, 5, 6]],
  });
  expect(parsed?.[1]?.past).toBe(3.1);
  expect(parsed?.[1]?.slotWeekdays?.[1]).toEqual([]);
  expect(parseTimetable("교사A\t잘못된요일\t4", prior)).toBeNull();
});
