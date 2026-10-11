// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import {
  arrange,
  comparison,
  confirm,
  decodeState,
  emptyState,
  neighboring,
  parseRoster,
  replaceRoster,
  resizeLayout,
  swapSeats,
  validateSeats,
  type SeatState,
} from "./logic.ts";
export function fixture(count = 6): SeatState {
  let id = 0;
  const state = replaceRoster(
    emptyState(),
    parseRoster(Array.from({ length: count }, (_, i) => `${i + 1} 학생${i + 1}`).join("\n"), [], () => `s${++id}`),
    "합성 수업",
  );
  return { ...state, layout: { rows: Math.ceil(count / 5), columns: 5, frontRows: 1, blocked: [], aisles: [2] } };
}
function rng(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
describe("seat constraints and original exchange workflow", () => {
  it("preserves fixed and blocked coordinates when changing columns and rejects disappearing seats", () => {
    const state = fixture();
    state.rules.fixed = { s1: 6 };
    state.layout.blocked = [7];
    const next = resizeLayout(state, { columns: 4 });
    expect(next.rules.fixed["s1"]).toBe(5);
    expect(next.layout.blocked).toEqual([6]);
    state.rules.fixed = { s1: 9 };
    const old = structuredClone(state);
    expect(() => resizeLayout(state, { columns: 4 })).toThrow("사라져요");
    expect(state).toEqual(old);
  });
  it("requires number and name, preserves identity by both and rejects duplicate numbers", () => {
    const old = parseRoster("번호\t이름\n1 학생가\n2 학생가", [], () => crypto.randomUUID());
    const next = parseRoster("1 학생가\n2 학생나", old, () => "fresh");
    expect(next[0]?.id).toBe(old[0]?.id);
    expect(next[1]?.id).toBe("fresh");
    expect(() => parseRoster("1 학생가\n1 학생나")).toThrow("중복");
    expect(() => parseRoster("학생가")).toThrow("번호");
  });
  it("does not silently discard a fixed/excluded collision and stores it for correction", () => {
    const state = fixture();
    state.rules.fixed["s1"] = 0;
    state.rules.excluded = ["s1"];
    expect(() => arrange(state)).toThrow("고정한 학생");
    expect(decodeState(state).rules).toEqual(state.rules);
  });
  it.each(["shared fixed seat", "blocked fixed seat", "outside fixed seat", "back fixed front student"])(
    "rejects %s without mutating constraints",
    (kind) => {
      const state = fixture();
      state.rules.fixed["s1"] = 0;
      if (kind === "shared fixed seat") state.rules.fixed["s2"] = 0;
      if (kind === "blocked fixed seat") state.layout.blocked = [0];
      if (kind === "outside fixed seat") state.rules.fixed["s1"] = 99;
      if (kind === "back fixed front student") {
        state.rules.fixed["s1"] = 5;
        state.rules.front = ["s1"];
      }
      const before = structuredClone(state);
      expect(() => arrange(state)).toThrow();
      expect(state).toEqual(before);
    },
  );
  it("preserves original diagonal separation across aisles", () => {
    const state = fixture();
    state.rules.separated = [["s1", "s2"]];
    state.rules.fixed = { s1: 1, s2: 7 };
    expect(neighboring(1, 7, state.layout)).toBe(true);
    expect(() => arrange(state)).toThrow("이웃");
    state.rules.fixed = { s1: 0, s2: 9 };
    expect(() => arrange(state, rng(1))).not.toThrow();
  });
  it("distinguishes an impossible arrangement from an interrupted search", () => {
    const state = fixture(2);
    state.layout = { rows: 1, columns: 2, frontRows: 1, aisles: [], blocked: [] };
    state.rules.separated = [["s1", "s2"]];
    expect(() => arrange(state, rng(1))).toThrow("배치할 수 없어요");
    expect(() => arrange(state, rng(1), 0)).toThrow("탐색 한도");
  });
  it("rejects insufficient seats and insufficient front-row positions", () => {
    const state = fixture(6);
    state.layout.rows = 1;
    expect(() => arrange(state)).toThrow("자리가 적어요");
    state.layout.rows = 2;
    state.rules.front = state.students.map((s) => s.id);
    expect(() => arrange(state)).toThrow("앞줄");
  });
  it("allows direct exchanges and empty-seat movement, rejecting fixed/front/blocked/separation violations", () => {
    const state = fixture(3);
    state.layout.rows = 2;
    state.preview = ["s1", "s2", "s3", null, null, null, null, null, null, null];
    expect(swapSeats(state, 0, 4).preview?.[4]).toBe("s1");
    expect(state.preview[0]).toBe("s1");
    state.rules.fixed = { s1: 0 };
    expect(() => swapSeats(state, 0, 4)).toThrow("고정");
    state.rules.fixed = {};
    state.rules.front = ["s1"];
    expect(() => swapSeats(state, 0, 7)).toThrow("앞줄");
    state.rules.front = [];
    state.layout.blocked = [4];
    expect(() => swapSeats(state, 0, 4)).toThrow("비워둘");
    state.layout.blocked = [];
    state.rules.separated = [["s1", "s3"]];
    expect(() => swapSeats(state, 0, 1)).toThrow("이웃");
  });
  it("keeps snapshots after roster edits and prevents duplicate confirmation", () => {
    const confirmed = confirm(arrange(fixture(), rng(11)), "snapshot", "2026-10-01T00:00:00Z");
    expect(() => confirm(confirmed)).toThrow("이미 확정");
    const next = replaceRoster(
      confirmed,
      parseRoster("1 새학생", confirmed.students, () => "new"),
      "새 수업",
    );
    expect(next.history).toEqual(confirmed.history);
    expect(next.history[0]?.seats.some((s) => s?.name === "학생1")).toBe(true);
    expect(next.preview).toBeNull();
  });
  it("compares a published allocation against the previous snapshot, never itself", () => {
    const state = fixture(3);
    state.preview = ["s1", "s2", "s3", null, null];
    const first = confirm(state, "first", "2026-10-01T00:00:00Z");
    expect(comparison(first).hasReference).toBe(false);
    const swapped = swapSeats(first, 0, 1),
      second = confirm(swapped, "second", "2026-10-02T00:00:00Z");
    expect(comparison(second).moved).toBe(2);
    expect(comparison(second).same).toBe(1);
  });
  it("does not count horizontal pairs across an aisle as repeated neighbors", () => {
    const state = fixture(2);
    state.preview = [null, "s1", "s2", null, null];
    const confirmed = confirm(state, "h", "2026-10-01T00:00:00Z");
    expect(comparison(confirmed).repeatedNeighbors).toBe(0);
    confirmed.layout.aisles = [];
    expect(comparison(confirmed).repeatedNeighbors).toBe(0);
  });
  it("rejects malformed backups, duplicate students, bad snapshots and dangerous identity keys", () => {
    for (const mutation of [
      (s: SeatState) => {
        s.version = 2 as 1;
      },
      (s: SeatState) => {
        s.students[0] = { id: "__proto__", number: 1, name: "가상" };
      },
      (s: SeatState) => {
        s.students.push({ ...s.students[0], id: "duplicate", number: 1, name: "가상" });
      },
      (s: SeatState) => {
        s.preview = ["s1"];
      },
    ]) {
      const state = fixture();
      mutation(state);
      expect(() => decodeState(state)).toThrow();
    }
  });
  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    "seed %i keeps all hard constraints after automatic and soft optimization",
    (seed) => {
      const state = fixture(20);
      state.layout = { rows: 5, columns: 5, frontRows: 2, blocked: [24], aisles: [2] };
      state.rules.fixed = { s1: 0, s2: 4 };
      state.rules.front = ["s1", "s3", "s4"];
      state.rules.excluded = ["s20"];
      state.rules.separated = [
        ["s1", "s2"],
        ["s3", "s4"],
      ];
      const first = arrange(state, rng(seed));
      validateSeats(first, first.preview ?? []);
      const second = arrange(confirm(first, `h${seed}`, "2026-10-01T00:00:00Z"), rng(seed + 41));
      validateSeats(second, second.preview ?? []);
      expect(second.rules).toEqual(state.rules);
    },
  );
  it.each([500, 1000])("places %i students with fixed/excluded/front conditions within a bounded time", (count) => {
    const state = fixture(count);
    state.layout = { rows: count / 25, columns: 25, frontRows: 2, aisles: [5, 10, 15, 20], blocked: [] };
    state.rules.fixed = Object.fromEntries(state.students.slice(0, 20).map((s, i) => [s.id, i]));
    state.rules.excluded = state.students.slice(-50).map((s) => s.id);
    state.rules.front = state.students.slice(0, 40).map((s) => s.id);
    const started = performance.now(),
      first = arrange(state, rng(count)),
      elapsed = performance.now() - started;
    validateSeats(first, first.preview ?? []);
    expect(first.preview?.filter(Boolean)).toHaveLength(count - 50);
    expect(elapsed).toBeLessThan(200);
    console.info(`synthetic-${count} allocation: ${elapsed.toFixed(1)}ms`);
    const second = arrange(confirm(first, `h${count}`, "2026-10-01T00:00:00Z"), rng(count + 1));
    validateSeats(second, second.preview ?? []);
  });
  it("keeps a 1000-student allocation bounded when separation activates search", () => {
    const state = fixture(1000);
    state.layout = { rows: 40, columns: 25, frontRows: 2, aisles: [], blocked: [] };
    state.rules.fixed = { s1: 0, s2: 24 };
    state.rules.front = state.students.slice(0, 40).map((s) => s.id);
    state.rules.excluded = state.students.slice(-50).map((s) => s.id);
    state.rules.separated = [["s1", "s2"]];
    const started = performance.now(),
      next = arrange(state, rng(101));
    validateSeats(next, next.preview ?? []);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
