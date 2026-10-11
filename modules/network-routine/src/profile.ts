// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { NetworkRules, Ipv4Patch, RoutineStatus, NetworkSnapshot as HostSnapshot } from "@deck/sdk";
import { DAY_KEYS, defaultSettings, type Settings, type WifiSnapshot, type NetworkSnapshot } from "./logic.ts";
export function rulesFor(settings: Settings): NetworkRules {
  return {
    decisionMode: settings.decision_mode === "wifi_only" ? "wifi-only" : settings.decision_mode,
    days: DAY_KEYS.map((key) => ({ ...settings.schedule.days[key] })),
    internalNames: [...settings.wifi_rules.internal_names],
    externalNames: [...settings.wifi_rules.external_names],
  };
}
export function patchFor(settings: Settings): Ipv4Patch {
  const p = settings.internal;
  return {
    address: p.ip.trim() || null,
    mask: p.mask.trim() || null,
    gateway: p.gateway.trim() || null,
    dns: [p.dns1, p.dns2].map((s) => s.trim()).filter(Boolean),
  };
}
export function restoreSettings(status: RoutineStatus): Settings {
  const base = defaultSettings();
  return {
    ...base,
    adapter_name: status.adapter.displayName,
    automation_enabled: status.enabled,
    decision_mode: status.rules.decisionMode === "wifi-only" ? "wifi_only" : status.rules.decisionMode,
    internal: {
      ip: status.internal.address ?? "",
      mask: status.internal.mask ?? "",
      gateway: status.internal.gateway ?? "",
      dns1: status.internal.dns[0] ?? "",
      dns2: status.internal.dns[1] ?? "",
    },
    schedule: {
      ...base.schedule,
      days: Object.fromEntries(
        DAY_KEYS.map((key, index) => [key, { ...base.schedule.days[key], ...status.rules.days[index] }]),
      ) as Settings["schedule"]["days"],
    },
    wifi_rules: { internal_names: [...status.rules.internalNames], external_names: [...status.rules.externalNames] },
  };
}
export function wifiFor(snapshot: HostSnapshot | null): WifiSnapshot {
  return {
    connected: snapshot?.connectedWifi ?? "",
    names: snapshot?.visibleWifi ?? [],
    location_permission_required: snapshot?.locationPermissionRequired ?? false,
    elevation_required: snapshot?.elevationRequired ?? false,
  };
}
export function networkFor(snapshot: HostSnapshot | null): NetworkSnapshot | null {
  return snapshot ? { dhcp: snapshot.dhcp ? "enabled" : "disabled", ips: snapshot.ips, dns: snapshot.dns } : null;
}
export function localTimestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
export const triggerLabels: Record<string, string> = {
  boot: "부팅",
  logon: "로그온",
  unlock: "잠금 해제",
  console: "콘솔 복귀",
  wifi: "Wi-Fi 연결·해제",
  schedule: "시간표 경계",
};
export function reasonLabel(source: string): string {
  const labels: Record<string, string> = {
    schedule: "요일별 시간표",
    wifi_connected_internal: "연결 Wi-Fi가 내부망 이름과 일치",
    wifi_connected_external: "연결 Wi-Fi가 외부망 이름과 일치",
    wifi_visible_internal: "주변 Wi-Fi에 내부망 이름만 감지",
    wifi_visible_external: "주변 Wi-Fi에 외부망 이름만 감지",
    wifi_visible_ambiguous_schedule: "내·외부 Wi-Fi가 함께 감지되어 시간표를 사용",
    wifi_visible_ambiguous: "내·외부 Wi-Fi가 함께 감지되어 현재 상태 유지",
    wifi_scan_permission: "위치 권한이 없어 현재 상태 유지",
    wifi_none: "Wi-Fi 이름이 일치하지 않아 현재 상태 유지",
    wifi_connected_none: "연결 Wi-Fi 이름이 일치하지 않아 현재 상태 유지",
    wifi_visible_empty: "Wi-Fi가 감지되지 않아 현재 상태 유지",
  };
  return labels[source] ?? "저장한 조건을 확인해 주세요";
}
