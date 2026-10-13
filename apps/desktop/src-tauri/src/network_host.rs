// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Owner-isolated network records and fixed-worker transactions. No OS mutation happens in GUI.
use crate::file_read::{DirectoryGuard, FileReadSession, READ_CHUNK_BYTES};
use crate::state::AppState;
use deck_core::caps::network::*;
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const VERSION: &str = env!("CARGO_PKG_VERSION");
const RECONFIGURE_REQUIRED: &str = "RECONFIGURE_REQUIRED";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    owner: String,
    sid: String,
    profile_handle: String,
    routine_handle: String,
    revision: u32,
    adapter_guid: String,
    adapter: AdapterInfo,
    internal: Ipv4Patch,
    rules: NetworkRules,
    enabled: bool,
    state: NetworkRoutineState,
    snapshot: Option<NetworkSnapshot>,
    decision: Option<NetworkDecision>,
    error: Option<String>,
    resource_root: PathBuf,
    exe: PathBuf,
    exe_hash: String,
    runner_version: String,
}
/// Only these fixed elevated operations can be requested by the host.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum ElevatedAction {
    Configure { enabled: bool },
    Apply { mode: NetworkMode, manual: bool },
    Stop,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ElevatedRequest {
    pub owner: String,
    pub profile_handle: String,
    pub revision: u32,
    pub action: ElevatedAction,
    pub sid: String,
    pub nonce: String,
}
/// Process-wide GUI service. Every persistent transaction additionally takes an OS file lock.
pub struct NetworkService {
    root: PathBuf,
    resource_root: PathBuf,
    exe: PathBuf,
    adapters: Mutex<HashMap<String, (String, crate::network_native::NativeAdapter)>>,
    pending: Mutex<HashMap<String, bool>>,
}
fn failure() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "네트워크 설정을 저장하거나 읽지 못했어요. 도구를 다시 열어 주세요.",
    )
}
fn denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 모듈의 저장된 네트워크 설정이 아니에요.",
    )
}
fn stale() -> DeckError {
    DeckError::new(
        ErrorCode::VersionMismatch,
        "저장된 설정이 달라졌어요. 상태를 다시 불러와 주세요.",
    )
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "다른 네트워크 작업이 끝난 뒤 다시 시도해 주세요.",
    )
}
fn token() -> Result<String, DeckError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| failure())?;
    Ok(deck_core::util::to_hex(&bytes))
}
fn valid_token(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|c| c.is_ascii_hexdigit())
}
fn owner_path(root: &Path, owner: &str) -> Result<PathBuf, DeckError> {
    if !deck_core::util::is_valid_module_id(owner) {
        return Err(denied());
    }
    Ok(root.join(format!("{owner}.json")))
}
fn default_rules() -> NetworkRules {
    NetworkRules {
        decision_mode: NetworkDecisionMode::Schedule,
        days: (0..7)
            .map(|i| NetworkDaySchedule {
                enabled: i < 5,
                start: "08:20".into(),
                end: "16:20".into(),
            })
            .collect(),
        internal_names: vec![],
        external_names: vec![],
    }
}
fn read_record(root: &Path, owner: &str) -> Result<Option<Record>, DeckError> {
    let path = owner_path(root, owner)?;
    if !path.exists() {
        return Ok(None);
    }
    let mut session = FileReadSession::open(&path)?;
    if session.size() > 65536 {
        return Err(failure());
    }
    let mut bytes = vec![];
    while u64::try_from(bytes.len()).map_err(|_| failure())? < session.size() {
        let next = session.read_chunk(
            u64::try_from(bytes.len()).map_err(|_| failure())?,
            usize::try_from(session.size() - bytes.len() as u64).map_err(|_| failure())?,
        )?;
        if next.is_empty() {
            return Err(failure());
        }
        bytes.extend(next);
    }
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| failure())?;
    if record.owner != owner
        || !valid_token(&record.profile_handle)
        || !valid_token(&record.routine_handle)
        || record.revision == 0
    {
        return Err(denied());
    }
    validate_rules(&record.rules)?;
    validate_profile(&NetworkSaveProfileArgs {
        adapter_handle: record.adapter.adapter_handle.clone(),
        internal: record.internal.clone(),
        external: NetworkExternalProfile {
            address: "dhcp".into(),
            dns: "dhcp".into(),
        },
    })?;
    Ok(Some(record))
}
fn write_record(root: &Path, record: &Record) -> Result<(), DeckError> {
    let guard = DirectoryGuard::open(root)?;
    let path = owner_path(root, &record.owner)?;
    let bytes = serde_json::to_vec(record).map_err(|_| failure())?;
    if bytes.len() > 65536 {
        return Err(failure());
    }
    let temp = root.join(format!(".{}.{}.tmp", record.owner, token()?));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)
        .map_err(|_| failure())?;
    let result = (|| {
        file.write_all(&bytes).map_err(|_| failure())?;
        file.sync_all().map_err(|_| failure())?;
        drop(file);
        guard.validate()?;
        std::fs::rename(&temp, &path).map_err(|_| failure())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
/// Nonblocking cross-process record lock: overlapping task triggers cannot both apply.
fn lock_record(root: &Path, owner: &str) -> Result<(DirectoryGuard, File), DeckError> {
    let guard = DirectoryGuard::open(root)?;
    let _ = owner_path(root, owner)?;
    let path = root.join(format!("{owner}.lock"));
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0).custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(|_| busy())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if file.metadata().map_err(|_| failure())?.file_attributes() & 0x400 != 0 {
            return Err(denied());
        }
    }
    guard.validate()?;
    Ok((guard, file))
}
fn hash_file(path: &Path) -> Result<String, DeckError> {
    let mut source = FileReadSession::open(path)?;
    let mut hash = Sha256::new();
    let mut offset = 0;
    while offset < source.size() {
        let length = usize::try_from((source.size() - offset).min(READ_CHUNK_BYTES as u64))
            .map_err(|_| failure())?;
        let bytes = source.read_chunk(offset, length)?;
        if bytes.is_empty() {
            return Err(failure());
        }
        offset += u64::try_from(bytes.len()).map_err(|_| failure())?;
        hash.update(&bytes);
    }
    Ok(deck_core::util::to_hex(&hash.finalize()))
}
fn runner_argument(record: &Record) -> String {
    format!(
        "{}~{}~{}",
        record.owner, record.routine_handle, record.revision
    )
}
fn validate_revision(
    record: &Record,
    owner: &str,
    profile: &str,
    revision: u32,
) -> Result<(), DeckError> {
    if record.owner != owner || record.profile_handle != profile {
        return Err(denied());
    }
    if record.revision != revision {
        return Err(stale());
    }
    Ok(())
}
fn increment(record: &mut Record) -> Result<(), DeckError> {
    record.revision = record.revision.checked_add(1).ok_or_else(stale)?;
    Ok(())
}

impl NetworkService {
    /// Blocked persistence fallback: adapter inquiry remains usable and disk mutations fail closed.
    pub fn unavailable() -> Self {
        Self {
            root: PathBuf::new(),
            resource_root: PathBuf::new(),
            exe: PathBuf::new(),
            adapters: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        }
    }
    /// Opens a dedicated internal directory; constructor does not change OS network/tasks.
    pub fn open(root: PathBuf, resource_root: PathBuf, exe: PathBuf) -> Result<Self, DeckError> {
        std::fs::create_dir_all(&root).map_err(|_| failure())?;
        DirectoryGuard::open(&root)?;
        Ok(Self {
            root,
            resource_root,
            exe,
            adapters: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        })
    }
    fn selected(
        &self,
        owner: &str,
        handle: &str,
    ) -> Result<crate::network_native::NativeAdapter, DeckError> {
        let handles = self.adapters.lock().map_err(|_| failure())?;
        let (selected_owner, adapter) = handles.get(handle).ok_or_else(denied)?;
        if selected_owner != owner {
            return Err(denied());
        }
        Ok(adapter.clone())
    }
    fn adapter_handle(
        &self,
        owner: &str,
        adapter: crate::network_native::NativeAdapter,
    ) -> Result<AdapterInfo, DeckError> {
        let mut handles = self.adapters.lock().map_err(|_| failure())?;
        let handle = handles
            .iter()
            .find(|(_, (stored_owner, stored))| {
                stored_owner == owner && stored.guid == adapter.guid
            })
            .map(|(handle, _)| handle.clone())
            .unwrap_or(token()?);
        handles.insert(handle.clone(), (owner.into(), adapter.clone()));
        Ok(AdapterInfo {
            adapter_handle: handle,
            display_name: adapter.display_name,
            adapter_type: adapter.adapter_type,
            available: true,
        })
    }
    /// Discover real adapters, returning only module-owned opaque tokens.
    pub(crate) fn adapters(&self, owner: &str) -> Result<Vec<AdapterInfo>, DeckError> {
        crate::network_native::adapters()?
            .into_iter()
            .map(|adapter| self.adapter_handle(owner, adapter))
            .collect()
    }
    /// Read a selected adapter; a stale or other-owner token is rejected before native access.
    pub(crate) fn inspect(
        &self,
        owner: &str,
        args: &NetworkInspectArgs,
    ) -> Result<NetworkSnapshot, DeckError> {
        let adapter = self.selected(owner, &args.adapter_handle)?;
        crate::network_native::inspect(&adapter.guid, args.scan_wifi)
    }
    /// Persist a profile without switching an adapter. Any old automatic tasks become stale.
    pub(crate) fn save_profile(
        &self,
        owner: &str,
        args: &NetworkSaveProfileArgs,
    ) -> Result<NetworkProfileRef, DeckError> {
        validate_profile(args)?;
        let selected = self.selected(owner, &args.adapter_handle)?;
        let _lock = lock_record(&self.root, owner)?;
        let old = read_record(&self.root, owner)?;
        let sid = crate::native_workers::current_sid()?;
        let mut record = if let Some(record) = old {
            record
        } else {
            Record {
                owner: owner.into(),
                sid: sid.clone(),
                profile_handle: token()?,
                routine_handle: token()?,
                revision: 0,
                adapter_guid: selected.guid.clone(),
                adapter: AdapterInfo {
                    adapter_handle: args.adapter_handle.clone(),
                    display_name: selected.display_name.clone(),
                    adapter_type: selected.adapter_type.clone(),
                    available: true,
                },
                internal: args.internal.clone(),
                rules: default_rules(),
                enabled: false,
                state: NetworkRoutineState::default(),
                snapshot: None,
                decision: None,
                error: None,
                resource_root: self.resource_root.clone(),
                exe: self.exe.clone(),
                exe_hash: hash_file(&self.exe)?,
                runner_version: VERSION.into(),
            }
        };
        if record.sid != sid {
            return Err(denied());
        }
        let changed = record.adapter_guid != selected.guid || record.internal != args.internal;
        if changed {
            record.state = NetworkRoutineState::default();
        }
        record.adapter_guid = selected.guid;
        record.adapter = AdapterInfo {
            adapter_handle: args.adapter_handle.clone(),
            display_name: selected.display_name,
            adapter_type: selected.adapter_type,
            available: true,
        };
        record.internal = args.internal.clone();
        record.enabled = false;
        record.error = None;
        record.resource_root.clone_from(&self.resource_root);
        record.exe.clone_from(&self.exe);
        record.exe_hash = hash_file(&self.exe)?;
        record.runner_version = VERSION.into();
        increment(&mut record)?;
        write_record(&self.root, &record)?;
        Ok(NetworkProfileRef {
            profile_handle: record.profile_handle,
            revision: record.revision,
        })
    }
    fn status_record(&self, record: &Record) -> Result<RoutineStatus, DeckError> {
        let current_runner = runner_matches(
            record,
            VERSION,
            &self.exe,
            &self.resource_root,
            hash_file(&self.exe).ok().as_deref(),
        );
        self.adapters.lock().map_err(|_| failure())?.insert(
            record.adapter.adapter_handle.clone(),
            (
                record.owner.clone(),
                crate::network_native::NativeAdapter {
                    guid: record.adapter_guid.clone(),
                    display_name: record.adapter.display_name.clone(),
                    adapter_type: record.adapter.adapter_type.clone(),
                },
            ),
        );
        let (triggers, original) = crate::network_native::trigger_status(
            &record.sid,
            &record.owner,
            &record.rules,
            &self.exe,
            &runner_argument(record),
        )
        .unwrap_or_else(|_| {
            (
                crate::network_native::TRIGGERS
                    .iter()
                    .map(|kind| NetworkTriggerStatus {
                        kind: (*kind).into(),
                        required: crate::network_native::required(kind, &record.rules),
                        registered: false,
                    })
                    .collect(),
                false,
            )
        });
        Ok(RoutineStatus {
            routine_handle: record.routine_handle.clone(),
            profile: NetworkProfileRef {
                profile_handle: record.profile_handle.clone(),
                revision: record.revision,
            },
            adapter: record.adapter.clone(),
            internal: record.internal.clone(),
            rules: record.rules.clone(),
            enabled: current_runner
                && record.enabled
                && triggers.iter().all(|t| !t.required || t.registered),
            decision: record.decision.clone(),
            snapshot: record.snapshot.clone(),
            state: record.state.clone(),
            triggers,
            original_automation_detected: original,
            error: if current_runner {
                record.error.clone()
            } else {
                Some(RECONFIGURE_REQUIRED.into())
            },
        })
    }
    /// Re-reads persisted state rather than trusting cached GUI state.
    pub(crate) fn status(
        &self,
        owner: &str,
        args: &NetworkStatusArgs,
    ) -> Result<Option<RoutineStatus>, DeckError> {
        let _lock = lock_record(&self.root, owner)?;
        let Some(record) = read_record(&self.root, owner)? else {
            return Ok(None);
        };
        if args
            .routine_handle
            .as_ref()
            .is_some_and(|handle| handle != &record.routine_handle)
        {
            return Err(denied());
        }
        self.status_record(&record).map(Some)
    }
    fn configure_saved(
        &self,
        owner: &str,
        args: &NetworkConfigureArgs,
    ) -> Result<Record, DeckError> {
        validate_rules(&args.rules)?;
        let _lock = lock_record(&self.root, owner)?;
        let mut record = read_record(&self.root, owner)?.ok_or_else(denied)?;
        validate_revision(&record, owner, &args.profile_handle, args.revision)?;
        if record.rules != args.rules {
            record.state = NetworkRoutineState::default();
        }
        record.rules = args.rules.clone();
        record.enabled = false;
        increment(&mut record)?;
        write_record(&self.root, &record)?;
        Ok(record)
    }
    fn begin_pending(&self, owner: &str) -> Result<(), DeckError> {
        let mut pending = self.pending.lock().map_err(|_| failure())?;
        if pending.get(owner) == Some(&true) {
            return Err(busy());
        }
        pending.insert(owner.into(), true);
        Ok(())
    }
    fn finish_pending(&self, owner: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(owner);
        }
    }
    fn elevated(&self, record: &Record, action: ElevatedAction) -> Result<(), DeckError> {
        let request = ElevatedRequest {
            owner: record.owner.clone(),
            profile_handle: record.profile_handle.clone(),
            revision: record.revision,
            action,
            sid: record.sid.clone(),
            nonce: token()?,
        };
        let jobs = self.root.parent().ok_or_else(failure)?.join("native-jobs");
        std::fs::create_dir_all(&jobs).map_err(|_| failure())?;
        let guard = DirectoryGuard::open(&jobs)?;
        let path = jobs.join(format!("{}.json", request.nonce));
        let bytes = serde_json::to_vec(&request).map_err(|_| failure())?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| failure())?;
        file.write_all(&bytes).map_err(|_| failure())?;
        file.sync_all().map_err(|_| failure())?;
        drop(file);
        guard.validate()?;
        let hash = hash_file(&path)?;
        let argument = format!("{}~{hash}", request.nonce);
        let result = crate::native_workers::run_elevated(&self.exe, &argument);
        let response = jobs.join(format!("{}.result", request.nonce));
        let output = match result {
            Ok(()) => std::fs::read(&response)
                .map_err(|_| failure())
                .and_then(|bytes| {
                    serde_json::from_slice::<Result<(), DeckError>>(&bytes).map_err(|_| failure())
                })
                .and_then(|value| value),
            Err(error) => Err(error),
        };
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&response);
        output
    }
    /// Full configure transaction; only UAC worker registers fixed tasks.
    pub(crate) fn configure(
        &self,
        owner: &str,
        args: &NetworkConfigureArgs,
    ) -> Result<NetworkConfigureResult, DeckError> {
        self.begin_pending(owner)?;
        let result = (|| {
            let record = self.configure_saved(owner, args)?;
            if args.enabled || crate::network_native::has_owned_tasks(&record.sid, owner)? {
                self.elevated(
                    &record,
                    ElevatedAction::Configure {
                        enabled: args.enabled,
                    },
                )?;
            }
            let status = self
                .status(
                    owner,
                    &NetworkStatusArgs {
                        routine_handle: Some(record.routine_handle.clone()),
                    },
                )?
                .ok_or_else(denied)?;
            Ok(NetworkConfigureResult {
                routine_handle: record.routine_handle,
                status,
            })
        })();
        self.finish_pending(owner);
        result
    }
    /// Manual apply records its hold only after real apply and re-read succeeded.
    pub(crate) fn apply(
        &self,
        owner: &str,
        args: &NetworkApplyArgs,
    ) -> Result<NetworkApplyResult, DeckError> {
        self.begin_pending(owner)?;
        let result = (|| {
            let record = {
                let _lock = lock_record(&self.root, owner)?;
                let record = read_record(&self.root, owner)?.ok_or_else(denied)?;
                validate_revision(&record, owner, &args.profile_handle, args.revision)?;
                record
            };
            self.elevated(
                &record,
                ElevatedAction::Apply {
                    mode: args.mode,
                    manual: true,
                },
            )?;
            let fresh = read_record(&self.root, owner)?.ok_or_else(denied)?;
            Ok(NetworkApplyResult {
                snapshot: fresh.snapshot.ok_or_else(failure)?,
                manual_override_segment: fresh.state.manual_override_segment_id,
            })
        })();
        self.finish_pending(owner);
        result
    }
    /// Evaluate only saved rules; dirty GUI settings cannot enter this method.
    pub(crate) fn evaluate(
        &self,
        owner: &str,
        args: &NetworkRoutineArgs,
    ) -> Result<RoutineStatus, DeckError> {
        let (record, action) = {
            let _lock = lock_record(&self.root, owner)?;
            let mut record = read_record(&self.root, owner)?.ok_or_else(denied)?;
            if record.routine_handle != args.routine_handle {
                return Err(denied());
            }
            let snapshot = crate::network_native::inspect(
                &record.adapter_guid,
                record.rules.decision_mode != NetworkDecisionMode::Schedule,
            )?;
            let decision = decide(&record.rules, &local_time(), &snapshot)?;
            let action = reconcile(
                record.enabled,
                &record.internal,
                &mut record.state,
                &decision,
                &snapshot,
            );
            record.snapshot = Some(snapshot);
            record.decision = Some(decision);
            write_record(&self.root, &record)?;
            (record, action)
        };
        if action == ReconcileAction::Apply
            && let Some(mode) = record.decision.as_ref().and_then(|d| d.mode)
        {
            self.elevated(
                &record,
                ElevatedAction::Apply {
                    mode,
                    manual: false,
                },
            )?;
        }
        self.status(
            owner,
            &NetworkStatusArgs {
                routine_handle: Some(args.routine_handle.clone()),
            },
        )?
        .ok_or_else(denied)
    }
    /// Stop owned automation without switching IPv4/DNS.
    pub(crate) fn stop(
        &self,
        owner: &str,
        args: &NetworkRoutineArgs,
    ) -> Result<NetworkStopResult, DeckError> {
        let record = {
            let _lock = lock_record(&self.root, owner)?;
            let mut record = read_record(&self.root, owner)?.ok_or_else(denied)?;
            if record.routine_handle != args.routine_handle {
                return Err(denied());
            }
            record.enabled = false;
            increment(&mut record)?;
            write_record(&self.root, &record)?;
            record
        };
        self.elevated(&record, ElevatedAction::Stop)?;
        Ok(NetworkStopResult { stopped: true })
    }
}

#[cfg(windows)]
fn local_time() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}
#[cfg(not(windows))]
fn local_time() -> String {
    "1970-01-01T00:00:00".into()
}
fn worker_root() -> Result<PathBuf, DeckError> {
    let root = std::env::var_os("APPDATA").ok_or_else(failure)?;
    Ok(PathBuf::from(root).join("io.github.teacherdeck.deck"))
}
/// Retains installed catalog/package read locks through OS mutation so revoke/update cannot race.
struct GrantGuard {
    _catalog: FileReadSession,
    _package: FileReadSession,
}
fn grant_guard(record: &Record, revision: u32) -> Result<GrantGuard, DeckError> {
    if !worker_permitted(record, revision, VERSION, true)? {
        return Err(denied());
    }
    if record.sid != crate::native_workers::current_sid()?
        || record.exe != std::env::current_exe().map_err(|_| failure())?
        || record.exe_hash != hash_file(&record.exe)?
    {
        return Err(stale());
    }
    let catalog_path = record.resource_root.join("modules/index.json");
    let mut catalog = FileReadSession::open(&catalog_path)?;
    if catalog.size() > 1024 * 1024 {
        return Err(denied());
    }
    let mut bytes = Vec::new();
    while u64::try_from(bytes.len()).map_err(|_| failure())? < catalog.size() {
        let chunk = catalog.read_chunk(
            u64::try_from(bytes.len()).map_err(|_| failure())?,
            usize::try_from((catalog.size() - bytes.len() as u64).min(READ_CHUNK_BYTES as u64))
                .map_err(|_| failure())?,
        )?;
        if chunk.is_empty() {
            return Err(denied());
        }
        bytes.extend_from_slice(&chunk);
    }
    let index =
        deck_core::catalog::CatalogIndex::parse(std::str::from_utf8(&bytes).map_err(|_| denied())?)
            .map_err(|_| denied())?;
    let caps = deck_core::caps::host_caps();
    let store = crate::modules::ModuleStore::load_bundled(&record.resource_root, &caps);
    crate::bridge::authorize(&store, &caps, &record.owner, "network", "apply")?;
    let version = store.served_version(&record.owner).ok_or_else(denied)?;
    let entry = index
        .modules
        .get(&record.owner)
        .and_then(|entries| {
            entries
                .iter()
                .find(|entry| entry.version.to_string() == version)
        })
        .ok_or_else(denied)?;
    let package_path = record
        .resource_root
        .join("modules")
        .join(entry.url.trim_end_matches('/'))
        .join(crate::modules::package_file_name(&record.owner, &version));
    let package = FileReadSession::open(&package_path)?;
    // A package may have changed between the first lookup and its read lock. Re-read the grant
    // while both installed inputs are locked, and retain the locks through the OS operation.
    let locked_store = crate::modules::ModuleStore::load_bundled(&record.resource_root, &caps);
    crate::bridge::authorize(&locked_store, &caps, &record.owner, "network", "apply")?;
    if locked_store.served_version(&record.owner).as_deref() != Some(version.as_str()) {
        return Err(stale());
    }
    Ok(GrantGuard {
        _catalog: catalog,
        _package: package,
    })
}
fn worker_permitted(
    record: &Record,
    revision: u32,
    runner_version: &str,
    module_granted: bool,
) -> Result<bool, DeckError> {
    validate_rules(&record.rules)?;
    Ok(record.revision == revision && record.runner_version == runner_version && module_granted)
}
fn runner_matches(
    record: &Record,
    version: &str,
    exe: &Path,
    resources: &Path,
    hash: Option<&str>,
) -> bool {
    record.runner_version == version
        && record.exe == exe
        && record.resource_root == resources
        && hash.is_some_and(|hash| record.exe_hash == hash)
}
fn apply_record(record: &mut Record, mode: NetworkMode, manual: bool) -> Result<(), DeckError> {
    apply_record_with(
        record,
        mode,
        manual,
        &local_time(),
        crate::network_native::inspect,
        crate::network_native::apply,
    )
}
fn apply_record_with(
    record: &mut Record,
    mode: NetworkMode,
    manual: bool,
    now: &str,
    inspect: impl Fn(&str, bool) -> Result<NetworkSnapshot, DeckError>,
    apply: impl Fn(&str, NetworkMode, &Ipv4Patch) -> Result<NetworkSnapshot, DeckError>,
) -> Result<(), DeckError> {
    let before = inspect(
        &record.adapter_guid,
        record.rules.decision_mode != NetworkDecisionMode::Schedule,
    )?;
    let decision = decide(&record.rules, now, &before)?;
    if !manual {
        let action = reconcile(
            record.enabled,
            &record.internal,
            &mut record.state,
            &decision,
            &before,
        );
        if action != ReconcileAction::Apply {
            return Ok(());
        }
        if decision.mode != Some(mode) {
            return Err(stale());
        }
    }
    let verified = match apply(&record.adapter_guid, mode, &record.internal) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            // WMI changes address, gateway and DNS in separate calls. A failure may be partial.
            // Never leave the pre-apply snapshot looking like the current adapter state.
            record.snapshot = inspect(
                &record.adapter_guid,
                record.rules.decision_mode != NetworkDecisionMode::Schedule,
            )
            .ok();
            record.decision = record
                .snapshot
                .as_ref()
                .and_then(|snapshot| decide(&record.rules, now, snapshot).ok());
            record.error = Some(format!("{:?}", error.code));
            return Err(error);
        }
    };
    // The native adapter returns only after verifying DNS source, paired mask and gateway.
    if manual {
        record.state.manual_override_segment_id = decision.segment_id.clone();
        record.state.manual_override_mode = Some(mode);
        record.state.last_applied_mode = Some(mode);
    } else {
        complete_apply(&mut record.state, &decision);
    }
    record.snapshot = Some(verified);
    record.decision = Some(decision);
    record.error = None;
    Ok(())
}
/// Called only by fixed self-exe UAC mode; request hash binds exactly the reviewed payload.
pub(crate) fn run_elevated_request(argument: &str) -> Result<(), DeckError> {
    let (nonce, hash) = argument.split_once('~').ok_or_else(denied)?;
    if !valid_token(nonce) || hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(denied());
    }
    let app_root = worker_root()?;
    let jobs = app_root.join("native-jobs");
    let guard = DirectoryGuard::open(&jobs)?;
    let path = jobs.join(format!("{nonce}.json"));
    let mut request_file = FileReadSession::open(&path)?;
    if request_file.size() > 65536 {
        return Err(denied());
    }
    let bytes = request_file.read_chunk(
        0,
        usize::try_from(request_file.size()).map_err(|_| denied())?,
    )?;
    if deck_core::util::to_hex(&Sha256::digest(&bytes)) != hash {
        return Err(stale());
    }
    let request: ElevatedRequest = serde_json::from_slice(&bytes).map_err(|_| denied())?;
    if request.nonce != nonce || request.sid != crate::native_workers::current_sid()? {
        return Err(denied());
    }
    let root = app_root.join("native-network");
    let result = (|| {
        let _lock = lock_record(&root, &request.owner)?;
        let mut record = read_record(&root, &request.owner)?.ok_or_else(denied)?;
        validate_revision(
            &record,
            &request.owner,
            &request.profile_handle,
            request.revision,
        )?;
        let _grant = grant_guard(&record, request.revision)?;
        match request.action {
            ElevatedAction::Configure { enabled } => {
                crate::network_native::configure_tasks(
                    &record.sid,
                    &record.owner,
                    &record.rules,
                    enabled,
                    &record.exe,
                    &runner_argument(&record),
                    &local_time(),
                )?;
                record.enabled = enabled;
            }
            ElevatedAction::Apply { mode, manual } => {
                if let Err(error) = apply_record(&mut record, mode, manual) {
                    write_record(&root, &record)?;
                    return Err(error);
                }
            }
            ElevatedAction::Stop => {
                crate::network_native::configure_tasks(
                    &record.sid,
                    &record.owner,
                    &record.rules,
                    false,
                    &record.exe,
                    &runner_argument(&record),
                    &local_time(),
                )?;
                record.enabled = false;
            }
        }
        write_record(&root, &record)
    })();
    guard.validate()?;
    let response = serde_json::to_vec(&result).map_err(|_| failure())?;
    let target = jobs.join(format!("{nonce}.result"));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|_| failure())?;
    file.write_all(&response).map_err(|_| failure())?;
    file.sync_all().map_err(|_| failure())?;
    Ok(())
}
/// Every scheduled invocation reacquires record lock, revision and current installation permission.
pub(crate) fn run_saved_routine(argument: &str) -> Result<(), DeckError> {
    let mut parts = argument.split('~');
    let owner = parts.next().ok_or_else(denied)?;
    let routine = parts.next().ok_or_else(denied)?;
    let revision = parts
        .next()
        .ok_or_else(denied)?
        .parse::<u32>()
        .map_err(|_| denied())?;
    if parts.next().is_some() || !valid_token(routine) {
        return Err(denied());
    }
    let root = worker_root()?.join("native-network");
    // A different trigger family can arrive while another worker owns the record. Wait
    // within the task's two-minute lifetime, then read revision, permission, time and Wi-Fi
    // afresh. UI transactions retain their immediate Busy behavior.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    let _lock = retry_contention(
        || lock_record(&root, owner),
        || {
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            true
        },
    )?;
    let mut record = read_record(&root, owner)?.ok_or_else(denied)?;
    if !record.enabled || record.routine_handle != routine {
        return Err(denied());
    }
    let _grant = grant_guard(&record, revision)?;
    let snapshot = crate::network_native::inspect(
        &record.adapter_guid,
        record.rules.decision_mode != NetworkDecisionMode::Schedule,
    )?;
    let decision = decide(&record.rules, &local_time(), &snapshot)?;
    let action = reconcile(
        record.enabled,
        &record.internal,
        &mut record.state,
        &decision,
        &snapshot,
    );
    record.snapshot = Some(snapshot);
    record.decision = Some(decision.clone());
    if action == ReconcileAction::Apply
        && let Some(mode) = decision.mode
        && let Err(error) = apply_record(&mut record, mode, false)
    {
        record.error = Some(format!("{:?}", error.code));
        write_record(&root, &record)?;
        return Err(error);
    }
    write_record(&root, &record)
}

/// Main bridge checks current in-memory permissions before launching any service transaction.
pub(crate) fn authorize_current(
    app: &AppHandle,
    owner: &str,
    method: &str,
) -> Result<(), DeckError> {
    let state = app.state::<AppState>();
    let store = state.modules.read().map_err(|_| failure())?;
    crate::bridge::authorize(&store, &state.host_caps, owner, "network", method)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> Record {
        Record {
            owner: "sample-tool".into(),
            sid: "S-1-5-21-100".into(),
            profile_handle: "a".repeat(32),
            routine_handle: "b".repeat(32),
            revision: 4,
            adapter_guid: "00000000-0000-0000-0000-000000000000".into(),
            adapter: AdapterInfo {
                adapter_handle: "c".repeat(32),
                display_name: "합성 어댑터".into(),
                adapter_type: "ethernet".into(),
                available: true,
            },
            internal: Ipv4Patch {
                address: None,
                mask: None,
                gateway: None,
                dns: vec![],
            },
            rules: default_rules(),
            enabled: true,
            state: NetworkRoutineState::default(),
            snapshot: None,
            decision: None,
            error: None,
            resource_root: PathBuf::new(),
            exe: PathBuf::new(),
            exe_hash: String::new(),
            runner_version: VERSION.into(),
        }
    }
    #[test]
    fn partial_apply_failure_reads_back_without_marking_a_success_or_reapplying() {
        use std::cell::Cell;
        for readback_fails in [false, true] {
            let mut record = record();
            let reads = Cell::new(0);
            let applies = Cell::new(0);
            record.snapshot = Some(NetworkSnapshot {
                ips: vec!["192.0.2.1".into()],
                ..Default::default()
            });
            let result = apply_record_with(
                &mut record,
                NetworkMode::Internal,
                true,
                "2026-10-12T09:00:00",
                |_, _| {
                    reads.set(reads.get() + 1);
                    if reads.get() == 2 && readback_fails {
                        return Err(failure());
                    }
                    Ok(NetworkSnapshot {
                        ips: vec![
                            if reads.get() == 1 {
                                "192.0.2.1"
                            } else {
                                "192.0.2.2"
                            }
                            .into(),
                        ],
                        ..Default::default()
                    })
                },
                |_, _, _| {
                    applies.set(applies.get() + 1);
                    Err(failure())
                },
            );
            assert!(result.is_err());
            assert_eq!(reads.get(), 2);
            assert_eq!(applies.get(), 1);
            assert!(record.state.manual_override_segment_id.is_empty());
            assert!(record.state.last_applied_mode.is_none());
            assert!(record.error.is_some());
            if readback_fails {
                assert!(record.snapshot.is_none());
                assert!(record.decision.is_none());
            } else {
                assert_eq!(record.snapshot.unwrap().ips, vec!["192.0.2.2"]);
                assert!(record.decision.is_some());
            }
        }
    }
    #[test]
    fn stale_revision_removed_module_and_old_runner_cannot_apply() {
        let record = record();
        assert!(worker_permitted(&record, 4, VERSION, true).unwrap());
        assert!(!worker_permitted(&record, 3, VERSION, true).unwrap());
        assert!(!worker_permitted(&record, 4, VERSION, false).unwrap());
        assert!(!worker_permitted(&record, 4, "old-runner", true).unwrap());
        assert!(validate_revision(&record, "another-tool", &record.profile_handle, 4).is_err());
        assert!(validate_revision(&record, "sample-tool", "other-profile", 4).is_err());
    }
    #[test]
    fn runner_update_requires_explicit_resave_for_version_hash_and_location() {
        let mut r = record();
        r.exe = PathBuf::from("C:/Synthetic/deck.exe");
        r.resource_root = PathBuf::from("C:/Synthetic/resources");
        r.exe_hash = "synthetic-hash".into();
        assert!(runner_matches(
            &r,
            VERSION,
            &r.exe,
            &r.resource_root,
            Some("synthetic-hash")
        ));
        assert!(!runner_matches(
            &r,
            "next-version",
            &r.exe,
            &r.resource_root,
            Some("synthetic-hash")
        ));
        assert!(!runner_matches(
            &r,
            VERSION,
            &r.exe,
            &r.resource_root,
            Some("changed")
        ));
        assert!(!runner_matches(
            &r,
            VERSION,
            Path::new("C:/Moved/deck.exe"),
            &r.resource_root,
            Some("synthetic-hash")
        ));
        assert!(!runner_matches(
            &r,
            VERSION,
            &r.exe,
            Path::new("C:/Moved/resources"),
            Some("synthetic-hash")
        ));
        assert!(!runner_matches(&r, VERSION, &r.exe, &r.resource_root, None));
        r.runner_version = "next-version".into();
        r.exe_hash = "changed".into();
        assert!(runner_matches(
            &r,
            "next-version",
            &r.exe,
            &r.resource_root,
            Some("changed")
        ));
    }
    #[test]
    fn bounded_action_rejects_arbitrary_payload() {
        assert!(
            serde_json::from_value::<ElevatedAction>(
                serde_json::json!({"kind":"runScript","command":"arbitrary"})
            )
            .is_err()
        );
        assert!(owner_path(Path::new("C:/Synthetic"), "../outside").is_err());
    }
    #[test]
    fn atomic_profile_roundtrip_and_damage_is_not_reset() {
        let root =
            std::env::temp_dir().join(format!("deck-network-synthetic-{}", token().unwrap()));
        std::fs::create_dir_all(&root).unwrap();
        let original = record();
        write_record(&root, &original).unwrap();
        assert_eq!(
            read_record(&root, "sample-tool").unwrap().unwrap().revision,
            4
        );
        std::fs::write(root.join("sample-tool.json"), "damaged synthetic").unwrap();
        assert!(read_record(&root, "sample-tool").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("sample-tool.json")).unwrap(),
            "damaged synthetic"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn file_hash_reads_small_files_and_final_partial_chunk_exactly() {
        let root = std::env::temp_dir().join(format!("deck-network-hash-{}", token().unwrap()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.bin");
        for bytes in [b"synthetic".to_vec(), vec![7u8; READ_CHUNK_BYTES + 17]] {
            std::fs::write(&path, &bytes).unwrap();
            assert_eq!(
                hash_file(&path).unwrap(),
                deck_core::util::to_hex(&Sha256::digest(&bytes))
            );
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn six_overlapping_triggers_share_one_os_lock() {
        let root = std::env::temp_dir().join(format!("deck-network-lock-{}", token().unwrap()));
        std::fs::create_dir_all(&root).unwrap();
        let first = lock_record(&root, "sample-tool").unwrap();
        for _ in 0..6 {
            assert!(lock_record(&root, "sample-tool").is_err());
        }
        drop(first);
        assert!(lock_record(&root, "sample-tool").is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
