// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { chimeNotes } from "./chime.ts";

describe("chime", () => {
  it("rings a rising arpeggio the given number of times", () => {
    const notes = chimeNotes(3);
    expect(notes).toHaveLength(9);
    const first = notes.slice(0, 3);
    expect(first.map((n) => n.freq)).toEqual([...first.map((n) => n.freq)].sort((a, b) => a - b));
    expect(notes.every((n, i) => i === 0 || n.at > (notes[i - 1]?.at ?? -1))).toBe(true);
  });

  it("finishes within a few seconds", () => {
    const last = chimeNotes().at(-1);
    expect(last && last.at + last.length).toBeLessThan(4);
  });
});
