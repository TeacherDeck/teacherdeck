// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `school-data` 1.0 bridge and trusted shell commands.
use super::{parse_args, to_value};
use crate::school_data::{PhotoResource, SchoolDataService, denied, internal};
use crate::state::AppState;
use deck_core::caps::school_data::*;
use deck_core::caps::timealert::*;
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_dialog::DialogExt;

/// The eight read-only capability methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Dispatches the corresponding school-data Status operation.
    Status,
    /// Dispatches the corresponding school-data RequestAccess operation.
    RequestAccess,
    /// Dispatches the corresponding school-data ListContexts operation.
    ListContexts,
    /// Dispatches the corresponding school-data ReadRoster operation.
    ReadRoster,
    /// Dispatches the corresponding school-data ReadTimetable operation.
    ReadTimetable,
    /// Dispatches the corresponding school-data OpenPhoto operation.
    OpenPhoto,
    /// Dispatches the corresponding school-data ClosePhoto operation.
    ClosePhoto,
    /// Dispatches the corresponding school-data RevokeAccess operation.
    RevokeAccess,
}
impl Op {
    /// Resolves only registered method names.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "status" => Self::Status,
            "requestAccess" => Self::RequestAccess,
            "listContexts" => Self::ListContexts,
            "readRoster" => Self::ReadRoster,
            "readTimetable" => Self::ReadTimetable,
            "openPhoto" => Self::OpenPhoto,
            "closePhoto" => Self::ClosePhoto,
            "revokeAccess" => Self::RevokeAccess,
            _ => return None,
        })
    }
}
fn trusted_identity(label: &str, origin: &str) -> Result<(), DeckError> {
    if label != crate::origins::MAIN_WINDOW || !crate::origins::shell_origins().contains(&origin) {
        return Err(denied());
    }
    Ok(())
}
fn trusted(webview: &Webview) -> Result<(), DeckError> {
    let url = webview.url().map_err(|_| denied())?;
    trusted_identity(webview.label(), &url.origin().ascii_serialization())
}
/// Selects and authenticates a TimeAlert DB7 backup in the trusted main shell only.
#[tauri::command]
pub async fn school_data_open_timealert(
    webview: Webview,
    app: AppHandle,
    args: TimeAlertOpenArgs,
) -> Result<Option<TimeAlertPreview>, DeckError> {
    trusted(&webview)?;
    crate::timealert::archive::password(&args.password)?;
    let dialog = app
        .dialog()
        .file()
        .set_title("TimeAlert 사진 포함 백업 선택")
        .add_filter("TimeAlert 백업", &["teacherbackup"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let temp = state.file_temp.as_ref().ok_or_else(internal)?;
        app.state::<crate::timealert::TimeAlertService>()
            .open(&path, args, temp)
            .map(Some)
    })
    .await
    .map_err(|_| internal())?
}
/// Explicitly applies the reviewed projection; revision and native photo authority are rechecked.
#[tauri::command]
pub async fn school_data_apply_timealert(
    webview: Webview,
    app: AppHandle,
    args: TimeAlertApplyArgs,
) -> Result<SchoolDataDocument, DeckError> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::timealert::TimeAlertService>()
            .apply(args, &app.state::<SchoolDataService>())
    })
    .await
    .map_err(|_| internal())?
}
/// Outputs a new encrypted backup with saved photos; original files remain untouched.
#[tauri::command]
pub async fn school_data_export_timealert(
    webview: Webview,
    app: AppHandle,
    args: TimeAlertExportArgs,
) -> Result<bool, DeckError> {
    trusted(&webview)?;
    crate::timealert::archive::password(&args.password)?;
    let worker_app = app.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let state = worker_app.state::<AppState>();
        let temp = state.file_temp.as_ref().ok_or_else(internal)?;
        worker_app
            .state::<crate::timealert::TimeAlertService>()
            .export(&args, &worker_app.state::<SchoolDataService>(), temp)
    })
    .await
    .map_err(|_| internal())??;
    export_school_file(
        app,
        "TimeAlert 사진 포함 백업을 새 파일로 저장",
        "티처덱_사진포함.teacherbackup",
        bytes,
    )
    .await
}
/// Closes only the specified main-owned temporary backup/workbook session.
#[tauri::command]
pub async fn school_data_close_timealert(
    webview: Webview,
    app: AppHandle,
    args: TimeAlertCloseArgs,
) -> Result<(), DeckError> {
    trusted(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<crate::timealert::TimeAlertService>()
            .close(args)
    })
    .await
    .map_err(|_| internal())?
}
/// Preview and confirmed XLSX-photo apply share one narrowly scoped main-only command.
#[tauri::command]
pub async fn school_data_import_roster_photos(
    webview: Webview,
    app: AppHandle,
    args: TimeAlertRosterPhotosArgs,
) -> Result<Option<TimeAlertRosterPhotosPreview>, DeckError> {
    trusted(&webview)?;
    if args.session_handle.is_some() {
        return tauri::async_runtime::spawn_blocking(move || {
            app.state::<crate::timealert::TimeAlertService>()
                .apply_roster(args, &app.state::<SchoolDataService>())
                .map(Some)
        })
        .await
        .map_err(|_| internal())?;
    }
    let dialog = app
        .dialog()
        .file()
        .set_title("사진명렬표 XLSX 선택 · 대응 검토 후 등록")
        .add_filter("사진명렬표", &["xlsx"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = crate::timealert::read_file(&path, 32 * 1024 * 1024)?;
        app.state::<crate::timealert::TimeAlertService>()
            .open_roster(bytes, &args, &app.state::<SchoolDataService>())
            .map(Some)
    })
    .await
    .map_err(|_| internal())?
}
/// Dispatch; request approval is awaited away from the UI thread.
pub async fn call(
    app: &AppHandle,
    state: &AppState,
    owner: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    let service = app.state::<SchoolDataService>();
    match op {
        Op::Status => {
            let _: deck_core::caps::NoArgs = parse_args(args)?;
            to_value(&service.status(owner)?)
        }
        Op::RequestAccess => {
            let args: SchoolRequestedAccess = parse_args(args)?;
            let name = {
                let modules = state.modules.read().map_err(|_| internal())?;
                modules
                    .runnable(owner)
                    .ok_or_else(denied)?
                    .manifest
                    .name
                    .clone()
            };
            let (id, rx) = service.request(owner, &name, args)?;
            let answer = tauri::async_runtime::spawn_blocking(move || {
                rx.recv_timeout(std::time::Duration::from_secs(120))
            })
            .await
            .map_err(|_| internal())?;
            service.cancel_request(&id);
            let value = answer.map_err(|_| {
                DeckError::new(ErrorCode::Timeout, "학교 자료의 허용을 확인하지 못했어요.")
            })?;
            {
                let modules = state.modules.read().map_err(|_| internal())?;
                crate::bridge::authorize(
                    &modules,
                    &state.host_caps,
                    owner,
                    "school-data",
                    "requestAccess",
                )?;
            }
            to_value(&value)
        }
        Op::ListContexts => to_value(&service.list(owner, parse_args(args)?)?),
        Op::ReadRoster => to_value(&service.roster(owner, parse_args(args)?)?),
        Op::ReadTimetable => to_value(&service.timetable(owner, parse_args(args)?)?),
        Op::OpenPhoto => {
            let args: SchoolOpenPhotoArgs = parse_args(args)?;
            let mut inner = service.inner.lock().map_err(|_| internal())?;
            let (path, info) = service.photo_path(&inner, owner, &args)?;
            let mut transfers = state.transfers.lock().map_err(|_| internal())?;
            let generation = transfers.generation(owner);
            let read = transfers.open_read(owner, generation, &path)?;
            inner.resources.insert(
                read.read_id.clone(),
                PhotoResource {
                    owner: owner.into(),
                    grant: args.grant_handle,
                    live: true,
                    snapshot: args.snapshot_id,
                },
            );
            to_value(&SchoolPhotoResource {
                resource_handle: read.read_id,
                url: read.url,
                size: info.size,
                mime_type: info.mime_type,
                chunk_bytes: read.chunk_bytes as u32,
            })
        }
        Op::ClosePhoto => {
            let args: SchoolClosePhotoArgs = parse_args(args)?;
            let mut inner = service.inner.lock().map_err(|_| internal())?;
            if let Some(r) = inner.resources.get(&args.resource_handle)
                && r.owner != owner
            {
                return Err(denied());
            }
            let mut transfers = state.transfers.lock().map_err(|_| internal())?;
            let generation = transfers.generation(owner);
            transfers.close_read(owner, generation, &args.resource_handle)?;
            inner.resources.remove(&args.resource_handle);
            Ok(Value::Null)
        }
        Op::RevokeAccess => {
            let args: SchoolGrantArgs = parse_args(args)?;
            let resources = service.revoke(owner, &args.grant_handle)?;
            close_resources(state, owner, &resources)?;
            service.forget_resources(owner, &resources);
            Ok(Value::Null)
        }
    }
}
fn close_resources(state: &AppState, owner: &str, resources: &[String]) -> Result<(), DeckError> {
    let mut transfers = state.transfers.lock().map_err(|_| internal())?;
    let generation = transfers.generation(owner);
    for id in resources {
        transfers.close_read(owner, generation, id)?;
    }
    Ok(())
}
/// Drops session authority when the owning iframe unloads.
pub fn unload(app: &AppHandle, owner: &str) {
    let service = app.state::<SchoolDataService>();
    let resources = service.unload(owner);
    let state = app.state::<AppState>();
    if close_resources(&state, owner, &resources).is_ok() {
        service.forget_resources(owner, &resources);
    }
}

/// Trusted-shell school_data_load operation; rejects module webviews.
#[tauri::command]
pub fn school_data_load(webview: Webview, app: AppHandle) -> Result<SchoolDataDocument, DeckError> {
    trusted(&webview)?;
    app.state::<SchoolDataService>().load()
}
/// Trusted-shell school_data_save operation; rejects module webviews.
#[tauri::command]
pub fn school_data_save(
    webview: Webview,
    app: AppHandle,
    args: SaveSchoolDataArgs,
) -> Result<SchoolDataDocument, DeckError> {
    trusted(&webview)?;
    app.state::<SchoolDataService>().save(args)
}
/// Trusted-shell school_data_pending operation; rejects module webviews.
#[tauri::command]
pub fn school_data_pending(
    webview: Webview,
    app: AppHandle,
) -> Result<Vec<SchoolAccessRequest>, DeckError> {
    trusted(&webview)?;
    app.state::<SchoolDataService>().pending()
}
/// Trusted-shell school_data_resolve_access operation; rejects module webviews.
#[tauri::command]
pub fn school_data_resolve_access(
    webview: Webview,
    app: AppHandle,
    args: SchoolAccessResolution,
) -> Result<(), DeckError> {
    trusted(&webview)?;
    let service = app.state::<SchoolDataService>();
    if args.allow {
        let pending = service
            .pending()?
            .into_iter()
            .find(|p| p.request_id == args.request_id)
            .ok_or_else(denied)?;
        let state = app.state::<AppState>();
        let modules = state.modules.read().map_err(|_| internal())?;
        crate::bridge::authorize(
            &modules,
            &state.host_caps,
            &pending.module_id,
            "school-data",
            "requestAccess",
        )?;
    }
    service.resolve(args)
}
/// Trusted-shell school_data_grants operation; rejects module webviews.
#[tauri::command]
pub fn school_data_grants(
    webview: Webview,
    app: AppHandle,
) -> Result<Vec<SchoolGrantRecord>, DeckError> {
    trusted(&webview)?;
    app.state::<SchoolDataService>().grants()
}
/// Trusted-shell school_data_revoke_grant operation; rejects module webviews.
#[tauri::command]
pub fn school_data_revoke_grant(
    webview: Webview,
    app: AppHandle,
    module_id: String,
    grant_handle: String,
) -> Result<(), DeckError> {
    trusted(&webview)?;
    let resources = app
        .state::<SchoolDataService>()
        .revoke(&module_id, &grant_handle)?;
    close_resources(&app.state::<AppState>(), &module_id, &resources)?;
    app.state::<SchoolDataService>()
        .forget_resources(&module_id, &resources);
    Ok(())
}
#[tauri::command]
pub async fn school_data_import_photo(
    webview: Webview,
    app: AppHandle,
    args: SchoolImportPhotoArgs,
) -> Result<SchoolDataDocument, DeckError> {
    trusted(&webview)?;
    let current = app.state::<SchoolDataService>().load()?;
    if current.revision != args.expected_revision
        || !current.students.iter().any(|s| s.id == args.student_id)
    {
        return Err(denied());
    }
    let dialog = app
        .dialog()
        .file()
        .set_title("학생 사진 선택")
        .add_filter("사진", &["png", "jpg", "jpeg", "webp"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(current);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<SchoolDataService>().import_photo(args, path)
    })
    .await
    .map_err(|_| internal())?
}

/// Picks a TeacherDeck school JSON without modifying it; TimeAlert encrypted backups are separate.
#[tauri::command]
pub async fn school_data_read_backup(
    webview: Webview,
    app: AppHandle,
) -> Result<Option<SchoolDataDocument>, DeckError> {
    trusted(&webview)?;
    let dialog = app
        .dialog()
        .file()
        .set_title("TeacherDeck 학교 자료 JSON 선택")
        .add_filter("학교 자료 JSON", &["json"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = crate::file_read::FileReadSession::open(&path)?;
        if file.size() > 32 * 1024 * 1024 {
            return Err(DeckError::new(
                ErrorCode::InvalidArgs,
                "학교 자료 JSON의 크기를 확인해 주세요.",
            ));
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        while bytes.len() < file.size() as usize {
            bytes.extend(file.read_chunk(
                bytes.len() as u64,
                (file.size() as usize - bytes.len()).min(crate::file_read::READ_CHUNK_BYTES),
            )?);
        }
        crate::school_data::output::read_backup(&bytes).map(Some)
    })
    .await
    .map_err(|_| internal())?
}
/// Used only after the trusted shell's explicit corruption-recovery confirmation.
#[tauri::command]
pub fn school_data_recover(
    webview: Webview,
    app: AppHandle,
    args: SaveSchoolDataArgs,
) -> Result<SchoolDataDocument, DeckError> {
    trusted(&webview)?;
    app.state::<SchoolDataService>().recover(args)
}

/// Trusted native XLSX picker. Only bounded XML parts reach the trusted renderer.
#[tauri::command]
pub async fn school_data_read_workbook(
    webview: Webview,
    app: AppHandle,
) -> Result<Option<SchoolWorkbookInput>, DeckError> {
    trusted(&webview)?;
    let dialog = app
        .dialog()
        .file()
        .set_title("명부·시간표 XLSX 선택")
        .add_filter("엑셀 명부·시간표", &["xlsx", "xls"]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = crate::file_read::FileReadSession::open(&path)?;
        if file.size() > 32 * 1024 * 1024 {
            return Err(DeckError::new(
                ErrorCode::InvalidArgs,
                "XLSX 파일은 32MiB 이내로 나누어 주세요.",
            ));
        }
        let mut bytes = Vec::with_capacity(file.size() as usize);
        while bytes.len() < file.size() as usize {
            bytes.extend(file.read_chunk(
                bytes.len() as u64,
                (file.size() as usize - bytes.len()).min(crate::file_read::READ_CHUNK_BYTES),
            )?);
        }
        crate::school_data::workbook::read(bytes).map(Some)
    })
    .await
    .map_err(|_| internal())?
}
/// Existing files are preserved. Publication reuses the host's journaled append-new output.
#[tauri::command]
pub async fn school_data_write_workbook(
    webview: Webview,
    app: AppHandle,
    args: SchoolWorkbookOutputArgs,
) -> Result<bool, DeckError> {
    trusted(&webview)?;
    // Validate before asking the teacher to choose a destination.
    let args = tauri::async_runtime::spawn_blocking(move || {
        crate::school_data::workbook::write(&args).map(|bytes| (args, bytes))
    })
    .await
    .map_err(|_| internal())??;
    let dialog = app
        .dialog()
        .file()
        .set_title("XLSX 새 파일을 저장할 폴더 선택");
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let temp = state.file_temp.as_ref().ok_or_else(internal)?;
        let batch = crate::file_output::OutputBatch::append_destination(&path)?;
        let name = if args.0.sheet_name == "학생 명단" {
            "다음교시_학생명단.xlsx"
        } else {
            "다음교시_시간표.xlsx"
        };
        let mut file = batch.begin(name, args.1.len() as u64, temp)?;
        let mut offset = 0;
        for bytes in args.1.chunks(crate::file_output::WRITE_CHUNK_BYTES) {
            offset = file.append(offset, bytes)?;
        }
        file.commit()?;
        Ok(true)
    })
    .await
    .map_err(|_| internal())?
}

/// Exports current validated host data, excluding photo files and unsaved shell drafts.
#[tauri::command]
pub async fn school_data_export_backup(
    webview: Webview,
    app: AppHandle,
) -> Result<bool, DeckError> {
    trusted(&webview)?;
    let worker_app = app.clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::school_data::output::backup(&worker_app.state::<SchoolDataService>().load()?)
    })
    .await
    .map_err(|_| internal())??;
    export_school_file(
        app,
        "복구 JSON 저장 폴더 선택 · 사진 파일 미포함",
        "티처덱_명부시간표_복구.json",
        bytes,
    )
    .await
}
/// Only main may submit an image; format/size are checked before the destination picker.
#[tauri::command]
pub async fn school_data_export_timetable_image(
    webview: Webview,
    app: AppHandle,
    args: deck_core::shell::SchoolTimetableImageArgs,
) -> Result<bool, DeckError> {
    trusted(&webview)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        crate::school_data::output::png(&args.png_base64)
    })
    .await
    .map_err(|_| internal())??;
    export_school_file(
        app,
        "현재 화면 시간표 PNG 저장 폴더 선택",
        "티처덱_시간표.png",
        bytes,
    )
    .await
}
async fn export_school_file(
    app: AppHandle,
    title: &str,
    name: &'static str,
    bytes: Vec<u8>,
) -> Result<bool, DeckError> {
    let dialog = app.dialog().file().set_title(title);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|_| internal())?;
    let Some(picked) = picked else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|_| denied())?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let temp = state.file_temp.as_ref().ok_or_else(internal)?;
        crate::school_data::output::publish(&path, name, &bytes, temp)?;
        Ok(true)
    })
    .await
    .map_err(|_| internal())?
}

/// Uses the existing authenticated, bounded resource protocol, without an fs grant.
pub fn serve_photo_resource(
    app: &AppHandle,
    state: &AppState,
    request: &Request<Vec<u8>>,
) -> Option<Response<Vec<u8>>> {
    let service = app.state::<SchoolDataService>();
    let mut inner = service.inner.lock().ok()?;
    let token = request.uri().path().strip_prefix("/_resources/")?;
    let resource = inner.resources.get(token)?;
    let result = (|| {
        let owner = crate::protocol::module_id_from_uri(request.uri()).ok_or_else(denied)?;
        if !resource.live
            || resource.owner != owner
            || request.headers().get("origin").is_some_and(|h| {
                h.to_str().ok() != Some(crate::origins::module_origin(owner).as_str())
            })
        {
            return Err(denied());
        }
        inner.authorize_resource(owner, &resource.grant, &resource.snapshot)?;
        let modules = state.modules.read().map_err(|_| internal())?;
        crate::bridge::authorize(
            &modules,
            &state.host_caps,
            owner,
            "school-data",
            "openPhoto",
        )?;
        let mut offset = None;
        let mut length = None;
        for p in request.uri().query().ok_or_else(denied)?.split('&') {
            let (k, v) = p.split_once('=').ok_or_else(denied)?;
            if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) {
                return Err(denied());
            }
            match k {
                "offset" if offset.is_none() => {
                    offset = Some(v.parse::<u64>().map_err(|_| denied())?)
                }
                "length" if length.is_none() => {
                    length = Some(v.parse::<usize>().map_err(|_| denied())?)
                }
                _ => return Err(denied()),
            }
        }
        let length = length.ok_or_else(denied)?;
        if length > crate::file_read::READ_CHUNK_BYTES {
            return Err(denied());
        }
        state.transfers.lock().map_err(|_| internal())?.read(
            owner,
            token,
            offset.ok_or_else(denied)?,
            length,
        )
    })();
    let (status, body, mime) = match result {
        Ok(bytes) => (StatusCode::OK, bytes, "application/octet-stream"),
        Err(e) => (
            StatusCode::FORBIDDEN,
            serde_json::to_vec(&e).unwrap_or_default(),
            "application/json",
        ),
    };
    let size = body.len();
    let mut response = crate::protocol::respond(
        status,
        mime,
        if request.method() == tauri::http::Method::HEAD {
            vec![]
        } else {
            body
        },
    );
    if let Ok(v) = size.to_string().parse() {
        response.headers_mut().insert("content-length", v);
    }
    response.headers_mut().insert(
        "cross-origin-resource-policy",
        tauri::http::HeaderValue::from_static("same-origin"),
    );
    let _ = &mut inner;
    Some(response)
}

#[cfg(test)]
mod trusted_output_tests {
    use super::*;
    #[test]
    fn export_identity_rejects_module_origin_and_overlay_even_with_shell_origin() {
        assert!(trusted_identity("main", crate::origins::SHELL_ORIGIN).is_ok());
        for (label, origin) in [
            ("main", crate::origins::MODULE_ORIGIN),
            ("main", "http://deckmod.timer.modules.localhost"),
            ("overlay", crate::origins::SHELL_ORIGIN),
            ("main", "https://example.invalid"),
        ] {
            assert_eq!(
                trusted_identity(label, origin).unwrap_err().code,
                ErrorCode::PermissionDenied
            );
        }
    }
}
