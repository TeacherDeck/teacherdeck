// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `system` capability types.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Operating system details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OsInfo {
    /// e.g. `windows`.
    pub name: String,
    /// e.g. `10.0`.
    pub version: String,
    /// Build number, e.g. `22631` (Windows 11 is 22000 or later).
    pub build: u32,
}

/// Result of `system.info`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    /// App version (root package.json, VER-001).
    pub app_version: String,
    /// OS details.
    pub os: OsInfo,
    /// BCP 47 locale, e.g. `ko-KR`.
    pub locale: String,
}
