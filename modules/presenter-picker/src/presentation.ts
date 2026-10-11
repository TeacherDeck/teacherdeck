// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { PresentationPayload } from "@deck/sdk";
import type { PickerState } from "./logic.ts";
export function presentationPayload(state: PickerState): PresentationPayload | null {
  const student = state.pending;
  return student
    ? {
        kind: "picker",
        title: state.label,
        columns: null,
        items: [{ label: `${student.number}번 ${student.name}`, group: null, row: null, column: null }],
      }
    : null;
}
