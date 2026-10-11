// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { PresentationPayload } from "@deck/sdk";
import type { RoleState } from "./logic.ts";
export function presentationPayload(state: RoleState): PresentationPayload | null {
  const students = new Map(state.students.map((s) => [s.id, s]));
  const jobs = new Map(state.jobs.map((j) => [j.id, j]));
  const items = state.draft.flatMap((assignment) => {
    const student = students.get(assignment.studentId);
    const job = jobs.get(assignment.jobId);
    return student && job
      ? [{ label: `${student.number}번 ${student.name}`, group: job.title, row: null, column: null }]
      : [];
  });
  return items.length ? { kind: "roles", title: state.label, columns: null, items } : null;
}
