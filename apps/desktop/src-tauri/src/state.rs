// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Process-wide host state, managed by Tauri.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

use deck_core::caps::HostCaps;
use deck_core::caps::window::WindowOverrides;
use deck_core::handles::HandleTable;

use crate::file_transfer::FileTransfers;
use crate::modules::ModuleStore;
use crate::platform::{OsRng, TempArea};
use crate::storage::StorageService;

/// Shared state of the running app session.
pub struct AppState {
    /// App version (root package.json via tauri.conf.json, VER-001).
    pub app_version: String,
    /// Capability versions this build provides.
    pub host_caps: HostCaps,
    /// Known modules and runnable packages.
    pub modules: RwLock<ModuleStore>,
    /// Handles issued this session (CAP-002).
    pub handles: Mutex<HandleTable<FileHandleTarget, OsRng>>,
    /// File transfer grants, distinct from picked-file/folder handles.
    pub transfers: Mutex<FileTransfers>,
    /// Append-new-only persistent destination permissions.
    pub destinations: Mutex<crate::destination::DestinationService>,
    /// Module storage (PRV-007).
    pub storage: StorageService,
    /// Window state each module changed, restored when it hides.
    pub overrides: Mutex<HashMap<String, WindowOverrides>>,
    /// Module currently shown in the shell (receives `fs.dropped`).
    pub active: Mutex<Option<String>>,
    /// Mica applied to the main window.
    pub mica: AtomicBool,
    /// Debug-only SEC-004 probe requested.
    pub sec_probe: bool,
    /// App temp area (PRV-005).
    pub temp: Option<TempArea>,
    /// Output-only temp area; verified journal recovery replaces recursive cleanup.
    pub file_temp: Option<TempArea>,
    /// Log directory (for the debug probe report).
    pub log_dir: PathBuf,
}

/// A selected handle's allowed use. Never serialize this host-private structure.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileHandleKind {
    /// Read the selected file; no writes.
    ReadFile,
    /// Create a new output directory; no enumeration or existing child writes.
    OutputParent,
}

/// Host-private target of an opaque picked or created handle.
#[derive(Clone)]
pub struct FileHandleTarget {
    /// Host-private absolute path, never sent across the bridge.
    pub path: PathBuf,
    /// Only the capability derived from the user's selection.
    pub kind: FileHandleKind,
    /// Module lifetime in which the selection was made.
    pub generation: u64,
}

impl AppState {
    /// Currently active module id.
    pub fn active_module(&self) -> Option<String> {
        self.active.lock().ok().and_then(|a| a.clone())
    }
}
