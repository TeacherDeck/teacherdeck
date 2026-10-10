// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `fs` capability (capabilities.md §2.2). Paths stay in the handle table; modules only get
//! handles and display names (CAP-002). Never log paths or names (PRV-003).

#[cfg(test)]
#[path = "fs_tests.rs"]
mod tests;

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use deck_core::caps::fs::{
    BatchIdArgs, BeginWriteArgs, CloseReadArgs, CreateOutputFolderArgs, DroppedFiles,
    FileHandleInfo, FolderHandleInfo, HandleArgs, OutputBatch, PickFilesArgs, WriteChunkArgs,
    WriteChunkResult, WriteIdArgs, extension_of,
};
use deck_core::error::{DeckError, ErrorCode};
use serde_json::Value;
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::{internal, parse_args, to_value};
use crate::state::{AppState, FileHandleKind, FileHandleTarget};

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
    /// `openRead`
    OpenRead,
    /// `closeRead`
    CloseRead,
    /// `createOutputFolder`
    CreateOutputFolder,
    /// `beginWrite`
    BeginWrite,
    /// `writeChunk`
    WriteChunk,
    /// `commitWrite`
    CommitWrite,
    /// `abortWrite`
    AbortWrite,
    /// `closeOutputFolder`
    CloseOutputFolder,
}

impl Op {
    /// Maps a method name.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "pickFiles" => Self::PickFiles,
            "pickFolder" => Self::PickFolder,
            "stat" => Self::Stat,
            "reveal" => Self::Reveal,
            "openRead" => Self::OpenRead,
            "closeRead" => Self::CloseRead,
            "createOutputFolder" => Self::CreateOutputFolder,
            "beginWrite" => Self::BeginWrite,
            "writeChunk" => Self::WriteChunk,
            "commitWrite" => Self::CommitWrite,
            "abortWrite" => Self::AbortWrite,
            "closeOutputFolder" => Self::CloseOutputFolder,
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

fn issue(
    state: &AppState,
    module_id: &str,
    path: PathBuf,
    kind: FileHandleKind,
    generation: u64,
) -> Result<String, DeckError> {
    let mut table = state.handles.lock().map_err(|_| internal())?;
    Ok(table.issue(
        module_id,
        FileHandleTarget {
            path,
            kind,
            generation,
        },
    ))
}

fn resolve(
    state: &AppState,
    module_id: &str,
    handle: &str,
    generation: u64,
    kind: Option<FileHandleKind>,
) -> Result<PathBuf, DeckError> {
    let table = state.handles.lock().map_err(|_| internal())?;
    let target = table
        .resolve(module_id, handle)
        .map_err(|e| DeckError::new(e.code(), e.to_string()))?;
    if target.generation != generation || kind.is_some_and(|kind| kind != target.kind) {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "이 작업에 사용할 수 있는 파일 핸들이 아니에요.",
        ));
    }
    Ok(target.path.clone())
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
    let Ok(transfers) = state.transfers.lock() else {
        return DroppedFiles { files: vec![] };
    };
    let generation = transfers.generation(module_id);
    let files = paths
        .iter()
        .filter(|p| p.is_file())
        .filter_map(|p| {
            let handle = issue(
                state,
                module_id,
                p.clone(),
                FileHandleKind::ReadFile,
                generation,
            )
            .ok()?;
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
    let generation = state
        .transfers
        .lock()
        .map_err(|_| internal())?
        .generation(module_id);
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
            let transfers = state.transfers.lock().map_err(|_| internal())?;
            if transfers.generation(module_id) != generation {
                return Err(DeckError::new(
                    ErrorCode::Cancelled,
                    "파일 선택을 취소했어요.",
                ));
            }
            let mut out = Vec::new();
            for fp in picked {
                let Ok(path) = fp.into_path() else { continue };
                let handle = issue(
                    state,
                    module_id,
                    path.clone(),
                    FileHandleKind::ReadFile,
                    generation,
                )?;
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
            let transfers = state.transfers.lock().map_err(|_| internal())?;
            if transfers.generation(module_id) != generation {
                return Err(DeckError::new(
                    ErrorCode::Cancelled,
                    "폴더 선택을 취소했어요.",
                ));
            }
            let info = match picked.and_then(|fp| fp.into_path().ok()) {
                Some(path) => Some(FolderHandleInfo {
                    name: display_name(&path),
                    handle: issue(
                        state,
                        module_id,
                        path,
                        FileHandleKind::OutputParent,
                        generation,
                    )?,
                }),
                None => None,
            };
            to_value(&info)
        }
        Op::Stat => {
            let HandleArgs { handle } = parse_args(args)?;
            let path = resolve(state, module_id, &handle, generation, None)?;
            to_value(&file_info(handle, &path).map_err(|e| io_error(&e))?)
        }
        Op::Reveal => {
            let HandleArgs { handle } = parse_args(args)?;
            let path = resolve(state, module_id, &handle, generation, None)?;
            reveal(&path)?;
            Ok(Value::Null)
        }
        _ => {
            let app = app.clone();
            let module_id = module_id.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<AppState>();
                // Recheck permissions after waiting for a worker; unload generations are checked below.
                {
                    let store = state.modules.read().map_err(|_| internal())?;
                    crate::bridge::authorize(
                        &store,
                        &state.host_caps,
                        &module_id,
                        "fs",
                        op.method(),
                    )?;
                }
                transfer_call(&state, &module_id, generation, op, args)
            })
            .await
            .map_err(|_| internal())?
        }
    }
}

impl Op {
    fn method(self) -> &'static str {
        match self {
            Self::OpenRead => "openRead",
            Self::CloseRead => "closeRead",
            Self::CreateOutputFolder => "createOutputFolder",
            Self::BeginWrite => "beginWrite",
            Self::WriteChunk => "writeChunk",
            Self::CommitWrite => "commitWrite",
            Self::AbortWrite => "abortWrite",
            Self::CloseOutputFolder => "closeOutputFolder",
            Self::PickFiles => "pickFiles",
            Self::PickFolder => "pickFolder",
            Self::Stat => "stat",
            Self::Reveal => "reveal",
        }
    }
}

fn transfer_call(
    state: &AppState,
    owner: &str,
    generation: u64,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    let mut transfers = state.transfers.lock().map_err(|_| internal())?;
    match op {
        Op::OpenRead => {
            let HandleArgs { handle } = parse_args(args)?;
            let path = resolve(
                state,
                owner,
                &handle,
                generation,
                Some(FileHandleKind::ReadFile),
            )?;
            to_value(&transfers.open_read(owner, generation, &path)?)
        }
        Op::CloseRead => {
            let CloseReadArgs { read_id } = parse_args(args)?;
            transfers.close_read(owner, generation, &read_id)?;
            Ok(Value::Null)
        }
        Op::CreateOutputFolder => {
            let a: CreateOutputFolderArgs = parse_args(args)?;
            let parent = resolve(
                state,
                owner,
                &a.parent_handle,
                generation,
                Some(FileHandleKind::OutputParent),
            )?;
            let (batch_id, path) =
                transfers.create_output(owner, generation, &parent, &a.suggested_name)?;
            let folder = FolderHandleInfo {
                name: display_name(&path),
                handle: issue(state, owner, path, FileHandleKind::OutputParent, generation)?,
            };
            to_value(&OutputBatch { batch_id, folder })
        }
        Op::BeginWrite => {
            let a: BeginWriteArgs = parse_args(args)?;
            let temp = state.file_temp.as_ref().ok_or_else(internal)?;
            to_value(&transfers.begin_write(
                owner,
                generation,
                &a.batch_id,
                &a.suggested_name,
                a.size,
                temp,
            )?)
        }
        Op::WriteChunk => {
            let a: WriteChunkArgs = parse_args(args)?;
            to_value(&WriteChunkResult {
                next_offset: transfers.write(owner, generation, &a.write_id, a.offset, &a.data)?,
            })
        }
        Op::CommitWrite => {
            let WriteIdArgs { write_id } = parse_args(args)?;
            let path = transfers.commit(owner, generation, &write_id)?;
            let handle = issue(
                state,
                owner,
                path.clone(),
                FileHandleKind::ReadFile,
                generation,
            )?;
            to_value(&file_info(handle, &path).map_err(|e| io_error(&e))?)
        }
        Op::AbortWrite => {
            let WriteIdArgs { write_id } = parse_args(args)?;
            transfers.abort(owner, generation, &write_id)?;
            Ok(Value::Null)
        }
        Op::CloseOutputFolder => {
            let BatchIdArgs { batch_id } = parse_args(args)?;
            transfers.close_output(owner, generation, &batch_id)?;
            Ok(Value::Null)
        }
        _ => Err(internal()),
    }
}

/// Serves only authenticated, bounded reads from a module's own resource origin.
pub fn serve_file_resource(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = (|| -> Result<Vec<u8>, DeckError> {
        let owner =
            crate::protocol::module_id_from_uri(request.uri()).ok_or_else(resource_denied)?;
        if let Some(origin) = request.headers().get("origin")
            && origin.to_str().ok() != Some(crate::origins::module_origin(owner).as_str())
        {
            return Err(resource_denied());
        }
        let (token, offset, length) = resource_args(request.uri())?;
        {
            let store = state.modules.read().map_err(|_| internal())?;
            crate::bridge::authorize(&store, &state.host_caps, owner, "fs", "openRead")?;
        }
        let mut transfers = state.transfers.lock().map_err(|_| internal())?;
        transfers.read(owner, token, offset, length)
    })();
    match result {
        Ok(bytes) => {
            let size = bytes.len();
            let body = if request.method() == Method::HEAD {
                vec![]
            } else {
                bytes
            };
            let mut response =
                crate::protocol::respond(StatusCode::OK, "application/octet-stream", body);
            if let Ok(value) = size.to_string().parse() {
                response.headers_mut().insert("content-length", value);
            }
            response.headers_mut().insert(
                "cross-origin-resource-policy",
                tauri::http::HeaderValue::from_static("same-origin"),
            );
            response
        }
        Err(error) => {
            let status = match error.code {
                ErrorCode::PermissionDenied => StatusCode::FORBIDDEN,
                ErrorCode::NotFound => StatusCode::NOT_FOUND,
                ErrorCode::InvalidArgs => StatusCode::BAD_REQUEST,
                ErrorCode::Busy => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            let body = if request.method() == Method::HEAD {
                vec![]
            } else {
                serde_json::to_vec(&error).unwrap_or_default()
            };
            crate::protocol::respond(status, "application/json", body)
        }
    }
}

fn resource_denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 파일 자료에 접근할 수 없어요.",
    )
}

fn resource_args(uri: &tauri::http::Uri) -> Result<(&str, u64, usize), DeckError> {
    let invalid = || DeckError::new(ErrorCode::InvalidArgs, "파일 읽기 범위를 확인해 주세요.");
    let token = uri
        .path()
        .strip_prefix("/_resources/")
        .ok_or_else(invalid)?;
    if token.len() != 32
        || !token
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err(invalid());
    }
    let mut offset = None;
    let mut length = None;
    for part in uri.query().ok_or_else(invalid)?.split('&') {
        let (key, value) = part.split_once('=').ok_or_else(invalid)?;
        if value.is_empty() || !value.bytes().all(|c| c.is_ascii_digit()) {
            return Err(invalid());
        }
        match key {
            "offset" if offset.is_none() => {
                offset = Some(value.parse::<u64>().map_err(|_| invalid())?)
            }
            "length" if length.is_none() => {
                length = Some(value.parse::<usize>().map_err(|_| invalid())?)
            }
            _ => return Err(invalid()),
        }
    }
    let length = length.ok_or_else(invalid)?;
    if length > crate::file_read::READ_CHUNK_BYTES {
        return Err(invalid());
    }
    Ok((token, offset.ok_or_else(invalid)?, length))
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
