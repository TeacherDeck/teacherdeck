// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! File operation contracts. User paths remain exclusively in the host (ADR-0019).
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One rename request. The target is a single name, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameItem {
    /// Owned read-file handle.
    pub source_handle: String,
    /// Exact desired name, including extension.
    pub target_name: String,
}
/// Plans one bounded batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct PlanRenameArgs {
    /// At most 2,000 distinct input files.
    pub items: Vec<RenameItem>,
}
/// Per-file plan or execution outcome. Names are never included in general errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum RenameStatus {
    /// Safe pending change.
    Ready,
    /// Already has the desired exact name.
    Unchanged,
    /// Invalid target or duplicate input.
    Invalid,
    /// Destination collision.
    Conflict,
    /// Input identity or content changed.
    Changed,
    /// Successfully changed.
    Success,
    /// Operation failed without destroying data.
    Failed,
    /// Not yet attempted.
    NotStarted,
}
/// Preview row belonging to a plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenamePreview {
    /// Owned input handle.
    pub source_handle: String,
    /// Exact name supplied by the requester; display only.
    pub final_name: String,
    /// Host validation result.
    pub status: RenameStatus,
}
/// Immutable plan identity and preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenamePlan {
    /// Opaque owner/session-bound plan.
    pub plan_handle: String,
    /// Ordered previews.
    pub items: Vec<RenamePreview>,
    /// Unix milliseconds expiry.
    pub expires_at: u64,
}
/// Advances one independent collision/exchange group in the plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecuteRenameArgs {
    /// Same opaque plan until done=true; first call asks the user on the host.
    pub plan_handle: String,
}
/// One row's execution status.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameOutcome {
    /// Original opaque input handle.
    pub source_handle: String,
    /// Cumulative row result.
    pub status: RenameStatus,
}
/// Cumulative result after advancing one group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameResult {
    /// Present after journal creation.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub history_handle: Option<String>,
    /// Successful changes so far.
    pub success: u32,
    /// Attempted failures so far.
    pub failed: u32,
    /// Changes not yet started.
    pub not_started: u32,
    /// All original rows in plan order.
    pub items: Vec<RenameOutcome>,
    /// No pending group remains.
    pub done: bool,
}
/// Bounded owner-private history query.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ListHistoryArgs {
    /// Opaque cursor returned by the previous page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cursor: Option<String>,
    /// Default and maximum20.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub limit: Option<u32>,
}
/// History state disclosed without file names or paths.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum RenameHistoryState {
    /// Unfinished execution.
    Pending,
    /// Completed rename, undo available after verification.
    Completed,
    /// At least one group could not be safely restored.
    Blocked,
    /// All executed changes restored.
    Undone,
}
/// Display-safe host history summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameHistory {
    /// Opaque owner-bound journal handle, persistent across restarts.
    pub history_handle: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// Number of change requests.
    pub total: u32,
    /// Successfully changed files still recorded.
    pub success: u32,
    /// Files whose group cannot be safely restored.
    pub blocked: u32,
    /// Safe summary of journal state.
    pub state: RenameHistoryState,
}
/// History page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenameHistoryPage {
    /// At most20 entries.
    pub entries: Vec<RenameHistory>,
    /// Omitted when exhausted.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
}
/// Advances one protected undo group. First call asks the user on the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoRenameArgs {
    /// Persistent owner-bound history handle.
    pub history_handle: String,
}
/// Undo counts without paths or user content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UndoRenameResult {
    /// Restored files so far.
    pub success: u32,
    /// Files whose restore operation failed.
    pub failed: u32,
    /// Files protected because identity, contents or destination changed.
    pub blocked: u32,
    /// No unattempted group remains.
    pub done: bool,
}

/// Conservative Windows file-name validation; invalid text is never silently rewritten.
pub fn valid_target_name(name: &str) -> bool {
    let device = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let numbered_device = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"));
    !name.is_empty()
        && name.encode_utf16().count() <= 240
        && !name.ends_with([' ', '.'])
        && !name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !matches!(
            device.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
        )
        && !numbered_device.is_some_and(|tail| {
            matches!(
                tail,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_exact_and_single_component() {
        for name in ["가상 자료.pdf", "CONTRACT.txt", ".hidden", "001.bin"] {
            assert!(valid_target_name(name));
        }
        for name in [
            "",
            "../a",
            "a\\b",
            "C:abc",
            "x.",
            "x ",
            "NUL.txt",
            "COM1",
            "lpt².pdf",
            "a\0b",
        ] {
            assert!(!valid_target_name(name));
        }
        assert!(!valid_target_name(&"가".repeat(241)));
    }
    #[test]
    fn paths_and_unknown_fields_are_rejected() {
        assert!(serde_json::from_str::<PlanRenameArgs>(r#"{"items":[],"path":"x"}"#).is_err());
        assert!(
            serde_json::from_str::<RenameItem>(
                r#"{"sourceHandle":"x","targetName":"a","path":"x"}"#
            )
            .is_err()
        );
    }
}
