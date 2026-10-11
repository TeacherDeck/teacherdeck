// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { decodeLegacy } from "./legacy.ts";
import { exportLegacy, recordAssigned, encodeBackup, decodeBackup } from "./history.ts";
import { initialState } from "./state.ts";
function original() {
  return {
    months: [
      {
        sheetName: "10월 데이터",
        data: [
          {
            date: "10/06",
            dayKor: "화",
            exclude: false,
            exam: false,
            final1: "배정불가",
            final2: "교사A",
            memo: "합성 메모",
          },
          { date: "10/07", dayKor: "수", exclude: false, exam: true, final1: "교사B", final2: "", memo: "" },
        ],
      },
    ],
    counts: [{ name: "교사A", count: 2.5 }],
  };
}
describe("original GAS portability", () => {
  it("preserves cumulative baselines, slot positions, markers and row membership without inferring performance", () => {
    const source = original(),
      months = required(decodeLegacy(JSON.stringify(source), 2026));
    const state = required(months["2026-10"]);
    expect(state.actual).toEqual({});
    expect(state.closed).toBe(false);
    expect(state.input.teachers.map((t) => [t.name, t.past, t.participating])).toEqual([
      ["교사A", 2.5, true],
      ["교사B", 0, false],
    ]);
    expect(state.assignments["6"]).toEqual(["", "legacy-1"]);
    expect(state.input.excluded).toContain(8);
    expect(JSON.parse(exportLegacy(months))).toEqual(source);
    expect(JSON.parse(exportLegacy(required(decodeLegacy(exportLegacy(months), 2026))))).toEqual(source);
    expect(decodeBackup(encodeBackup(months))).toEqual(months);
    expect(recordAssigned(state, [6], new Date(2026, 9, 6)).actual).toEqual({ "6": ["legacy-1"] });
  });
  it("requires the matching year and rejects duplicate months, dates, names and impossible dates", () => {
    expect(decodeLegacy(JSON.stringify(original()), 2027)).toBeNull();
    for (const change of [
      (v: ReturnType<typeof original>) => v.months.push(required(v.months[0])),
      (v: ReturnType<typeof original>) => required(v.months[0]).data.push(required(required(v.months[0]).data[0])),
      (v: ReturnType<typeof original>) => v.counts.push(required(v.counts[0])),
      (v: ReturnType<typeof original>) => {
        required(required(v.months[0]).data[0]).date = "10/32";
      },
    ]) {
      const v = original();
      change(v);
      expect(decodeLegacy(JSON.stringify(v), 2026)).toBeNull();
    }
  });
  it("exports an intentionally added date and blocks formats that would silently omit a third person or another year", () => {
    const months = required(decodeLegacy(JSON.stringify(original()), 2026)),
      state = required(months["2026-10"]);
    state.memo = { ...state.memo, "8": "새 합성 메모" };
    expect(JSON.parse(exportLegacy(months)).months[0].data.map((d: { date: string }) => d.date)).toEqual([
      "10/06",
      "10/07",
      "10/08",
    ]);
    state.assignments["6"] = ["legacy-1", "legacy-2", "third"];
    expect(() => exportLegacy(months)).toThrow("LEGACY_FORMAT_LIMIT");
    state.assignments["6"] = [];
    expect(() => exportLegacy({ ...months, "2027-10": initialState(new Date(2027, 9, 1)) })).toThrow(
      "LEGACY_FORMAT_LIMIT",
    );
  });
});

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("SYNTHETIC_FIXTURE_MISSING");
  return value;
}
