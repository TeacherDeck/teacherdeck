// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `fs` capability types (capabilities.md §2.2). Paths never appear here (CAP-002).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A file type filter for the picker, e.g. `{ name: "이미지", extensions: ["png", "jpg"] }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct FileFilter {
    /// Label shown in the dialog.
    pub name: String,
    /// Extensions without the dot.
    pub extensions: Vec<String>,
}

/// Arguments of `pickFiles`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct PickFilesArgs {
    /// Allow selecting several files.
    #[serde(default)]
    #[ts(optional)]
    pub multiple: Option<bool>,
    /// File type filters.
    #[serde(default)]
    #[ts(optional)]
    pub filters: Option<Vec<FileFilter>>,
}

/// Arguments of `stat` and `reveal`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct HandleArgs {
    /// Handle from `pickFiles`, `pickFolder` or `fs.dropped`.
    pub handle: String,
}

/// A file the user picked or dropped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileHandleInfo {
    /// Opaque handle, valid for this module and app session.
    pub handle: String,
    /// File name for display. Never log it (PRV-003).
    pub name: String,
    /// Lowercase extension without the dot, or empty.
    pub ext: String,
    /// Size in bytes.
    pub size: u64,
    /// Last modification, milliseconds since the Unix epoch.
    pub modified_at: u64,
}

/// A folder the user picked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct FolderHandleInfo {
    /// Opaque handle, valid for this module and app session.
    pub handle: String,
    /// Folder name for display. Never log it (PRV-003).
    pub name: String,
}

/// Payload of the `fs.dropped` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct DroppedFiles {
    /// Dropped files (folders are skipped).
    pub files: Vec<FileHandleInfo>,
}

/// Closes a read session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseReadArgs {
    /// Opaque read session id.
    pub read_id: String,
}

/// A bounded read resource.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileRead {
    /// Opaque read session id.
    pub read_id: String,
    /// Total file bytes.
    pub size: u64,
    /// Maximum bytes per GET.
    pub chunk_bytes: usize,
    /// Same-module resource URL; never log it.
    pub url: String,
}

/// Creates a new output directory under a picked folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateOutputFolderArgs {
    /// Picked folder handle.
    pub parent_handle: String,
    /// One folder name, never a path.
    pub suggested_name: String,
}

/// A newly created output directory and write grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputBatch {
    /// Opaque output grant.
    pub batch_id: String,
    /// Display info for the new folder.
    pub folder: FolderHandleInfo,
}

/// Starts a new output file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BeginWriteArgs {
    /// Output grant.
    pub batch_id: String,
    /// One file name, never a path.
    pub suggested_name: String,
    /// Expected complete size.
    pub size: u64,
}

/// A sequential output write session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileWrite {
    /// Opaque write session.
    pub write_id: String,
    /// Maximum bytes per writeChunk.
    pub chunk_bytes: usize,
}

/// Appends one bounded byte chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteChunkArgs {
    /// Opaque write session.
    pub write_id: String,
    /// Expected byte offset.
    pub offset: u64,
    /// At most 65536 bytes.
    pub data: Vec<u8>,
}

/// Acknowledged write position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteChunkResult {
    /// Offset for the next chunk.
    pub next_offset: u64,
}

/// Commits or aborts a write session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteIdArgs {
    /// Opaque write session.
    pub write_id: String,
}

/// Closes an output grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BatchIdArgs {
    /// Opaque output grant.
    pub batch_id: String,
}

/// Lowercase extension of a file name, without the dot.
pub fn extension_of(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext.to_lowercase(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions() {
        assert_eq!(extension_of("사진.JPG"), "jpg");
        assert_eq!(extension_of("archive.tar.gz"), "gz");
        assert_eq!(extension_of(".gitignore"), "");
        assert_eq!(extension_of("README"), "");
    }

    #[test]
    fn pick_args_are_optional() {
        let a: PickFilesArgs = serde_json::from_str("{}").unwrap();
        assert_eq!(a, PickFilesArgs::default());
        assert!(serde_json::from_str::<PickFilesArgs>(r#"{"path":"C:/"}"#).is_err());
    }
}
