// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Structured local network profiles and source-compatible routine policy (ADR-0021).
use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use ts_rs::TS;

/// Fixed profile modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum NetworkMode {
    /// Saved internal address/DNS patch.
    Internal,
    /// Restore DHCP address and automatic DNS.
    External,
}
/// Original decision strategies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum NetworkDecisionMode {
    /// Weekly local-time schedule only.
    Schedule,
    /// Prefer Wi-Fi names, otherwise use schedule.
    Hybrid,
    /// Keep current state when Wi-Fi evidence is ambiguous.
    WifiOnly,
}
/// One weekday, Monday first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct NetworkDaySchedule {
    /// Enable this weekday.
    pub enabled: bool,
    /// Local HH:MM start.
    pub start: String,
    /// Local HH:MM exclusive end; overnight supported.
    pub end: String,
}
/// Saved policy with exactly seven weekdays.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkRules {
    /// Fixed decision strategy.
    pub decision_mode: NetworkDecisionMode,
    /// Exactly Monday through Sunday.
    pub days: Vec<NetworkDaySchedule>,
    /// Internal SSID allowlist, maximum 64.
    pub internal_names: Vec<String>,
    /// External SSID allowlist, maximum 64.
    pub external_names: Vec<String>,
}
/// IPv4 changes only; empty fields do not erase unchanged values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct Ipv4Patch {
    /// Empty means do not change the address.
    pub address: Option<String>,
    /// Required together with address.
    pub mask: Option<String>,
    /// Optional gateway when setting address.
    pub gateway: Option<String>,
    /// Ordered DNS servers; empty leaves DNS unchanged internally.
    pub dns: Vec<String>,
}
/// The fixed external mode always restores both DHCP settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct NetworkExternalProfile {
    /// Must be "dhcp".
    pub address: String,
    /// Must be "dhcp".
    pub dns: String,
}
/// Same-owner OS adapter discovery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    /// Opaque owner-bound token, never an interface index.
    pub adapter_handle: String,
    /// Display only, never logs.
    pub display_name: String,
    /// Ethernet, Wi-Fi or other.
    pub adapter_type: String,
    /// Current OS presence.
    pub available: bool,
}
/// Inspect a selected adapter; schedule-only policies use scanWifi=false.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkInspectArgs {
    /// Adapter token.
    pub adapter_handle: String,
    /// Explicitly request Wi-Fi observations.
    pub scan_wifi: bool,
}
/// Display-only OS observation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSnapshot {
    /// Automatic address configuration.
    pub dhcp: bool,
    /// Current IPv4 addresses.
    pub ips: Vec<String>,
    /// Current DNS order.
    pub dns: Vec<String>,
    /// Connected SSID.
    pub connected_wifi: String,
    /// Currently observed SSIDs.
    pub visible_wifi: Vec<String>,
    /// Windows denied location access.
    pub location_permission_required: bool,
    /// OS requires administrative access.
    pub elevation_required: bool,
}
/// Save one bounded profile, without changing OS settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkSaveProfileArgs {
    /// Adapter token.
    pub adapter_handle: String,
    /// Internal patch.
    pub internal: Ipv4Patch,
    /// Fixed DHCP mode.
    pub external: NetworkExternalProfile,
}
/// Persistent owner-bound profile token and optimistic concurrency revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfileRef {
    /// Opaque saved profile token.
    pub profile_handle: String,
    /// Checked on every mutation and runner start.
    pub revision: u32,
}
/// Save rules and register/remove the fixed native task recipe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkConfigureArgs {
    /// Saved profile token.
    pub profile_handle: String,
    /// Exact profile revision.
    pub revision: u32,
    /// Explicit automatic execution switch.
    pub enabled: bool,
    /// Validated saved rules.
    pub rules: NetworkRules,
}
/// Optional owner-bound routine selector.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkStatusArgs {
    /// Omit to restore the owner's latest routine.
    #[serde(default)]
    #[ts(optional)]
    pub routine_handle: Option<String>,
}
/// Owned routine operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkRoutineArgs {
    /// Opaque owner-bound routine token.
    pub routine_handle: String,
}
/// Explicit manual application of the saved profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetworkApplyArgs {
    /// Saved profile token.
    pub profile_handle: String,
    /// Mode chosen by user.
    pub mode: NetworkMode,
    /// Exact saved profile revision.
    pub revision: u32,
}
/// A fixed trigger's current registration state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTriggerStatus {
    /// boot/logon/unlock/console/wifi/schedule only.
    pub kind: String,
    /// This mode requires the trigger.
    pub required: bool,
    /// Registered with the current executable/rules revision.
    pub registered: bool,
}
/// Original decision including an unambiguous segment identifier.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkDecision {
    /// None means keep current settings.
    pub mode: Option<NetworkMode>,
    /// Source-compatible segment ID; contains SSID, never log.
    pub segment_id: String,
    /// Machine-readable original reason.
    pub source: String,
    /// Optional matched display SSID, never log.
    pub matched_wifi_name: Option<String>,
    /// Optional schedule boundary.
    pub start: Option<String>,
    /// Optional schedule boundary.
    pub end: Option<String>,
}
/// Manual overrides last only through their original decision segment.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkRoutineState {
    /// Empty unless manual apply succeeded.
    pub manual_override_segment_id: String,
    /// User's successfully applied mode.
    pub manual_override_mode: Option<NetworkMode>,
    /// Last successful/no-op segment.
    pub last_handled_segment_id: String,
    /// Last handled mode.
    pub last_handled_mode: Option<NetworkMode>,
    /// Last verified applied mode.
    pub last_applied_mode: Option<NetworkMode>,
}
/// Complete recoverable state for the owning module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct RoutineStatus {
    /// Opaque routine token.
    pub routine_handle: String,
    /// Saved profile identity.
    pub profile: NetworkProfileRef,
    /// Display-only selected adapter.
    pub adapter: AdapterInfo,
    /// Internal IPv4 patch.
    pub internal: Ipv4Patch,
    /// Exact stored rules.
    pub rules: NetworkRules,
    /// Automatic mode requested and registered.
    pub enabled: bool,
    /// Current original policy evaluation.
    pub decision: Option<NetworkDecision>,
    /// Last observation.
    pub snapshot: Option<NetworkSnapshot>,
    /// Manual segment and verified prior results.
    pub state: NetworkRoutineState,
    /// Six recipe statuses.
    pub triggers: Vec<NetworkTriggerStatus>,
    /// Other original automation detected, never removed.
    pub original_automation_detected: bool,
    /// Safe general failure code, never OS text.
    pub error: Option<String>,
}
/// Configure result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfigureResult {
    /// Opaque routine token.
    pub routine_handle: String,
    /// Full saved status.
    pub status: RoutineStatus,
}
/// Verified apply result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct NetworkApplyResult {
    /// Re-read OS state, never a proposed patch.
    pub snapshot: NetworkSnapshot,
    /// Segment held by manual application.
    pub manual_override_segment: String,
}
/// Stop only owned tasks, retaining the current adapter settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct NetworkStopResult {
    /// Tasks stopped and stored automation disabled.
    pub stopped: bool,
}

fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "네트워크 주소와 시간표, Wi-Fi 이름을 확인해 주세요.",
    )
}
/// Strict bounded IPv4 patch validation; DNS-only internal updates are supported.
pub fn validate_profile(args: &NetworkSaveProfileArgs) -> Result<(), DeckError> {
    let p = &args.internal;
    if args.external.address != "dhcp"
        || args.external.dns != "dhcp"
        || p.dns.len() > 2
        || p.address.is_some() != p.mask.is_some()
        || p.gateway.is_some() && p.address.is_none()
    {
        return Err(invalid());
    }
    for value in p
        .address
        .iter()
        .chain(p.mask.iter())
        .chain(p.gateway.iter())
        .chain(p.dns.iter())
    {
        if value.parse::<Ipv4Addr>().is_err() {
            return Err(invalid());
        }
    }
    if let Some(mask) = &p.mask {
        let n = u32::from(mask.parse::<Ipv4Addr>().map_err(|_| invalid())?);
        let inverse = !n;
        if n == 0 || inverse & (inverse + 1) != 0 {
            return Err(invalid());
        }
    }
    Ok(())
}
/// Parses the original HH:MM time syntax.
pub fn minutes(value: &str) -> Result<i64, DeckError> {
    let (h, m) = value.trim().split_once(':').ok_or_else(invalid)?;
    if h.is_empty()
        || h.len() > 2
        || m.is_empty()
        || m.len() > 2
        || !h.bytes().chain(m.bytes()).all(|c| c.is_ascii_digit())
    {
        return Err(invalid());
    }
    let h = h.parse::<i64>().map_err(|_| invalid())?;
    let m = m.parse::<i64>().map_err(|_| invalid())?;
    if h > 23 || m > 59 {
        return Err(invalid());
    }
    Ok(h * 60 + m)
}
/// Enforces seven weekdays and finite SSID sets before saving or elevating.
pub fn validate_rules(rules: &NetworkRules) -> Result<(), DeckError> {
    if rules.days.len() != 7 || rules.internal_names.len() > 64 || rules.external_names.len() > 64 {
        return Err(invalid());
    }
    for d in &rules.days {
        minutes(&d.start)?;
        minutes(&d.end)?;
    }
    for name in rules.internal_names.iter().chain(&rules.external_names) {
        if name.trim().is_empty() || name.len() > 32 || name.chars().any(char::is_control) {
            return Err(invalid());
        }
    }
    let names: Vec<_> = rules
        .internal_names
        .iter()
        .map(|s| normalize_wifi_name(s))
        .collect();
    if rules
        .external_names
        .iter()
        .any(|s| names.contains(&normalize_wifi_name(s)))
    {
        return Err(invalid());
    }
    Ok(())
}

#[path = "network_casefold.rs"]
mod unicode;
/// Original Python normalization, including Unicode casefold and whitespace collapse.
pub fn normalize_wifi_name(name: &str) -> String {
    unicode::casefold(&name.split_whitespace().collect::<Vec<_>>().join(" "))
}
fn mode_text(mode: NetworkMode) -> &'static str {
    match mode {
        NetworkMode::Internal => "internal",
        NetworkMode::External => "external",
    }
}
fn day_number(y: i64, m: i64, d: i64) -> i64 {
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yo = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    era * 146097 + yo * 365 + yo / 4 - yo / 100 + doy - 719468
}
fn civil_day(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yo = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yo + era * 400;
    let doy = doe - (365 * yo + yo / 4 - yo / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + i64::from(m <= 2), m, d)
}
fn local_second(value: &str) -> Result<i64, DeckError> {
    let parts: Vec<_> = value.split(['-', 'T', ':']).collect();
    if parts.len() != 6 {
        return Err(invalid());
    }
    let nums: Vec<i64> = parts
        .iter()
        .map(|v| v.parse::<i64>().map_err(|_| invalid()))
        .collect::<Result<_, _>>()?;
    let (y, m, d, h, min, s) = match nums.as_slice() {
        [y, m, d, h, min, s] => (*y, *m, *d, *h, *min, *s),
        _ => return Err(invalid()),
    };
    if !(1..=9999).contains(&y)
        || !(1..=12).contains(&m)
        || !(1..=31).contains(&d)
        || !(0..=23).contains(&h)
        || !(0..=59).contains(&min)
        || !(0..=59).contains(&s)
    {
        return Err(invalid());
    }
    let day = day_number(y, m, d);
    if civil_day(day) != (y, m, d) {
        return Err(invalid());
    }
    Ok(day * 86400 + h * 3600 + min * 60 + s)
}
fn iso(second: i64) -> String {
    let day = second.div_euclid(86400);
    let time = second.rem_euclid(86400);
    let (y, m, d) = civil_day(day);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}",
        time / 3600,
        time / 60 % 60,
        time % 60
    )
}
fn intervals(rules: &NetworkRules, when: i64) -> Result<Vec<(i64, i64)>, DeckError> {
    let day = when.div_euclid(86400);
    let mut ranges = Vec::new();
    for offset in -8..=8 {
        let date = day + offset;
        let weekday = (date + 3).rem_euclid(7);
        let row = rules
            .days
            .get(usize::try_from(weekday).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        if !row.enabled {
            continue;
        }
        let start = minutes(&row.start)?;
        let end = minutes(&row.end)?;
        if start == end {
            continue;
        }
        ranges.push((
            date * 86400 + start * 60,
            date * 86400 + end * 60 + if start > end { 86400 } else { 0 },
        ));
    }
    ranges.sort_unstable();
    let mut merged: Vec<(i64, i64)> = Vec::new();
    for (start, end) in ranges {
        if let Some(last) = merged.last_mut()
            && start <= last.1
        {
            last.1 = last.1.max(end);
        } else {
            merged.push((start, end));
        }
    }
    Ok(merged)
}
/// Original weekly/overnight/Wi-Fi decision. Local timestamps deliberately have no UTC offset.
pub fn decide(
    rules: &NetworkRules,
    when: &str,
    snapshot: &NetworkSnapshot,
) -> Result<NetworkDecision, DeckError> {
    validate_rules(rules)?;
    let now = local_second(when)?;
    let mut previous = None;
    let mut next = None;
    let mut internal = None;
    for (start, end) in intervals(rules, now)? {
        if start <= now && now < end {
            internal = Some((start, end));
            break;
        }
        if end <= now {
            previous = Some(iso(end));
        } else if start > now {
            next = Some(iso(start));
            break;
        }
    }
    let mut result = if let Some((start, end)) = internal {
        NetworkDecision {
            mode: Some(NetworkMode::Internal),
            segment_id: format!("internal|{}|{}", iso(start), iso(end)),
            source: "schedule".into(),
            matched_wifi_name: None,
            start: Some(iso(start)),
            end: Some(iso(end)),
        }
    } else {
        NetworkDecision {
            mode: Some(NetworkMode::External),
            segment_id: if previous.is_none() && next.is_none() {
                "external|always".into()
            } else {
                format!(
                    "external|{}|{}",
                    previous.as_deref().unwrap_or("past"),
                    next.as_deref().unwrap_or("future")
                )
            },
            source: "schedule".into(),
            matched_wifi_name: None,
            start: previous,
            end: next,
        }
    };
    if rules.decision_mode == NetworkDecisionMode::Schedule {
        return Ok(result);
    }
    let connected = normalize_wifi_name(&snapshot.connected_wifi);
    for (mode, names) in [
        (NetworkMode::Internal, &rules.internal_names),
        (NetworkMode::External, &rules.external_names),
    ] {
        if let Some(name) = names
            .iter()
            .find(|n| !connected.is_empty() && normalize_wifi_name(n) == connected)
        {
            result.mode = Some(mode);
            result.segment_id = format!("wifi|{}|{}", mode_text(mode), unicode::casefold(name));
            result.source = format!("wifi_connected_{}", mode_text(mode));
            result.matched_wifi_name = Some(name.clone());
            return Ok(result);
        }
    }
    let visible: Vec<_> = snapshot
        .visible_wifi
        .iter()
        .map(|n| normalize_wifi_name(n))
        .filter(|s| !s.is_empty())
        .collect();
    let inside = rules
        .internal_names
        .iter()
        .find(|n| visible.contains(&normalize_wifi_name(n)));
    let outside = rules
        .external_names
        .iter()
        .find(|n| visible.contains(&normalize_wifi_name(n)));
    if let Some((mode, name)) = match (inside, outside) {
        (Some(n), None) => Some((NetworkMode::Internal, n)),
        (None, Some(n)) => Some((NetworkMode::External, n)),
        _ => None,
    } {
        result.mode = Some(mode);
        result.segment_id = format!(
            "wifi-visible|{}|{}",
            mode_text(mode),
            unicode::casefold(name)
        );
        result.source = format!("wifi_visible_{}", mode_text(mode));
        result.matched_wifi_name = Some(name.clone());
        return Ok(result);
    }
    let mut signature = visible;
    signature.sort();
    signature.dedup();
    let signature = if signature.is_empty() {
        "-".into()
    } else {
        signature.join("|")
    };
    if inside.is_some() && outside.is_some() {
        if rules.decision_mode == NetworkDecisionMode::Hybrid {
            result.source = "wifi_visible_ambiguous_schedule".into();
        } else {
            result.mode = None;
            result.segment_id = format!("wifi-visible|ambiguous|{signature}");
            result.source = "wifi_visible_ambiguous".into();
        }
        return Ok(result);
    }
    if rules.decision_mode == NetworkDecisionMode::Hybrid {
        return Ok(result);
    }
    result.mode = None;
    let (segment, source) = if snapshot.location_permission_required {
        ("wifi-visible|permission".into(), "wifi_scan_permission")
    } else if !snapshot.visible_wifi.is_empty() {
        (format!("wifi-visible|none|{signature}"), "wifi_none")
    } else if !snapshot.connected_wifi.is_empty() {
        (format!("wifi|none|{connected}"), "wifi_connected_none")
    } else {
        ("wifi-visible|empty".into(), "wifi_visible_empty")
    };
    result.segment_id = segment;
    result.source = source.into();
    Ok(result)
}
/// Exact original decision reconciliation action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub enum ReconcileAction {
    /// Disabled automation.
    Disabled,
    /// Hold user's successfully applied mode within this segment.
    Manual,
    /// No unambiguous Wi-Fi decision.
    Keep,
    /// This segment already handled.
    Handled,
    /// Current OS state already matches.
    Matched,
    /// OS application is needed.
    Apply,
}
/// A no-op is safe only when the public observation proves every selected field.
/// DNS source, mask and gateway are private OS observations and cannot be inferred here.
pub fn matches_snapshot(
    patch: &Ipv4Patch,
    _state: &NetworkRoutineState,
    mode: NetworkMode,
    snapshot: &NetworkSnapshot,
) -> bool {
    if mode == NetworkMode::External || patch.address.is_some() {
        return false;
    }
    if patch.dns != snapshot.dns {
        return false;
    }
    !patch.dns.is_empty()
}
/// Verify selected IPv4 settings using host-private observations after OS application.
pub fn verifies_applied(
    patch: &Ipv4Patch,
    mode: NetworkMode,
    snapshot: &NetworkSnapshot,
    address_masks: &[(String, String)],
    gateways: &[String],
    dns_automatic: bool,
) -> bool {
    if mode == NetworkMode::External {
        return snapshot.dhcp && dns_automatic;
    }
    if let Some(address) = &patch.address {
        if snapshot.dhcp
            || !address_masks
                .iter()
                .any(|(ip, mask)| ip == address && patch.mask.as_ref() == Some(mask))
        {
            return false;
        }
        if patch
            .gateway
            .as_ref()
            .is_some_and(|value| gateways.first() != Some(value))
        {
            return false;
        }
    }
    patch.dns.is_empty() || (!dns_automatic && snapshot.dns == patch.dns)
}

/// Retry only contention. The caller supplies a bounded wait and reads current state after success.
pub fn retry_contention<T>(
    mut attempt: impl FnMut() -> Result<T, DeckError>,
    mut wait: impl FnMut() -> bool,
) -> Result<T, DeckError> {
    loop {
        match attempt() {
            Err(error) if error.code == ErrorCode::Busy => {
                if !wait() {
                    return Err(error);
                }
            }
            result => return result,
        }
    }
}

/// Clears stale manual holds and decides whether applying is necessary.
pub fn reconcile(
    enabled: bool,
    patch: &Ipv4Patch,
    state: &mut NetworkRoutineState,
    decision: &NetworkDecision,
    snapshot: &NetworkSnapshot,
) -> ReconcileAction {
    if !enabled {
        return ReconcileAction::Disabled;
    }
    if !state.manual_override_segment_id.is_empty()
        && state.manual_override_segment_id != decision.segment_id
    {
        state.manual_override_segment_id.clear();
        state.manual_override_mode = None;
    }
    if state.manual_override_segment_id == decision.segment_id {
        return ReconcileAction::Manual;
    }
    let Some(mode) = decision.mode else {
        state
            .last_handled_segment_id
            .clone_from(&decision.segment_id);
        state.last_handled_mode = None;
        return ReconcileAction::Keep;
    };
    if state.last_handled_segment_id == decision.segment_id {
        return ReconcileAction::Handled;
    }
    if matches_snapshot(patch, state, mode, snapshot) {
        complete_apply(state, decision);
        return ReconcileAction::Matched;
    }
    ReconcileAction::Apply
}
/// Record a result only after OS application succeeded and was re-read.
pub fn complete_apply(state: &mut NetworkRoutineState, decision: &NetworkDecision) {
    if state.manual_override_segment_id != decision.segment_id {
        state.manual_override_segment_id.clear();
        state.manual_override_mode = None;
    }
    state.last_applied_mode = decision.mode;
    state.last_handled_mode = decision.mode;
    state
        .last_handled_segment_id
        .clone_from(&decision.segment_id);
}
/// Original overnight schedule trigger boundaries, Monday=0; deduplicated.
pub fn schedule_boundaries(rules: &NetworkRules) -> Result<Vec<(usize, String)>, DeckError> {
    validate_rules(rules)?;
    let mut boundaries = Vec::new();
    for (index, row) in rules.days.iter().enumerate() {
        if !row.enabled {
            continue;
        }
        let start = minutes(&row.start)?;
        let end = minutes(&row.end)?;
        if start == end {
            continue;
        }
        for (day, value) in [
            (index, start),
            ((index + usize::from(start > end)) % 7, end),
        ] {
            let item = (day, format!("{:02}:{:02}", value / 60, value % 60));
            if !boundaries.contains(&item) {
                boundaries.push(item);
            }
        }
    }
    Ok(boundaries)
}
/// Next local wall-clock boundary; a boundary at the current instant belongs to next week.
pub fn next_weekly_boundary(day: usize, time: &str, now: &str) -> Result<String, DeckError> {
    if day >= 7 {
        return Err(invalid());
    }
    let now = local_second(now)?;
    let midnight = now.div_euclid(86400);
    let weekday = (midnight + 3).rem_euclid(7);
    let ahead = (i64::try_from(day).map_err(|_| invalid())? - weekday).rem_euclid(7);
    let candidate = (midnight + ahead) * 86400 + minutes(time)? * 60;
    Ok(iso(if candidate <= now {
        candidate + 7 * 86400
    } else {
        candidate
    }))
}

#[cfg(test)]
#[path = "network_source_cases.rs"]
mod source;
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dhcp_address_does_not_prove_automatic_dns() {
        let patch = Ipv4Patch {
            address: None,
            mask: None,
            gateway: None,
            dns: vec!["192.0.2.53".into()],
        };
        let snapshot = NetworkSnapshot {
            dhcp: true,
            dns: patch.dns.clone(),
            ..Default::default()
        };
        assert!(!matches_snapshot(
            &patch,
            &NetworkRoutineState::default(),
            NetworkMode::External,
            &snapshot
        ));
        assert!(!verifies_applied(
            &patch,
            NetworkMode::External,
            &snapshot,
            &[],
            &[],
            false
        ));
        assert!(verifies_applied(
            &patch,
            NetworkMode::External,
            &snapshot,
            &[],
            &[],
            true
        ));
    }
    #[test]
    fn applied_address_requires_paired_mask_and_selected_gateway() {
        let patch = Ipv4Patch {
            address: Some("192.0.2.20".into()),
            mask: Some("255.255.255.0".into()),
            gateway: Some("192.0.2.1".into()),
            dns: vec![],
        };
        let snapshot = NetworkSnapshot {
            ips: vec!["192.0.2.20".into()],
            ..Default::default()
        };
        assert!(!matches_snapshot(
            &patch,
            &NetworkRoutineState::default(),
            NetworkMode::Internal,
            &snapshot
        ));
        let masks = vec![("192.0.2.20".into(), "255.255.255.0".into())];
        assert!(!verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &[("192.0.2.20".into(), "255.255.0.0".into())],
            &["192.0.2.1".into()],
            true
        ));
        assert!(!verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &masks,
            &["192.0.2.2".into()],
            true
        ));
        assert!(verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &masks,
            &["192.0.2.1".into()],
            true
        ));
    }
    #[test]
    fn dns_only_verification_keeps_unspecified_address_and_gateway() {
        let patch = Ipv4Patch {
            address: None,
            mask: None,
            gateway: None,
            dns: vec!["192.0.2.53".into(), "192.0.2.54".into()],
        };
        let mut snapshot = NetworkSnapshot {
            dhcp: true,
            dns: patch.dns.clone(),
            ..Default::default()
        };
        assert!(verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &[],
            &[],
            false
        ));
        assert!(!verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &[],
            &[],
            true
        ));
        snapshot.dns.reverse();
        assert!(!verifies_applied(
            &patch,
            NetworkMode::Internal,
            &snapshot,
            &[],
            &[],
            false
        ));
    }
    #[test]
    fn boundary_contention_retries_but_is_bounded_and_denial_is_not_retried() {
        let mut attempts = 0;
        let mut waits = 0;
        let value = retry_contention(
            || {
                attempts += 1;
                if attempts < 3 {
                    Err(DeckError::new(ErrorCode::Busy, "busy"))
                } else {
                    Ok("fresh state")
                }
            },
            || {
                waits += 1;
                true
            },
        )
        .unwrap();
        assert_eq!((value, attempts, waits), ("fresh state", 3, 2));
        assert_eq!(
            retry_contention::<()>(|| Err(DeckError::new(ErrorCode::Busy, "busy")), || false)
                .unwrap_err()
                .code,
            ErrorCode::Busy
        );
        assert_eq!(
            retry_contention::<()>(
                || Err(DeckError::new(ErrorCode::PermissionDenied, "denied")),
                || panic!("must not wait")
            )
            .unwrap_err()
            .code,
            ErrorCode::PermissionDenied
        );
    }
    fn rules(value: &serde_json::Value) -> NetworkRules {
        let keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
        NetworkRules {
            decision_mode: match value["decision_mode"].as_str().unwrap_or("schedule") {
                "hybrid" => NetworkDecisionMode::Hybrid,
                "wifi_only" => NetworkDecisionMode::WifiOnly,
                _ => NetworkDecisionMode::Schedule,
            },
            days: keys
                .iter()
                .map(|k| serde_json::from_value(value["schedule"]["days"][k].clone()).unwrap())
                .collect(),
            internal_names: serde_json::from_value(value["wifi_rules"]["internal_names"].clone())
                .unwrap(),
            external_names: serde_json::from_value(value["wifi_rules"]["external_names"].clone())
                .unwrap(),
        }
    }
    #[test]
    fn original_180_decisions_and_schedule_boundaries() {
        let cases: Vec<serde_json::Value> = serde_json::from_str(source::CASES).unwrap();
        assert_eq!(cases.len(), 180);
        for (index, c) in cases.iter().enumerate() {
            let r = rules(&c["settings"]);
            let w = &c["wifi"];
            let snapshot = NetworkSnapshot {
                connected_wifi: w["connected"].as_str().unwrap_or_default().into(),
                visible_wifi: serde_json::from_value(w["names"].clone()).unwrap(),
                location_permission_required: w["location_permission_required"] == true,
                elevation_required: w["elevation_required"] == true,
                ..Default::default()
            };
            let d = decide(&r, c["when"].as_str().unwrap(), &snapshot).unwrap();
            let expected = &c["expected"];
            assert_eq!(
                d.segment_id,
                expected["segment_id"].as_str().unwrap(),
                "case {index}"
            );
            assert_eq!(
                d.source,
                expected["source"].as_str().unwrap(),
                "case {index}"
            );
            assert_eq!(
                d.mode.map(mode_text).unwrap_or(""),
                expected["mode"].as_str().unwrap(),
                "case {index}"
            );
            let days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
            let boundaries: Vec<_> = schedule_boundaries(&r)
                .unwrap()
                .iter()
                .map(|(day, time)| serde_json::json!({"day_key":days[*day],"time":time}))
                .collect();
            assert_eq!(
                serde_json::to_value(boundaries).unwrap(),
                c["boundaries"],
                "case {index}"
            );
        }
    }
    #[test]
    fn ipv4_dns_only_and_masks() {
        let mut a = NetworkSaveProfileArgs {
            adapter_handle: "owned".into(),
            internal: Ipv4Patch {
                address: None,
                mask: None,
                gateway: None,
                dns: vec!["192.0.2.53".into()],
            },
            external: NetworkExternalProfile {
                address: "dhcp".into(),
                dns: "dhcp".into(),
            },
        };
        assert!(validate_profile(&a).is_ok());
        a.internal.address = Some("192.0.2.5".into());
        assert!(validate_profile(&a).is_err());
        a.internal.mask = Some("255.0.255.0".into());
        assert!(validate_profile(&a).is_err());
        a.internal.mask = Some("255.255.255.0".into());
        assert!(validate_profile(&a).is_ok());
    }
    #[test]
    fn rejects_unknown_recipe_and_bad_dates() {
        assert!(
            serde_json::from_value::<NetworkApplyArgs>(
                serde_json::json!({"profileHandle":"x","mode":"script","revision":1})
            )
            .is_err()
        );
        assert!(local_second("2026-02-30T10:00:00").is_err());
        assert_eq!(
            iso(local_second("2026-12-31T23:59:59").unwrap()),
            "2026-12-31T23:59:59"
        );
    }
    #[test]
    fn manual_hold_survives_then_expires_and_failure_not_recorded() {
        let patch = Ipv4Patch {
            address: None,
            mask: None,
            gateway: None,
            dns: vec![],
        };
        let d = NetworkDecision {
            mode: Some(NetworkMode::Internal),
            segment_id: "segment-a".into(),
            source: "schedule".into(),
            matched_wifi_name: None,
            start: None,
            end: None,
        };
        let mut state = NetworkRoutineState {
            manual_override_segment_id: "segment-a".into(),
            manual_override_mode: Some(NetworkMode::External),
            ..Default::default()
        };
        assert_eq!(
            reconcile(true, &patch, &mut state, &d, &NetworkSnapshot::default()),
            ReconcileAction::Manual
        );
        let next = NetworkDecision {
            segment_id: "segment-b".into(),
            ..d
        };
        assert_eq!(
            reconcile(true, &patch, &mut state, &next, &NetworkSnapshot::default()),
            ReconcileAction::Apply
        );
        assert!(state.last_handled_segment_id.is_empty());
        assert!(state.manual_override_segment_id.is_empty());
        complete_apply(&mut state, &next);
        assert_eq!(state.last_handled_segment_id, "segment-b");
    }
}
