// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Keep pure logic in plain functions so it can be unit-tested without the host (MOD-015).
import { casefoldMapping } from "./unicode-casefold.ts";

// Source: network_routine 1.4.0 (9bcae0084339fec77b1d4f48da167eaf44f340ee).
// Pure policy only. No network scan, native execution, scheduler or persistence.
export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
export type Mode = "internal" | "external" | "";
export type DecisionMode = "schedule" | "hybrid" | "wifi_only";
export interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
}
export interface Settings {
  adapter_name: string;
  automation_enabled: boolean;
  decision_mode: DecisionMode;
  schedule: { base_start: string; base_end: string; days: Record<DayKey, DaySchedule> };
  internal: { ip: string; mask: string; gateway: string; dns1: string; dns2: string };
  wifi_rules: { internal_names: string[]; external_names: string[] };
}
export interface WifiSnapshot {
  connected: string;
  names: string[];
  location_permission_required: boolean;
  elevation_required: boolean;
}
export interface Segment {
  mode: Mode;
  segment_id: string;
  start: string | null;
  end: string | null;
}
export interface Decision extends Segment {
  source: string;
  matched_wifi_name?: string;
  wifi_scan_location_permission_required: boolean;
  wifi_scan_elevation_required: boolean;
  visible_wifi_names: string[];
}
export interface RoutineState {
  manual_override_segment_id: string;
  manual_override_mode: Mode;
  last_handled_segment_id: string;
  last_handled_mode: Mode;
  last_applied_mode: Mode;
}
export interface NetworkSnapshot {
  dhcp: string;
  ips: string[];
  dns: string[];
}
export interface ReconcilePlan {
  action: "disabled" | "manual" | "keep" | "handled" | "matched" | "apply";
  desired: Mode;
  state: RoutineState;
}

export function defaultSettings(): Settings {
  return {
    adapter_name: "Wi-Fi",
    automation_enabled: false,
    decision_mode: "schedule",
    schedule: {
      base_start: "08:20",
      base_end: "16:20",
      days: Object.fromEntries(
        DAY_KEYS.map((day, index) => [day, { enabled: index < 5, start: "08:20", end: "16:20" }]),
      ) as Record<DayKey, DaySchedule>,
    },
    internal: { ip: "", mask: "", gateway: "", dns1: "", dns2: "" },
    wifi_rules: { internal_names: [], external_names: [] },
  };
}
// Exact original Python Unicode casefold; display strings remain unmodified.
function casefold(value: string): string {
  return [...value].map((char) => casefoldMapping[char] ?? char).join("");
}
export function parseNameList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(/[,;\r\n]+/)
      : value == null
        ? []
        : [String(value)];
  const seen = new Set<string>();
  return raw
    .map((item) => item.trim())
    .filter((item) => {
      const key = casefold(item);
      if (item === "" || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export function normalizeWifiName(value: unknown): string {
  return casefold(
    String(value ?? "")
      .trim()
      .replace(/\s+/g, " "),
  );
}
export function wifiNamesSignature(names: string[]): string {
  return [...new Set(names.map(normalizeWifiName).filter(Boolean))].sort().join("|") || "-";
}
export function namesText(value: unknown): string {
  return parseNameList(value).join(", ");
}
export function summarizeWifiNames(names: string[], limit = 4): string {
  const clean = names.filter((name) => name.trim() !== "");
  return clean.length === 0
    ? "-"
    : clean.length <= limit
      ? clean.join(", ")
      : `${clean.slice(0, limit).join(", ")} 외 ${clean.length - limit}개`;
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function normalizeSettings(value: unknown): Settings {
  const source = record(value),
    defaults = defaultSettings(),
    legacy = record(source["company_wifi"]),
    wifi = record(source["wifi_rules"]),
    internal = record(source["internal"]),
    schedule = record(source["schedule"]),
    days = record(schedule["days"]);
  const modeValue = String(source["decision_mode"] ?? "")
    .trim()
    .toLowerCase();
  const mode =
    modeValue === "schedule" || modeValue === "hybrid" || modeValue === "wifi_only"
      ? modeValue
      : legacy["enabled"]
        ? "hybrid"
        : "schedule";
  return {
    adapter_name: typeof source["adapter_name"] === "string" ? source["adapter_name"] : defaults.adapter_name,
    automation_enabled: source["automation_enabled"] === true,
    decision_mode: mode,
    internal: Object.fromEntries(
      Object.entries(defaults.internal).map(([key, fallback]) => [
        key,
        typeof internal[key] === "string" ? internal[key] : fallback,
      ]),
    ) as Settings["internal"],
    schedule: {
      base_start: typeof schedule["base_start"] === "string" ? schedule["base_start"] : defaults.schedule.base_start,
      base_end: typeof schedule["base_end"] === "string" ? schedule["base_end"] : defaults.schedule.base_end,
      days: Object.fromEntries(
        DAY_KEYS.map((key) => [key, { ...defaults.schedule.days[key], ...record(days[key]) }]),
      ) as Record<DayKey, DaySchedule>,
    },
    wifi_rules: {
      internal_names: parseNameList(
        "internal_names" in wifi
          ? wifi["internal_names"]
          : "internal_names" in legacy
            ? legacy["internal_names"]
            : legacy["names"],
      ),
      external_names: parseNameList("external_names" in wifi ? wifi["external_names"] : legacy["external_names"]),
    },
  };
}
export function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
  if (match === null) throw new Error("시간은 HH:MM 형식으로 입력해 주세요.");
  const hours = Number(match[1]),
    minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("시간은 HH:MM 형식으로 입력해 주세요.");
  return hours * 60 + minutes;
}
export function validateSettings(settings: Settings): string[] {
  const errors: string[] = [];
  if (!settings.adapter_name.trim()) errors.push("네트워크 어댑터를 선택해 주세요.");
  for (const value of Object.values(settings.internal)) {
    const parts = value.trim().split(".");
    if (
      value.trim() !== "" &&
      (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255))
    )
      errors.push("IPv4 주소 형식을 확인해 주세요.");
  }
  if (
    settings.decision_mode !== "schedule" &&
    settings.wifi_rules.internal_names.length === 0 &&
    settings.wifi_rules.external_names.length === 0
  )
    errors.push("내부망 또는 외부망 이름을 입력해 주세요.");
  const internalNames = new Set(settings.wifi_rules.internal_names.map(normalizeWifiName));
  if (settings.wifi_rules.external_names.some((name) => internalNames.has(normalizeWifiName(name))))
    errors.push("같은 이름을 내부망과 외부망에 함께 넣을 수 없어요.");
  for (const day of DAY_KEYS) {
    try {
      parseTime(settings.schedule.days[day].start);
      parseTime(settings.schedule.days[day].end);
    } catch {
      errors.push("시간은 HH:MM 형식으로 입력해 주세요.");
    }
  }
  return [...new Set(errors)];
}
const DAY_MS = 86_400_000;
// UTC arithmetic is only a timezone-neutral calendar representation. Inputs are Windows
// local wall clock strings, never UTC instants or a browser timezone dependent Date.
function localMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?$/.test(value)) throw new Error("날짜와 시간을 확인해 주세요.");
  const millis = Date.parse(`${value.length === 10 ? `${value}T00:00:00` : value}Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, value.length) !== value)
    throw new Error("날짜와 시간을 확인해 주세요.");
  return millis;
}
function iso(millis: number): string {
  return new Date(millis).toISOString().slice(0, 19);
}
function dayKey(millis: number): DayKey {
  return DAY_KEYS[(new Date(millis).getUTCDay() + 6) % 7] ?? "mon";
}
export function internalIntervalForDate(settings: Settings, date: string): [string, string] | null {
  const midnight = localMillis(date),
    config = settings.schedule.days[dayKey(midnight)];
  if (!config.enabled) return null;
  const start = parseTime(config.start),
    end = parseTime(config.end);
  if (start === end) return null;
  return [iso(midnight + start * 60_000), iso(midnight + end * 60_000 + (start > end ? DAY_MS : 0))];
}
export function mergedInternalIntervals(settings: Settings, when: string, before = 8, after = 8): [string, string][] {
  const midnight = localMillis(when.slice(0, 10)),
    ranges: [string, string][] = [];
  for (let offset = -before; offset <= after; offset++) {
    const interval = internalIntervalForDate(settings, iso(midnight + offset * DAY_MS).slice(0, 10));
    if (interval !== null) ranges.push(interval);
  }
  ranges.sort(([first], [second]) => first.localeCompare(second));
  const merged: [string, string][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last === undefined || start > last[1]) merged.push([start, end]);
    else if (end > last[1]) last[1] = end;
  }
  return merged;
}
export function currentSegmentInfo(settings: Settings, when: string): Segment {
  localMillis(when);
  const intervals = mergedInternalIntervals(settings, when);
  let previous: string | null = null,
    next: string | null = null;
  for (const [start, end] of intervals) {
    if (start <= when && when < end) return { mode: "internal", segment_id: `internal|${start}|${end}`, start, end };
    if (end <= when) previous = end;
    else if (start > when) {
      next = start;
      break;
    }
  }
  return {
    mode: "external",
    segment_id:
      previous === null && next === null ? "external|always" : `external|${previous ?? "past"}|${next ?? "future"}`,
    start: previous,
    end: next,
  };
}
export function currentDecisionInfo(settings: Settings, when: string, wifi: WifiSnapshot): Decision {
  const info: Decision = {
    ...currentSegmentInfo(settings, when),
    source: "schedule",
    visible_wifi_names: settings.decision_mode === "schedule" ? [] : [...wifi.names],
    wifi_scan_location_permission_required:
      settings.decision_mode === "schedule" ? false : wifi.location_permission_required,
    wifi_scan_elevation_required: settings.decision_mode === "schedule" ? false : wifi.elevation_required,
  };
  if (settings.decision_mode === "schedule") return info;
  const internal = new Map(settings.wifi_rules.internal_names.map((name) => [normalizeWifiName(name), name])),
    external = new Map(settings.wifi_rules.external_names.map((name) => [normalizeWifiName(name), name])),
    connected = normalizeWifiName(wifi.connected);
  for (const [mode, lookup] of [
    ["internal", internal],
    ["external", external],
  ] as const) {
    const match = connected ? lookup.get(connected) : undefined;
    if (match !== undefined)
      return {
        ...info,
        mode,
        segment_id: `wifi|${mode}|${casefold(match)}`,
        source: `wifi_connected_${mode}`,
        matched_wifi_name: match,
      };
  }
  const visible = new Set(wifi.names.map(normalizeWifiName).filter(Boolean)),
    matchedInternal = settings.wifi_rules.internal_names.find((name) => visible.has(normalizeWifiName(name))),
    matchedExternal = settings.wifi_rules.external_names.find((name) => visible.has(normalizeWifiName(name)));
  if (matchedInternal !== undefined && matchedExternal === undefined)
    return {
      ...info,
      mode: "internal",
      segment_id: `wifi-visible|internal|${casefold(matchedInternal)}`,
      source: "wifi_visible_internal",
      matched_wifi_name: matchedInternal,
    };
  if (matchedExternal !== undefined && matchedInternal === undefined)
    return {
      ...info,
      mode: "external",
      segment_id: `wifi-visible|external|${casefold(matchedExternal)}`,
      source: "wifi_visible_external",
      matched_wifi_name: matchedExternal,
    };
  if (matchedInternal !== undefined && matchedExternal !== undefined)
    return settings.decision_mode === "hybrid"
      ? { ...info, source: "wifi_visible_ambiguous_schedule" }
      : {
          ...info,
          mode: "",
          segment_id: `wifi-visible|ambiguous|${wifiNamesSignature(wifi.names)}`,
          source: "wifi_visible_ambiguous",
        };
  if (settings.decision_mode === "hybrid") return info;
  if (wifi.location_permission_required)
    return { ...info, mode: "", segment_id: "wifi-visible|permission", source: "wifi_scan_permission" };
  if (wifi.names.length > 0)
    return {
      ...info,
      mode: "",
      segment_id: `wifi-visible|none|${wifiNamesSignature(wifi.names)}`,
      source: "wifi_none",
    };
  if (wifi.connected)
    return {
      ...info,
      mode: "",
      segment_id: `wifi|none|${normalizeWifiName(wifi.connected)}`,
      source: "wifi_connected_none",
    };
  return { ...info, mode: "", segment_id: "wifi-visible|empty", source: "wifi_visible_empty" };
}
export function emptyRoutineState(): RoutineState {
  return {
    manual_override_segment_id: "",
    manual_override_mode: "",
    last_handled_segment_id: "",
    last_handled_mode: "",
    last_applied_mode: "",
  };
}
export function markManualOverride(state: RoutineState, decision: Decision, mode: Exclude<Mode, "">): RoutineState {
  return {
    ...state,
    manual_override_segment_id: decision.segment_id,
    manual_override_mode: mode,
    last_applied_mode: mode,
  };
}
export function clearStaleManualOverride(state: RoutineState, segmentId: string): RoutineState {
  return state.manual_override_segment_id && state.manual_override_segment_id !== segmentId
    ? { ...state, manual_override_segment_id: "", manual_override_mode: "" }
    : { ...state };
}
export function modeMatchesCurrentState(
  settings: Settings,
  _state: RoutineState,
  desired: Mode,
  actual: NetworkSnapshot | null,
): boolean {
  // This observation has no DNS source, subnet mask or gateway. Never infer them.
  if (actual === null || desired === "external") return false;
  const ip = settings.internal.ip.trim(),
    dns = [settings.internal.dns1.trim(), settings.internal.dns2.trim()].filter(Boolean);
  if (ip) return false;
  if (dns.length !== actual.dns.length || dns.some((value, index) => value !== actual.dns[index])) return false;
  return dns.length > 0;
}
export function reconcilePlan(
  settings: Settings,
  inputState: RoutineState,
  decision: Decision,
  actual: NetworkSnapshot | null,
): ReconcilePlan {
  if (!settings.automation_enabled) return { action: "disabled", desired: decision.mode, state: { ...inputState } };
  const state = clearStaleManualOverride(inputState, decision.segment_id);
  if (state.manual_override_segment_id === decision.segment_id)
    return { action: "manual", desired: state.manual_override_mode || decision.mode, state };
  if (decision.mode === "")
    return {
      action: "keep",
      desired: "",
      state: { ...state, last_handled_segment_id: decision.segment_id, last_handled_mode: "" },
    };
  if (state.last_handled_segment_id === decision.segment_id)
    return { action: "handled", desired: decision.mode, state };
  if (modeMatchesCurrentState(settings, state, decision.mode, actual))
    return { action: "matched", desired: decision.mode, state: completeApply(state, decision) };
  return { action: "apply", desired: decision.mode, state };
}
// Never record a proposed OS apply as success. The adapter calls this only after success.
export function completeApply(state: RoutineState, decision: Decision): RoutineState {
  return {
    ...clearStaleManualOverride(state, decision.segment_id),
    last_applied_mode: decision.mode,
    last_handled_segment_id: decision.segment_id,
    last_handled_mode: decision.mode,
  };
}
export interface Boundary {
  day_key: DayKey;
  time: string;
}
export function buildScheduleTriggerSpecs(settings: Settings): Boundary[] {
  const seen = new Set<string>(),
    specs: Boundary[] = [];
  DAY_KEYS.forEach((day, index) => {
    const config = settings.schedule.days[day];
    if (!config.enabled) return;
    const start = parseTime(config.start),
      end = parseTime(config.end);
    if (start === end) return;
    const endDay = DAY_KEYS[(index + (start < end ? 0 : 1)) % 7] ?? "mon";
    for (const [key, minutes] of [
      [day, start],
      [endDay, end],
    ] as const) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
        identity = `${key}|${time}`;
      if (!seen.has(identity)) {
        seen.add(identity);
        specs.push({ day_key: key, time });
      }
    }
  });
  return specs;
}
export function nextWeeklyBoundary(day: DayKey, time: string, now: string): string {
  const millis = localMillis(now),
    midnight = localMillis(now.slice(0, 10)),
    daysAhead = (DAY_KEYS.indexOf(day) - DAY_KEYS.indexOf(dayKey(millis)) + 7) % 7,
    candidate = midnight + daysAhead * DAY_MS + parseTime(time) * 60_000;
  return iso(candidate <= millis ? candidate + 7 * DAY_MS : candidate);
}
export function usesScheduleTriggers(settings: Settings): boolean {
  return settings.decision_mode !== "wifi_only";
}
export function usesWifiNameTriggers(settings: Settings): boolean {
  return (
    settings.decision_mode !== "schedule" &&
    (settings.wifi_rules.internal_names.length > 0 || settings.wifi_rules.external_names.length > 0)
  );
}
export function settingsAffectDecision(first: Settings, second: Settings): boolean {
  return (
    JSON.stringify([first.adapter_name, first.internal, first.decision_mode, first.wifi_rules, first.schedule]) !==
    JSON.stringify([second.adapter_name, second.internal, second.decision_mode, second.wifi_rules, second.schedule])
  );
}
export function stateAfterSave(previous: Settings, updated: Settings, state: RoutineState): RoutineState {
  return settingsAffectDecision(previous, updated) ? emptyRoutineState() : { ...state };
}
export function canEvaluateSavedSettings(dirty: boolean): boolean {
  return !dirty;
}
