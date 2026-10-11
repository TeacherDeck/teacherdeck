// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Fixed local WMI/WLAN/TaskScheduler adapter. No command strings or arbitrary tasks are accepted.
#![allow(unsafe_code)]
use deck_core::caps::network::{
    Ipv4Patch, NetworkDecisionMode, NetworkMode, NetworkRules, NetworkSnapshot,
    NetworkTriggerStatus, schedule_boundaries,
};
use deck_core::{DeckError, ErrorCode};
use std::path::Path;
/// Host-private stable adapter identity.
#[derive(Clone)]
pub(crate) struct NativeAdapter {
    pub guid: String,
    pub display_name: String,
    pub adapter_type: String,
}
fn failed() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "네트워크 어댑터와 Windows 관리 권한을 확인해 주세요.",
    )
}
/// Six fixed trigger kinds; no module-supplied task XML.
pub(crate) const TRIGGERS: [&str; 6] = ["boot", "logon", "unlock", "console", "wifi", "schedule"];
pub(crate) fn required(kind: &str, rules: &NetworkRules) -> bool {
    match kind {
        "wifi" => {
            rules.decision_mode != NetworkDecisionMode::Schedule
                && (!rules.internal_names.is_empty() || !rules.external_names.is_empty())
        }
        "schedule" => {
            rules.decision_mode != NetworkDecisionMode::WifiOnly
                && schedule_boundaries(rules).is_ok_and(|items| !items.is_empty())
        }
        "boot" | "logon" | "unlock" | "console" => true,
        _ => false,
    }
}
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn task_name(sid: &str, owner: &str, kind: &str) -> Result<String, DeckError> {
    if !sid.starts_with("S-1-")
        || !sid
            .bytes()
            .all(|c| c.is_ascii_digit() || matches!(c, b'S' | b'-'))
        || !deck_core::util::is_valid_module_id(owner)
        || !TRIGGERS.contains(&kind)
    {
        return Err(failed());
    }
    Ok(format!("TeacherDeck.Network.{sid}.{owner}.{kind}"))
}
/// Builds a bounded fixed TaskScheduler recipe with a pinned owner/revision worker argument.
pub(crate) fn task_xml(
    sid: &str,
    owner: &str,
    kind: &str,
    rules: &NetworkRules,
    exe: &Path,
    argument: &str,
    now: &str,
) -> Result<String, DeckError> {
    let _ = task_name(sid, owner, kind)?;
    let user = escape(sid);
    let trigger = match kind {
        "boot" => "<BootTrigger><Enabled>true</Enabled></BootTrigger>".into(),
        "logon" => {
            format!("<LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger>")
        }
        "unlock" | "console" => format!(
            "<SessionStateChangeTrigger><Enabled>true</Enabled><UserId>{user}</UserId><StateChange>{}</StateChange></SessionStateChangeTrigger>",
            if kind == "unlock" {
                "SessionUnlock"
            } else {
                "ConsoleConnect"
            }
        ),
        "wifi" => format!(
            "<EventTrigger><Enabled>true</Enabled><Subscription>{}</Subscription></EventTrigger>",
            escape(
                "<QueryList><Query Id=\"0\" Path=\"Microsoft-Windows-WLAN-AutoConfig/Operational\"><Select Path=\"Microsoft-Windows-WLAN-AutoConfig/Operational\">*[System[(EventID=8001 or EventID=8003)]]</Select></Query></QueryList>"
            )
        ),
        "schedule" => {
            let days = [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
            ];
            let mut text = String::new();
            for (day, time) in schedule_boundaries(rules)? {
                let boundary = deck_core::caps::network::next_weekly_boundary(day, &time, now)?;
                let day = days.get(day).ok_or_else(failed)?;
                text.push_str(&format!("<CalendarTrigger><StartBoundary>{boundary}</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek><{day}/></DaysOfWeek></ScheduleByWeek></CalendarTrigger>"));
            }
            text
        }
        _ => return Err(failed()),
    };
    let exe = escape(exe.to_str().ok_or_else(failed)?);
    let arguments = escape(&format!("--deck-native-worker network-routine {argument}"));
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-16\"?><Task version=\"1.4\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\"><RegistrationInfo><Description>TeacherDeck network 1.0 owned recipe</Description></RegistrationInfo><Triggers>{trigger}</Triggers><Principals><Principal id=\"Owner\"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>Queue</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><ExecutionTimeLimit>PT2M</ExecutionTimeLimit></Settings><Actions Context=\"Owner\"><Exec><Command>{exe}</Command><Arguments>{arguments}</Arguments></Exec></Actions></Task>"
    ))
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::native_automation::{
        Apartment, Dispatch, Value, boolean, null, number, read_strings, string, strings,
    };
    use deck_core::caps::network::verifies_applied;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::NetworkManagement::WiFi::*;
    struct WlanHandle(HANDLE);
    impl Drop for WlanHandle {
        fn drop(&mut self) {
            // SAFETY: owns exactly the WlanOpenHandle result; no interface/list pointers outlive it.
            let _ = unsafe { WlanCloseHandle(self.0, None) };
        }
    }
    struct WlanMemory(*mut std::ffi::c_void);
    impl Drop for WlanMemory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: WLAN allocated this exact buffer; it has one RAII owner and is freed once.
                unsafe { WlanFreeMemory(self.0) };
            }
        }
    }
    fn valid_guid(value: &str) -> bool {
        value.len() == 36
            && value.bytes().enumerate().all(|(i, c)| {
                if [8, 13, 18, 23].contains(&i) {
                    c == b'-'
                } else {
                    c.is_ascii_hexdigit()
                }
            })
    }
    fn service() -> Result<Dispatch, DeckError> {
        Dispatch::create("WbemScripting.SWbemLocator")?
            .method_object("ConnectServer", vec![".".into(), "root\\cimv2".into()])
    }
    fn rows(service: &Dispatch, query: &str) -> Result<Vec<Dispatch>, DeckError> {
        let set =
            service.method_object("ExecQuery", vec![query.into(), "WQL".into(), 0i32.into()])?;
        let count = number(&set.get("Count")?)?;
        if !(0..=1024).contains(&count) {
            return Err(failed());
        }
        (0..count)
            .map(|i| set.method_object("ItemIndex", vec![i.into()]))
            .collect()
    }
    fn config(service: &Dispatch, guid: &str) -> Result<Dispatch, DeckError> {
        if !valid_guid(guid) {
            return Err(failed());
        }
        let mut list = rows(
            service,
            &format!("SELECT * FROM Win32_NetworkAdapterConfiguration WHERE SettingID = '{guid}'"),
        )?;
        if list.len() != 1 {
            return Err(failed());
        }
        list.pop().ok_or_else(failed)
    }
    pub(crate) fn adapters() -> Result<Vec<NativeAdapter>, DeckError> {
        let _sta = Apartment::enter()?;
        let service = service()?;
        let mut result = vec![];
        for item in rows(
            &service,
            "SELECT GUID,NetConnectionID,AdapterType FROM Win32_NetworkAdapter WHERE NetConnectionID IS NOT NULL",
        )? {
            let guid = string(&item.get("GUID")?)?;
            if !valid_guid(&guid) {
                continue;
            }
            result.push(NativeAdapter {
                guid,
                display_name: string(&item.get("NetConnectionID")?)?,
                adapter_type: string(&item.get("AdapterType")?).unwrap_or_else(|_| "other".into()),
            });
        }
        Ok(result)
    }
    pub(crate) fn inspect(guid: &str, scan_wifi: bool) -> Result<NetworkSnapshot, DeckError> {
        let _sta = Apartment::enter()?;
        let service = service()?;
        let item = config(&service, guid)?;
        let mut result = NetworkSnapshot {
            dhcp: boolean(&item.get("DHCPEnabled")?)?,
            ips: read_strings(&item.get("IPAddress")?)?
                .into_iter()
                .filter(|s| s.parse::<std::net::Ipv4Addr>().is_ok())
                .collect(),
            dns: read_strings(&item.get("DNSServerSearchOrder")?)?
                .into_iter()
                .filter(|s| s.parse::<std::net::Ipv4Addr>().is_ok())
                .collect(),
            ..Default::default()
        };
        if scan_wifi {
            wifi(&mut result)?;
        }
        Ok(result)
    }
    fn ssid(value: &DOT11_SSID) -> Option<String> {
        let length = usize::try_from(value.uSSIDLength).ok()?;
        std::str::from_utf8(value.ucSSID.get(..length)?)
            .ok()
            .map(str::to_owned)
            .filter(|s| !s.is_empty())
    }
    fn wifi(result: &mut NetworkSnapshot) -> Result<(), DeckError> {
        let mut version = 0;
        let mut handle = HANDLE::default();
        // SAFETY: writable output locations, no reserved pointers; handle is wrapped immediately.
        if unsafe { WlanOpenHandle(2, None, &mut version, &mut handle) } != 0 {
            return Ok(());
        }
        let handle = WlanHandle(handle);
        let mut list = std::ptr::null_mut();
        // SAFETY: WLAN owns a returned list; successful non-null buffer is wrapped before dereference.
        let status = unsafe { WlanEnumInterfaces(handle.0, None, &mut list) };
        if status != 0 || list.is_null() {
            result.location_permission_required = status == 5;
            return Ok(());
        }
        let _memory = WlanMemory(list.cast());
        // SAFETY: successful API returns a valid list; cap its flexible count before forming a slice.
        let count = unsafe { (*list).dwNumberOfItems };
        if count > 64 {
            return Err(failed());
        }
        // SAFETY: the API allocation contains exactly the advertised bounded flexible interface array.
        let interfaces = unsafe {
            std::slice::from_raw_parts(
                (*list).InterfaceInfo.as_ptr(),
                usize::try_from(count).map_err(|_| failed())?,
            )
        };
        for interface in interfaces {
            let guid = &interface.InterfaceGuid;
            // SAFETY: borrowed GUID belongs to live API list; scan has no settings mutation or borrowed output.
            let scan = unsafe { WlanScan(handle.0, guid, None, None, None) };
            if scan == 5 {
                result.location_permission_required = true;
            }
            let mut size = 0;
            let mut connection = std::ptr::null_mut();
            // SAFETY: API allocates connection output; validate its length before struct access and free once.
            let status = unsafe {
                WlanQueryInterface(
                    handle.0,
                    guid,
                    wlan_intf_opcode_current_connection,
                    None,
                    &mut size,
                    &mut connection,
                    None,
                )
            };
            let _connection = WlanMemory(connection);
            if status == 5 {
                result.location_permission_required = true;
            }
            if status == 0
                && !connection.is_null()
                && usize::try_from(size)
                    .is_ok_and(|n| n >= std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>())
                && result.connected_wifi.is_empty()
            {
                // SAFETY: verified size and pointer of the API's connection attributes allocation.
                let info = unsafe { &*connection.cast::<WLAN_CONNECTION_ATTRIBUTES>() };
                result.connected_wifi =
                    ssid(&info.wlanAssociationAttributes.dot11Ssid).unwrap_or_default();
            }
            let mut available = std::ptr::null_mut();
            // SAFETY: GUID and client are live; resulting WLAN allocation is immediately wrapped.
            let status =
                unsafe { WlanGetAvailableNetworkList(handle.0, guid, 0, None, &mut available) };
            let _available = WlanMemory(available.cast());
            if status == 5 {
                result.location_permission_required = true;
            }
            if status != 0 || available.is_null() {
                continue;
            }
            // SAFETY: returned list is valid; cap flexible array count before creating the borrowed slice.
            let count = unsafe { (*available).dwNumberOfItems };
            if count > 1024 {
                return Err(failed());
            }
            // SAFETY: API allocation contains advertised bounded WLAN_AVAILABLE_NETWORK entries.
            let networks = unsafe {
                std::slice::from_raw_parts(
                    (*available).Network.as_ptr(),
                    usize::try_from(count).map_err(|_| failed())?,
                )
            };
            for network in networks {
                if let Some(name) = ssid(&network.dot11Ssid)
                    && !result.visible_wifi.contains(&name)
                {
                    result.visible_wifi.push(name);
                }
            }
        }
        Ok(())
    }
    fn successful(value: Value) -> Result<(), DeckError> {
        match number(&value)? {
            0 | 1 => Ok(()),
            5 | 91 => Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "네트워크 변경 권한을 확인해 주세요.",
            )),
            _ => Err(failed()),
        }
    }
    /// Only the elevated fixed worker calls structured WMI mutations.
    pub(crate) fn apply(
        guid: &str,
        mode: NetworkMode,
        patch: &Ipv4Patch,
    ) -> Result<NetworkSnapshot, DeckError> {
        let _sta = Apartment::enter()?;
        let service = service()?;
        let item = config(&service, guid)?;
        match mode {
            NetworkMode::External => {
                successful(item.invoke("EnableDHCP", vec![])?)?;
                successful(item.invoke("SetDNSServerSearchOrder", vec![null()])?)?;
            }
            NetworkMode::Internal => {
                if let (Some(address), Some(mask)) = (&patch.address, &patch.mask) {
                    successful(item.invoke(
                        "EnableStatic",
                        vec![
                            strings(std::slice::from_ref(address))?,
                            strings(std::slice::from_ref(mask))?,
                        ],
                    )?)?;
                    if let Some(gateway) = &patch.gateway {
                        successful(item.invoke(
                            "SetGateways",
                            vec![strings(std::slice::from_ref(gateway))?],
                        )?)?;
                    }
                }
                if !patch.dns.is_empty() {
                    successful(
                        item.invoke("SetDNSServerSearchOrder", vec![strings(&patch.dns)?])?,
                    )?;
                }
            }
        }
        drop(item);
        // WMI can publish the updated configuration asynchronously. Re-read the selected
        // interface for a bounded period; a reboot-required result is not reported as applied.
        for _ in 0..20 {
            let actual = config(&service, guid)?;
            let addresses = read_strings(&actual.get("IPAddress")?)?;
            let masks = read_strings(&actual.get("IPSubnet")?)?;
            let address_masks: Vec<_> = addresses.into_iter().zip(masks).collect();
            let gateways = read_strings(&actual.get("DefaultIPGateway")?)?;
            let snapshot = NetworkSnapshot {
                dhcp: boolean(&actual.get("DHCPEnabled")?)?,
                ips: address_masks
                    .iter()
                    .filter(|(ip, _)| ip.parse::<std::net::Ipv4Addr>().is_ok())
                    .map(|(ip, _)| ip.clone())
                    .collect(),
                dns: read_strings(&actual.get("DNSServerSearchOrder")?)?
                    .into_iter()
                    .filter(|ip| ip.parse::<std::net::Ipv4Addr>().is_ok())
                    .collect(),
                ..Default::default()
            };
            if verifies_applied(
                patch,
                mode,
                &snapshot,
                &address_masks,
                &gateways,
                dns_automatic(guid)?,
            ) {
                return Ok(snapshot);
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        Err(failed())
    }

    fn dns_automatic(guid: &str) -> Result<bool, DeckError> {
        use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
        use windows::Win32::System::Registry::{HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ, RegGetValueW};
        use windows::core::PCWSTR;
        if !valid_guid(guid) {
            return Err(failed());
        }
        let key: Vec<u16> = format!(
            "SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{{{guid}}}"
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();
        let name: Vec<u16> = "NameServer".encode_utf16().chain(Some(0)).collect();
        let mut data = vec![0u16; 2048];
        let mut bytes = 4096u32;
        // SAFETY: read-only fixed interface/value lookup after GUID validation. Aligned output
        // buffer and its byte length stay live; no registry settings are changed.
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(data.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(true);
        }
        status.ok().map_err(|_| failed())?;
        if !bytes.is_multiple_of(2) {
            return Err(failed());
        }
        let value = data
            .get(..usize::try_from(bytes / 2).map_err(|_| failed())?)
            .ok_or_else(failed)?;
        let text = String::from_utf16(value.split(|c| *c == 0).next().unwrap_or_default())
            .map_err(|_| failed())?;
        Ok(text.trim().is_empty())
    }
    fn task_root() -> Result<Dispatch, DeckError> {
        let service = Dispatch::create("Schedule.Service")?;
        service.invoke("Connect", vec![])?;
        service.method_object("GetFolder", vec!["\\".into()])
    }
    fn no_delay(value: &Value) -> Result<bool, DeckError> {
        Ok(matches!(string(value)?.as_str(), "" | "PT0S"))
    }
    /// Inspect typed TaskScheduler properties rather than trusting text included in arbitrary XML.
    fn matches_recipe(
        task: &Dispatch,
        sid: &str,
        kind: &str,
        rules: &NetworkRules,
        exe: &Path,
        argument: &str,
    ) -> Result<bool, DeckError> {
        if !boolean(&task.get("Enabled")?)? {
            return Ok(false);
        }
        let definition = task.get_object("Definition")?;
        let principal = definition.get_object("Principal")?;
        if string(&principal.get("UserId")?)? != sid
            || number(&principal.get("LogonType")?)? != 3
            || number(&principal.get("RunLevel")?)? != 1
        {
            return Ok(false);
        }
        let settings = definition.get_object("Settings")?;
        if !boolean(&settings.get("Enabled")?)?
            || number(&settings.get("MultipleInstances")?)? != 1
            || boolean(&settings.get("DisallowStartIfOnBatteries")?)?
            || boolean(&settings.get("StopIfGoingOnBatteries")?)?
            || !boolean(&settings.get("StartWhenAvailable")?)?
            || !boolean(&settings.get("AllowDemandStart")?)?
            || string(&settings.get("ExecutionTimeLimit")?)? != "PT2M"
        {
            return Ok(false);
        }
        let actions = definition.get_object("Actions")?;
        if number(&actions.get("Count")?)? != 1 {
            return Ok(false);
        }
        let action = actions.method_object("Item", vec![1i32.into()])?;
        if number(&action.get("Type")?)? != 0
            || string(&action.get("Path")?)? != exe.to_str().ok_or_else(failed)?
            || string(&action.get("Arguments")?)?
                != format!("--deck-native-worker network-routine {argument}")
            || !string(&action.get("WorkingDirectory")?)?.is_empty()
        {
            return Ok(false);
        }
        let triggers = definition.get_object("Triggers")?;
        let boundaries = schedule_boundaries(rules)?;
        let count = number(&triggers.get("Count")?)?;
        let expected = if kind == "schedule" {
            i32::try_from(boundaries.len()).map_err(|_| failed())?
        } else {
            1
        };
        if count != expected {
            return Ok(false);
        }
        let mut seen = std::collections::HashSet::new();
        for index in 1..=count {
            let trigger = triggers.method_object("Item", vec![index.into()])?;
            let expected_type = match kind {
                "boot" => 8,
                "logon" => 9,
                "unlock" | "console" => 11,
                "wifi" => 0,
                "schedule" => 3,
                _ => return Ok(false),
            };
            if !boolean(&trigger.get("Enabled")?)?
                || number(&trigger.get("Type")?)? != expected_type
                || !string(&trigger.get("EndBoundary")?)?.is_empty()
                || !no_delay(&trigger.get("ExecutionTimeLimit")?)?
            {
                return Ok(false);
            }
            let repetition = trigger.get_object("Repetition")?;
            if !no_delay(&repetition.get("Interval")?)? || !no_delay(&repetition.get("Duration")?)?
            {
                return Ok(false);
            }
            match kind {
                "boot" => {
                    if !no_delay(&trigger.get("Delay")?)? {
                        return Ok(false);
                    }
                }
                "logon" | "unlock" | "console" => {
                    if string(&trigger.get("UserId")?)? != sid || !no_delay(&trigger.get("Delay")?)?
                    {
                        return Ok(false);
                    }
                    if matches!(kind, "unlock" | "console")
                        && number(&trigger.get("StateChange")?)?
                            != if kind == "unlock" { 8 } else { 1 }
                    {
                        return Ok(false);
                    }
                }
                "wifi" => {
                    if !no_delay(&trigger.get("Delay")?)?
                        || string(&trigger.get("Subscription")?)?
                            != "<QueryList><Query Id=\"0\" Path=\"Microsoft-Windows-WLAN-AutoConfig/Operational\"><Select Path=\"Microsoft-Windows-WLAN-AutoConfig/Operational\">*[System[(EventID=8001 or EventID=8003)]]</Select></Query></QueryList>"
                    {
                        return Ok(false);
                    }
                }
                "schedule" => {
                    let days = number(&trigger.get("DaysOfWeek")?)?;
                    let boundary = string(&trigger.get("StartBoundary")?)?;
                    if number(&trigger.get("WeeksInterval")?)? != 1
                        || !no_delay(&trigger.get("RandomDelay")?)?
                    {
                        return Ok(false);
                    }
                    let matched = boundaries.iter().find(|(day, time)| {
                        days == if *day == 6 { 1 } else { 1 << (*day + 1) }
                            && boundary.ends_with(&format!("T{time}:00"))
                            && deck_core::caps::network::next_weekly_boundary(*day, time, &boundary)
                                .is_ok()
                    });
                    let Some(item) = matched else {
                        return Ok(false);
                    };
                    if !seen.insert(item.clone()) {
                        return Ok(false);
                    }
                }
                _ => return Ok(false),
            }
        }
        Ok(true)
    }
    pub(crate) fn has_owned_tasks(sid: &str, owner: &str) -> Result<bool, DeckError> {
        let _sta = Apartment::enter()?;
        let root = task_root()?;
        for kind in TRIGGERS {
            if root
                .method_object(
                    "GetTask",
                    vec![task_name(sid, owner, kind)?.as_str().into()],
                )
                .is_ok()
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
    pub(crate) fn trigger_status(
        sid: &str,
        owner: &str,
        rules: &NetworkRules,
        exe: &Path,
        argument: &str,
    ) -> Result<(Vec<NetworkTriggerStatus>, bool), DeckError> {
        let _sta = Apartment::enter()?;
        let root = task_root()?;
        let mut statuses = vec![];
        for kind in TRIGGERS {
            let name = task_name(sid, owner, kind)?;
            let registered = root
                .method_object("GetTask", vec![name.as_str().into()])
                .and_then(|task| matches_recipe(&task, sid, kind, rules, exe, argument))
                .unwrap_or(false);
            statuses.push(NetworkTriggerStatus {
                kind: kind.into(),
                required: required(kind, rules),
                registered,
            });
        }
        let original = [
            "NetworkRoutine_Reconcile_Startup",
            "NetworkRoutine_Reconcile_Logon",
            "NetworkRoutine_Reconcile_Unlock",
            "NetworkRoutine_Reconcile_ConsoleConnect",
            "NetworkRoutine_Reconcile_WifiChange",
            "NetworkRoutine_Reconcile_Schedule",
            "NetworkRoutine_Reconcile_Minutely",
        ]
        .iter()
        .any(|name| root.method_object("GetTask", vec![(*name).into()]).is_ok());
        Ok((statuses, original))
    }
    pub(crate) fn configure_tasks(
        sid: &str,
        owner: &str,
        rules: &NetworkRules,
        enabled: bool,
        exe: &Path,
        argument: &str,
        now: &str,
    ) -> Result<(), DeckError> {
        let _sta = Apartment::enter()?;
        let root = task_root()?;
        for kind in TRIGGERS {
            let name = task_name(sid, owner, kind)?;
            if enabled && required(kind, rules) {
                let xml = task_xml(sid, owner, kind, rules, exe, argument, now)?;
                root.invoke(
                    "RegisterTask",
                    vec![
                        name.as_str().into(),
                        xml.as_str().into(),
                        6i32.into(),
                        sid.into(),
                        "".into(),
                        3i32.into(),
                    ],
                )?;
            } else if root
                .method_object("GetTask", vec![name.as_str().into()])
                .is_ok()
            {
                root.invoke("DeleteTask", vec![name.as_str().into(), 0i32.into()])?;
            }
        }
        Ok(())
    }
}
#[cfg(windows)]
pub(crate) use win::{adapters, apply, configure_tasks, has_owned_tasks, inspect, trigger_status};
#[cfg(not(windows))]
pub(crate) fn has_owned_tasks(_sid: &str, _owner: &str) -> Result<bool, DeckError> {
    Err(failed())
}
#[cfg(not(windows))]
pub(crate) fn adapters() -> Result<Vec<NativeAdapter>, DeckError> {
    Err(failed())
}
#[cfg(not(windows))]
pub(crate) fn inspect(_guid: &str, _scan: bool) -> Result<NetworkSnapshot, DeckError> {
    Err(failed())
}
#[cfg(not(windows))]
pub(crate) fn apply(
    _guid: &str,
    _mode: NetworkMode,
    _patch: &Ipv4Patch,
) -> Result<NetworkSnapshot, DeckError> {
    Err(failed())
}
#[cfg(not(windows))]
pub(crate) fn trigger_status(
    _sid: &str,
    _owner: &str,
    _rules: &NetworkRules,
    _exe: &Path,
    _argument: &str,
) -> Result<(Vec<NetworkTriggerStatus>, bool), DeckError> {
    Err(failed())
}
#[cfg(not(windows))]
pub(crate) fn configure_tasks(
    _sid: &str,
    _owner: &str,
    _rules: &NetworkRules,
    _enabled: bool,
    _exe: &Path,
    _argument: &str,
    _now: &str,
) -> Result<(), DeckError> {
    Err(failed())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rules() -> NetworkRules {
        NetworkRules {
            decision_mode: NetworkDecisionMode::Hybrid,
            days: (0..7)
                .map(|i| deck_core::caps::network::NetworkDaySchedule {
                    enabled: i == 0,
                    start: "22:00".into(),
                    end: "06:00".into(),
                })
                .collect(),
            internal_names: vec!["Office".into()],
            external_names: vec![],
        }
    }
    #[test]
    fn six_fixed_recipes_and_overnight_end() {
        let rules = rules();
        for kind in TRIGGERS {
            let xml = task_xml(
                "S-1-5-21-100",
                "sample-tool",
                kind,
                &rules,
                Path::new("C:/Synthetic & Test/deck.exe"),
                "sample-tool~0123456789abcdef0123456789abcdef~4",
                "2026-07-06T12:00:00",
            )
            .unwrap();
            assert!(xml.contains("network-routine sample-tool~"));
            assert!(xml.contains("Synthetic &amp; Test"));
            assert!(!xml.contains("powershell"));
            assert!(xml.contains("<MultipleInstancesPolicy>Queue</MultipleInstancesPolicy>"));
            assert!(!xml.contains("IgnoreNew"));
            if kind == "schedule" {
                assert!(xml.contains("<Tuesday/>"));
                assert!(xml.contains("2026-07-07T06:00:00"));
            }
            if kind == "wifi" {
                assert!(xml.contains("EventID=8001 or EventID=8003"));
            }
        }
        assert!(
            task_xml(
                "S-1-5-21-100",
                "sample-tool",
                "arbitrary",
                &rules,
                Path::new("C:/deck.exe"),
                "x",
                "2026-07-06T12:00:00"
            )
            .is_err()
        );
    }
    #[test]
    fn schedule_does_not_register_wifi_and_wifi_only_has_no_schedule() {
        let mut r = rules();
        r.decision_mode = NetworkDecisionMode::Schedule;
        assert!(!required("wifi", &r));
        r.decision_mode = NetworkDecisionMode::WifiOnly;
        assert!(!required("schedule", &r));
        assert!(required("wifi", &r));
    }
}
