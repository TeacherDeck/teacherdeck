// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: unit tests for pure logic, mock-host tests for host calls (see modules/timer).
import { describe, expect, it } from "vitest";
import {
  DAY_KEYS,
  buildScheduleTriggerSpecs,
  canEvaluateSavedSettings,
  clearStaleManualOverride,
  completeApply,
  currentDecisionInfo,
  currentSegmentInfo,
  defaultSettings,
  emptyRoutineState,
  internalIntervalForDate,
  markManualOverride,
  mergedInternalIntervals,
  modeMatchesCurrentState,
  namesText,
  nextWeeklyBoundary,
  normalizeSettings,
  normalizeWifiName,
  parseNameList,
  parseTime,
  reconcilePlan,
  stateAfterSave,
  summarizeWifiNames,
  usesScheduleTriggers,
  usesWifiNameTriggers,
  validateSettings,
  wifiNamesSignature,
} from "./logic.ts";
import type { DecisionMode, Settings, WifiSnapshot } from "./logic.ts";
import { sourceCases, sourceProvenance } from "./source-cases.ts";

const wifi: WifiSnapshot = { connected: "", names: [], location_permission_required: false, elevation_required: false };
const monday = "2026-07-06T10:00:00";
function settings(mode: DecisionMode = "schedule"): Settings {
  const value = defaultSettings();
  value.automation_enabled = true;
  value.decision_mode = mode;
  value.wifi_rules = { internal_names: ["Office"], external_names: ["Home"] };
  return value;
}
function noDays(): Settings {
  const value = settings();
  for (const key of DAY_KEYS) value.schedule.days[key].enabled = false;
  return value;
}

describe("original-source differential contract", () => {
  it("records all original assertions and exact source hash", () => {
    expect(sourceProvenance.originalTests).toBe(39);
    expect(sourceProvenance.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(sourceCases.map((value, index) => ({ value, index })))(
    "matches original decision and scheduler boundaries $index",
    ({ value }) => {
      const config = normalizeSettings(value.settings);
      const actual = currentDecisionInfo(config, value.when, value.wifi);
      const { mode, segment_id, source, start, end, matched_wifi_name } = actual;
      expect({
        mode,
        segment_id,
        source,
        start,
        end,
        ...(matched_wifi_name === undefined ? {} : { matched_wifi_name }),
      }).toEqual(value.expected);
      expect(buildScheduleTriggerSpecs(config)).toEqual(value.boundaries);
    },
  );
});

describe("original parsing and normalization", () => {
  it("splits names and deduplicates without losing displayed spelling", () => {
    expect(parseNameList("Office1, Office2; Office1\nHome")).toEqual(["Office1", "Office2", "Home"]);
    expect(parseNameList(["A", "a", " B "])).toEqual(["A", "B"]);
    expect(parseNameList(null)).toEqual([]);
    expect(namesText("a,b;c")).toBe("a, b, c");
  });
  it("keeps exact Python Unicode folding and whitespace normalization", () => {
    expect(normalizeWifiName("  Office   WiFi ")).toBe("office wifi");
    expect(normalizeWifiName("Straße Σς ᾈ")).toBe("strasse σσ ἀι");
    expect(parseNameList(["Straße", "STRASSE"])).toEqual(["Straße"]);
  });
  it("summarizes and signs observed names independent of order", () => {
    expect(summarizeWifiNames([])).toBe("-");
    expect(summarizeWifiNames(["1", "2", "3", "4", "5"])).toBe("1, 2, 3, 4 외 1개");
    expect(wifiNamesSignature(["B", "a"])).toBe(wifiNamesSignature(["A ", "b"]));
  });
  it("migrates legacy company wifi and fills missing defaults without mutating input", () => {
    const original = { company_wifi: { enabled: true, names: ["OfficeA", "OfficeB"] } };
    expect(normalizeSettings(original).decision_mode).toBe("hybrid");
    expect(normalizeSettings(original).wifi_rules.internal_names).toEqual(["OfficeA", "OfficeB"]);
    expect(normalizeSettings({ decision_mode: "nonsense" }).decision_mode).toBe("schedule");
    expect(original).toEqual({ company_wifi: { enabled: true, names: ["OfficeA", "OfficeB"] } });
  });
  it("accepts original time spelling and rejects invalid calendar/time", () => {
    expect(parseTime(" 9:0 ")).toBe(540);
    expect(() => parseTime("25:00")).toThrow();
    expect(() => parseTime("0920")).toThrow();
    expect(() => currentSegmentInfo(settings(), "2026-02-30T10:00:00")).toThrow();
    expect(() => currentSegmentInfo(settings(), "2026-07-06T10:00:00Z")).toThrow();
  });
  it("validates adapter, IPv4, names and enabled or disabled schedule entries", () => {
    expect(validateSettings(defaultSettings())).toEqual([]);
    const value = settings("hybrid");
    value.adapter_name = " ";
    value.internal.ip = "999.1.1.1";
    value.wifi_rules = { internal_names: ["Cafe"], external_names: ["cafe"] };
    value.schedule.days.sun.start = "25:00";
    expect(validateSettings(value)).toHaveLength(4);
    value.wifi_rules = { internal_names: [], external_names: [] };
    expect(validateSettings(value).some((issue) => issue.includes("이름을 입력"))).toBe(true);
  });
});

describe("calendar intervals", () => {
  it("disables days and equal boundaries", () => {
    const value = noDays();
    expect(internalIntervalForDate(value, "2026-07-06")).toBeNull();
    value.schedule.days.mon = { enabled: true, start: "09:00", end: "09:00" };
    expect(internalIntervalForDate(value, "2026-07-06")).toBeNull();
    expect(currentSegmentInfo(value, monday).segment_id).toBe("external|always");
  });
  it("extends overnight through midnight and merges adjacent daily ranges", () => {
    const value = noDays();
    value.schedule.days.mon = { enabled: true, start: "20:00", end: "09:00" };
    value.schedule.days.tue = { enabled: true, start: "08:00", end: "17:00" };
    expect(internalIntervalForDate(value, "2026-07-06")).toEqual(["2026-07-06T20:00:00", "2026-07-07T09:00:00"]);
    expect(mergedInternalIntervals(value, monday)).toContainEqual(["2026-07-06T20:00:00", "2026-07-07T17:00:00"]);
    expect(currentSegmentInfo(value, "2026-07-07T09:00:00").mode).toBe("internal");
    expect(currentSegmentInfo(value, "2026-07-07T17:00:00").mode).toBe("external");
  });
  it("uses exclusive end and stable outside interval identity", () => {
    const value = noDays();
    value.schedule.days.mon = { enabled: true, start: "09:00", end: "18:00" };
    expect(currentSegmentInfo(value, "2026-07-06T09:00:00").mode).toBe("internal");
    expect(currentSegmentInfo(value, "2026-07-06T18:00:00").mode).toBe("external");
    expect(currentSegmentInfo(value, "2026-07-06T05:00:00").segment_id).toBe(
      currentSegmentInfo(value, "2026-07-06T06:00:00").segment_id,
    );
  });
  it("builds weekly overnight/end triggers and deduplicates matching boundaries", () => {
    const value = noDays();
    value.schedule.days.mon = { enabled: true, start: "22:00", end: "06:00" };
    value.schedule.days.tue = { enabled: true, start: "06:00", end: "17:00" };
    expect(buildScheduleTriggerSpecs(value)).toEqual([
      { day_key: "mon", time: "22:00" },
      { day_key: "tue", time: "06:00" },
      { day_key: "tue", time: "17:00" },
    ]);
    expect(nextWeeklyBoundary("mon", "11:00", monday)).toBe("2026-07-06T11:00:00");
    expect(nextWeeklyBoundary("mon", "10:00", monday)).toBe("2026-07-13T10:00:00");
  });
});

describe("Wi-Fi precedence and trigger policy", () => {
  it("schedule mode does not consume surrounding wifi observations or permission", () => {
    const observed = currentDecisionInfo(settings(), monday, {
      ...wifi,
      names: ["Home"],
      location_permission_required: true,
    });
    expect(observed.source).toBe("schedule");
    expect(observed.visible_wifi_names).toEqual([]);
    expect(observed.wifi_scan_location_permission_required).toBe(false);
    expect(usesWifiNameTriggers(settings())).toBe(false);
  });
  it("connected match wins even against opposite surrounding match", () => {
    expect(
      currentDecisionInfo(settings("hybrid"), monday, { ...wifi, connected: "home", names: ["Office"] }).mode,
    ).toBe("external");
    expect(
      currentDecisionInfo(settings("hybrid"), "2026-07-06T03:00:00", { ...wifi, connected: "office", names: ["Home"] })
        .mode,
    ).toBe("internal");
  });
  it("ambiguous surrounding names fallback in hybrid and hold in wifi-only", () => {
    const observed = { ...wifi, names: ["Home", "Office"] };
    expect(currentDecisionInfo(settings("hybrid"), monday, observed).source).toBe("wifi_visible_ambiguous_schedule");
    expect(currentDecisionInfo(settings("wifi_only"), monday, observed).mode).toBe("");
  });
  it.each([
    [{ ...wifi, location_permission_required: true }, "wifi_scan_permission"],
    [{ ...wifi, names: ["Other"] }, "wifi_none"],
    [{ ...wifi, connected: "Other" }, "wifi_connected_none"],
    [wifi, "wifi_visible_empty"],
  ] as const)("holds unmatched wifi-only state", (observed, source) => {
    const info = currentDecisionInfo(settings("wifi_only"), monday, { ...observed, names: [...observed.names] });
    expect(info.source).toBe(source);
    expect(info.mode).toBe("");
  });
  it("enables only mode-related trigger families", () => {
    expect(usesScheduleTriggers(settings("wifi_only"))).toBe(false);
    expect(usesWifiNameTriggers(settings("wifi_only"))).toBe(true);
    expect(usesScheduleTriggers(settings())).toBe(true);
  });
});

describe("manual override and apply planning", () => {
  it("holds manual choice only inside the same decision segment", () => {
    const value = settings(),
      decision = currentDecisionInfo(value, monday, wifi);
    const manual = markManualOverride(emptyRoutineState(), decision, "external");
    expect(reconcilePlan(value, manual, decision, null).action).toBe("manual");
    const next = currentDecisionInfo(value, "2026-07-06T20:00:00", wifi);
    expect(clearStaleManualOverride(manual, next.segment_id).manual_override_segment_id).toBe("");
    expect(reconcilePlan(value, manual, next, null).action).toBe("apply");
    expect(manual.manual_override_segment_id).toBe(decision.segment_id);
  });
  it("does not mark a proposed or failed apply as handled", () => {
    const value = settings();
    value.internal.ip = "192.0.2.10";
    const decision = currentDecisionInfo(value, monday, wifi),
      original = emptyRoutineState();
    const planned = reconcilePlan(value, original, decision, { dhcp: "Enabled", ips: ["192.0.2.20"], dns: [] });
    expect(planned.action).toBe("apply");
    expect(planned.state.last_handled_segment_id).toBe("");
    const completed = completeApply(planned.state, decision);
    expect(reconcilePlan(value, completed, decision, null).action).toBe("handled");
    expect(original).toEqual(emptyRoutineState());
  });
  it("keeps unknown wifi state and automation-off state without OS apply", () => {
    const value = settings("wifi_only"),
      decision = currentDecisionInfo(value, monday, wifi);
    expect(reconcilePlan(value, emptyRoutineState(), decision, null).action).toBe("keep");
    value.automation_enabled = false;
    expect(reconcilePlan(value, emptyRoutineState(), decision, null).action).toBe("disabled");
  });
  it("compares selected internal fields and ordered DNS only", () => {
    const value = settings();
    value.internal.dns1 = "192.0.2.53";
    value.internal.dns2 = "192.0.2.54";
    const actual = { dhcp: "Enabled", ips: ["192.0.2.20"], dns: ["192.0.2.53", "192.0.2.54"] };
    expect(modeMatchesCurrentState(value, emptyRoutineState(), "internal", actual)).toBe(true);
    expect(
      modeMatchesCurrentState(value, emptyRoutineState(), "internal", { ...actual, dns: [...actual.dns].reverse() }),
    ).toBe(false);
    expect(modeMatchesCurrentState(value, emptyRoutineState(), "external", actual)).toBe(false);
    value.internal.ip = "192.0.2.20";
    value.internal.mask = "255.255.255.0";
    value.internal.gateway = "192.0.2.1";
    expect(modeMatchesCurrentState(value, emptyRoutineState(), "internal", actual)).toBe(false);
  });
  it("resets decision history only when relevant profile/rule settings change", () => {
    const value = settings(),
      state = markManualOverride(emptyRoutineState(), currentDecisionInfo(value, monday, wifi), "external");
    expect(stateAfterSave(value, { ...value, automation_enabled: false }, state)).toEqual(state);
    expect(stateAfterSave(value, { ...value, adapter_name: "Test Adapter" }, state)).toEqual(emptyRoutineState());
    expect(canEvaluateSavedSettings(true)).toBe(false);
    expect(canEvaluateSavedSettings(false)).toBe(true);
  });
});
