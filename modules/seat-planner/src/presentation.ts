// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { PresentationPayload } from "@deck/sdk";
import type { Snapshot } from "./logic.ts";
export function presentationPayload(snapshot: Snapshot | null | undefined): PresentationPayload | null {
  return snapshot
    ? {
        kind: "seats",
        title: snapshot.label,
        columns: snapshot.layout.columns,
        items: snapshot.seats.map((student, index) => ({
          label: student ? `${student.number}번 ${student.name}` : "",
          group: null,
          row: Math.floor(index / snapshot.layout.columns),
          column: index % snapshot.layout.columns,
        })),
      }
    : null;
}
