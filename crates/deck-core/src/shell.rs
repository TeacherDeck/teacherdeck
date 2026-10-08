// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Types exchanged between the host and the shell (not visible to modules).

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::caps::fs::DroppedFiles;
use crate::manifest::ModuleManifest;
use crate::resolver::Resolution;

/// Host facts the shell needs at startup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    /// App version (VER-001).
    pub app_version: String,
    /// Whether the Mica backdrop is active (Windows 11). Otherwise draw an opaque background.
    pub mica: bool,
    /// Capability name → version this host provides (`init.host.caps`).
    pub caps: BTreeMap<String, String>,
    /// Origin modules are served from, e.g. `http://deckmod.localhost` (SEC-002).
    pub module_origin: String,
    /// Debug build (enables the UI gallery and invalid-module badges).
    pub dev: bool,
    /// Debug-only SEC-004 probe requested via `DECK_SEC_PROBE=1`.
    pub sec_probe: bool,
}

/// One module as the shell lists it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct ModuleEntry {
    /// Resolver result (state, picked version, unmet caps).
    pub resolution: Resolution,
    /// Manifest of the picked version, or of the newest valid one for display.
    pub manifest: Option<ModuleManifest>,
    /// iframe URL of the picked version's entry, if runnable.
    pub entry_url: Option<String>,
    /// Icon URL, if any version is servable.
    pub icon_url: Option<String>,
}

/// Event the host emits to the shell when files are dropped on the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct FsDroppedEvent {
    /// Module that receives the handles (the active one).
    pub module_id: String,
    /// `fs.dropped` payload to forward to that module (BRG-009).
    pub payload: DroppedFiles,
}

/// Result of an update check (SEC-008: never applied without the user's consent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateStatus {
    /// Updates are not configured yet (no signing key / endpoint).
    NotConfigured,
    /// Already on the latest version.
    UpToDate,
    /// A newer version can be installed.
    Available {
        /// Version offered.
        version: String,
    },
    /// The check failed (offline, blocked by a web filter, ...).
    Failed {
        /// Generic reason without user data.
        reason: String,
    },
}
