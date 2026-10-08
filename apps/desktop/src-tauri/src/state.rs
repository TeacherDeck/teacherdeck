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
    pub handles: Mutex<HandleTable<PathBuf, OsRng>>,
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
    /// Log directory (for the debug probe report).
    pub log_dir: PathBuf,
}

impl AppState {
    /// Currently active module id.
    pub fn active_module(&self) -> Option<String> {
        self.active.lock().ok().and_then(|a| a.clone())
    }
}
