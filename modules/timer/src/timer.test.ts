// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { MAX_DURATION_MS, create, format, pause, remaining, reset, start, tick, toggle } from "./timer.ts";

describe("timer state machine", () => {
  it("counts down from timestamps", () => {
    let t = start(create(60_000), 1_000);
    expect(remaining(t, 31_000)).toBe(30_000);
    t = pause(t, 31_000);
    expect(remaining(t, 99_000)).toBe(30_000);
    t = start(t, 100_000);
    expect(remaining(t, 110_000)).toBe(20_000);
  });

  it("finishes exactly once and restarts from full", () => {
    let t = start(create(5_000), 0);
    t = tick(t, 4_999);
    expect(t.status).toBe("running");
    t = tick(t, 5_000);
    expect(t.status).toBe("finished");
    expect(remaining(t, 9_999_999)).toBe(0);
    t = start(t, 10_000);
    expect(remaining(t, 10_000)).toBe(5_000);
  });

  it("toggle and reset", () => {
    let t = toggle(create(10_000), 0);
    expect(t.status).toBe("running");
    t = toggle(t, 2_000);
    expect(t.status).toBe("paused");
    expect(reset(t)).toEqual(create(10_000));
  });

  it("clamps duration and ignores zero-length starts", () => {
    expect(create(-5).durationMs).toBe(0);
    expect(create(MAX_DURATION_MS * 2).durationMs).toBe(MAX_DURATION_MS);
    expect(start(create(0), 0).status).toBe("idle");
  });

  it("formats with ceiling seconds", () => {
    expect(format(0)).toBe("0:00");
    expect(format(1)).toBe("0:01");
    expect(format(59_001)).toBe("1:00");
    expect(format(3_600_000)).toBe("1:00:00");
    expect(format(3_661_000)).toBe("1:01:01");
  });
});
