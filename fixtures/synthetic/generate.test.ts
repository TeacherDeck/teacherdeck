// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { FICTIONAL_NAMES, FICTIONAL_SCHOOLS, fictionalPhone, syntheticRoster } from "./generate.ts";

describe("synthetic roster (PRV-004)", () => {
  it("is deterministic for a seed", () => {
    expect(syntheticRoster(30, 7)).toEqual(syntheticRoster(30, 7));
  });

  it("uses only fictional names, schools and phone numbers", () => {
    const roster = syntheticRoster(45, 3);
    expect(FICTIONAL_SCHOOLS).toContain(roster.school);
    for (const s of roster.students) {
      expect(FICTIONAL_NAMES.some((n) => s.name.startsWith(n))).toBe(true);
      expect(s.phone).toMatch(/^010-0000-\d{4}$/);
    }
    expect(new Set(roster.students.map((s) => s.name)).size).toBe(45);
  });

  it("formats phone numbers in the 010-0000 range", () => {
    expect(fictionalPhone(7)).toBe("010-0000-0007");
  });
});
