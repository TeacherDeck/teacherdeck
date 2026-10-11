// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { defaultSettings, DAY_KEYS } from "./logic.ts";
import { patchFor, rulesFor, restoreSettings, localTimestamp } from "./profile.ts";
import type { RoutineStatus } from "@deck/sdk";
describe("native structured profile adapter", () => {
  it("preserves all seven overnight schedules and Wi-Fi-only mode", () => {
    const s = defaultSettings();
    s.decision_mode = "wifi_only";
    s.schedule.days.mon = { enabled: true, start: "22:00", end: "06:00" };
    s.wifi_rules = { internal_names: ["합성 내부망"], external_names: ["합성 외부망"] };
    expect(rulesFor(s).decisionMode).toBe("wifi-only");
    expect(rulesFor(s).days[0]).toEqual(s.schedule.days.mon);
    expect(rulesFor(s).days).toHaveLength(7);
  });
  it("supports DNS-only without silently requesting address erasure", () => {
    const s = defaultSettings();
    s.internal.dns1 = "192.0.2.53";
    expect(patchFor(s)).toEqual({ address: null, mask: null, gateway: null, dns: ["192.0.2.53"] });
  });
  it("restores saved rows independently of default base time", () => {
    const s = defaultSettings();
    s.schedule.days.fri = { enabled: true, start: "17:00", end: "01:00" };
    const status = {
      rules: rulesFor(s),
      adapter: { displayName: "합성 어댑터" },
      enabled: true,
      internal: patchFor(s),
    } as RoutineStatus;
    const restored = restoreSettings(status);
    expect(restored.schedule.days.fri).toEqual(s.schedule.days.fri);
    expect(DAY_KEYS.map((k) => restored.schedule.days[k])).toEqual(rulesFor(s).days);
  });
  it("uses local wall-clock components for pure policy", () => {
    expect(localTimestamp(new Date(2026, 6, 6, 8, 20, 0))).toBe("2026-07-06T08:20:00");
  });
});
