// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `fs` capability (capabilities.md §2.2). Paths stay in the handle table; modules only get
//! handles and display names (CAP-002). Never log paths or names (PRV-003).

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use deck_core::caps::fs::{
    DroppedFiles, FileHandleInfo, FolderHandleInfo, HandleArgs, PickFilesArgs, extension_of,
};
use deck_core::error::{DeckError, ErrorCode};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::{internal, parse_args, to_value};
use crate::state::AppState;

/// fs methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// `pickFiles`
    PickFiles,
    /// `pickFolder`
    PickFolder,
    /// `stat`
    Stat,
    /// `reveal`
    Reveal,
}

impl Op {
    /// Maps a method name.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "pickFiles" => Self::PickFiles,
            "pickFolder" => Self::PickFolder,
            "stat" => Self::Stat,
            "reveal" => Self::Reveal,
            _ => return None,
        })
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Builds the module-visible info for `path` under `handle`.
fn file_info(handle: String, path: &Path) -> std::io::Result<FileHandleInfo> {
    let meta = std::fs::metadata(path)?;
    let name = display_name(path);
    Ok(FileHandleInfo {
        ext: extension_of(&name),
        name,
        size: meta.len(),
        modified_at: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)),
        handle,
    })
}

fn issue(state: &AppState, module_id: &str, path: PathBuf) -> Result<String, DeckError> {
    let mut table = state.handles.lock().map_err(|_| internal())?;
    Ok(table.issue(module_id, path))
}

fn resolve(state: &AppState, module_id: &str, handle: &str) -> Result<PathBuf, DeckError> {
    let table = state.handles.lock().map_err(|_| internal())?;
    table
        .resolve(module_id, handle)
        .cloned()
        .map_err(|e| DeckError::new(e.code(), e.to_string()))
}

fn io_error(e: &std::io::Error) -> DeckError {
    if e.kind() == std::io::ErrorKind::NotFound {
        DeckError::new(ErrorCode::NotFound, "파일이 옮겨졌거나 삭제됐어요.")
    } else {
        DeckError::new(ErrorCode::Internal, "파일 정보를 읽을 수 없어요.")
    }
}

/// Issues handles for dropped paths (files only) for the active module (BRG-009).
pub fn issue_dropped(state: &AppState, module_id: &str, paths: &[PathBuf]) -> DroppedFiles {
    let files = paths
        .iter()
        .filter(|p| p.is_file())
        .filter_map(|p| {
            let handle = issue(state, module_id, p.clone()).ok()?;
            file_info(handle, p).ok()
        })
        .collect();
    DroppedFiles { files }
}

/// Runs an fs method.
pub async fn call(
    app: &AppHandle,
    state: &AppState,
    module_id: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    match op {
        Op::PickFiles => {
            let a: PickFilesArgs = parse_args(args)?;
            let multiple = a.multiple.unwrap_or(false);
            let mut dialog = app.dialog().file();
            for f in a.filters.unwrap_or_default() {
                let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
                dialog = dialog.add_filter(f.name, &exts);
            }
            let picked = tauri::async_runtime::spawn_blocking(move || {
                if multiple {
                    dialog.blocking_pick_files()
                } else {
                    dialog.blocking_pick_file().map(|f| vec![f])
                }
            })
            .await
            .map_err(|_| internal())?
            .unwrap_or_default();
            let mut out = Vec::new();
            for fp in picked {
                let Ok(path) = fp.into_path() else { continue };
                let handle = issue(state, module_id, path.clone())?;
                out.push(file_info(handle, &path).map_err(|e| io_error(&e))?);
            }
            tracing::debug!(module = %module_id, count = out.len(), "files picked");
            to_value(&out)
        }
        Op::PickFolder => {
            let deck_core::caps::NoArgs {} = parse_args(args)?;
            let dialog = app.dialog().file();
            let picked =
                tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
                    .await
                    .map_err(|_| internal())?;
            let info = match picked.and_then(|fp| fp.into_path().ok()) {
                Some(path) => Some(FolderHandleInfo {
                    name: display_name(&path),
                    handle: issue(state, module_id, path)?,
                }),
                None => None,
            };
            to_value(&info)
        }
        Op::Stat => {
            let HandleArgs { handle } = parse_args(args)?;
            let path = resolve(state, module_id, &handle)?;
            to_value(&file_info(handle, &path).map_err(|e| io_error(&e))?)
        }
        Op::Reveal => {
            let HandleArgs { handle } = parse_args(args)?;
            let path = resolve(state, module_id, &handle)?;
            reveal(&path)?;
            Ok(Value::Null)
        }
    }
}

/// Opens Explorer with the file selected. No shell plugin is involved (SEC-003).
fn reveal(path: &Path) -> Result<(), DeckError> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        // Windows paths cannot contain `"`, so quoting the argument is safe.
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|_| internal())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "이 OS에서는 지원하지 않아요.",
        ))
    }
}
