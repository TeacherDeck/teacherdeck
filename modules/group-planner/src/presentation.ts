// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { PresentationPayload } from "@deck/sdk";
import type { GroupState } from "./logic.ts";
export function presentationPayload(state: GroupState): PresentationPayload | null {
  const students = new Map(state.students.map((s) => [s.id, s]));
  const items = state.groups.flatMap((group) =>
    group.members.flatMap((id) => {
      const student = students.get(id);
      return student
        ? [{ label: `${student.number}번 ${student.name}`, group: `${group.id}모둠`, row: null, column: null }]
        : [];
    }),
  );
  return items.length ? { kind: "groups", title: state.label, columns: null, items } : null;
}
