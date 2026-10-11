// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Installed-Office conversion; original read locks and append-new fs publication are reused.
use super::{parse_args, to_value};
use crate::state::{AppState, FileHandleKind};
use deck_core::caps::office::{
    OfficeCancelResult, OfficeConvertArgs, OfficeConvertResult, OfficeFormat, OfficeProvider,
    OfficeValidation, OfficeWarningCode, validate_conversion,
};
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
/// Registered installed-Office operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Read registrations without launching Office.
    Availability,
    /// Convert one selected file.
    Convert,
    /// Cancel this owner's current conversion.
    Cancel,
}
impl Op {
    /// Map only registered fixed operations.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "availability" => Some(Self::Availability),
            "convert" => Some(Self::Convert),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}
struct Active {
    owner: String,
    cancel: Arc<AtomicBool>,
}
/// One Office conversion across the application, with owner-bound cancellation.
#[derive(Default)]
pub struct OfficeService {
    active: Mutex<Option<Active>>,
    verified: Mutex<Vec<OfficeProvider>>,
}
impl OfficeService {
    fn record_verified(&self, provider: OfficeProvider) -> Result<(), DeckError> {
        let mut verified = self.verified.lock().map_err(|_| failure())?;
        if !verified.contains(&provider) {
            verified.push(provider);
        }
        Ok(())
    }
    fn begin(&self, owner: &str) -> Result<Arc<AtomicBool>, DeckError> {
        let mut active = self.active.lock().map_err(|_| failure())?;
        if active.is_some() {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "다른 문서 변환이 끝난 뒤 다시 변환해 주세요.",
            ));
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(Active {
            owner: owner.into(),
            cancel: cancel.clone(),
        });
        Ok(cancel)
    }
    fn cancel(&self, owner: &str) -> Result<bool, DeckError> {
        let active = self.active.lock().map_err(|_| failure())?;
        if let Some(active) = active.as_ref().filter(|a| a.owner == owner) {
            active.cancel.store(true, Ordering::Release);
            return Ok(true);
        }
        Ok(false)
    }
    fn finish(&self, owner: &str) {
        if let Ok(mut active) = self.active.lock()
            && active.as_ref().is_some_and(|a| a.owner == owner)
        {
            *active = None;
        }
    }
}
fn failure() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "문서를 변환하지 못했어요. 암호·손상 여부를 확인하고 다시 변환해 주세요.",
    )
}
/// Module unload stops its own worker without touching any published output.
pub fn cancel_owner(app: &AppHandle, owner: &str) {
    if let Some(service) = app.try_state::<OfficeService>() {
        let _ = service.cancel(owner);
    }
}
fn authorize(state: &AppState, owner: &str) -> Result<(), DeckError> {
    let modules = state.modules.read().map_err(|_| failure())?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "office", "convert")?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "fs", "beginWrite")
}
/// Dispatch typed authorized operations.
pub async fn call(
    app: &AppHandle,
    _state: &AppState,
    owner: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    match op {
        Op::Availability => {
            let _: deck_core::caps::NoArgs = parse_args(args)?;
            let mut result =
                tauri::async_runtime::spawn_blocking(crate::native_automation::availability)
                    .await
                    .map_err(|_| failure())??;
            let service = app.state::<OfficeService>();
            let verified = service.verified.lock().map_err(|_| failure())?;
            for provider in &mut result.providers {
                provider.ready = provider.registered && verified.contains(&provider.provider);
            }
            to_value(&result)
        }
        Op::Cancel => {
            let _: deck_core::caps::NoArgs = parse_args(args)?;
            to_value(&OfficeCancelResult {
                requested: app.state::<OfficeService>().cancel(owner)?,
            })
        }
        Op::Convert => {
            let args: OfficeConvertArgs = parse_args(args)?;
            let cancel = app.state::<OfficeService>().begin(owner)?;
            let worker_app = app.clone();
            let worker_owner = owner.to_owned();
            let result = tauri::async_runtime::spawn_blocking(move || {
                convert_one(&worker_app, &worker_owner, &args, &cancel)
            })
            .await
            .map_err(|_| failure())
            .and_then(|value| value);
            app.state::<OfficeService>().finish(owner);
            let result = result?;
            app.state::<OfficeService>()
                .record_verified(result.provider)?;
            to_value(&result)
        }
    }
}
fn cancelled(cancel: &AtomicBool) -> Result<(), DeckError> {
    if cancel.load(Ordering::Acquire) {
        Err(DeckError::new(ErrorCode::Cancelled, "변환을 중지했어요."))
    } else {
        Ok(())
    }
}
fn hash_source(session: &mut crate::file_read::FileReadSession) -> Result<Vec<u8>, DeckError> {
    let mut hash = Sha256::new();
    let mut offset = 0;
    while offset < session.size() {
        let length = usize::try_from(
            (session.size() - offset).min(crate::file_read::READ_CHUNK_BYTES as u64),
        )
        .map_err(|_| failure())?;
        let bytes = session.read_chunk(offset, length)?;
        if bytes.is_empty() {
            return Err(failure());
        }
        offset += u64::try_from(bytes.len()).map_err(|_| failure())?;
        hash.update(&bytes);
    }
    Ok(hash.finalize().to_vec())
}
fn convert_one(
    app: &AppHandle,
    owner: &str,
    args: &OfficeConvertArgs,
    cancel: &AtomicBool,
) -> Result<OfficeConvertResult, DeckError> {
    let state = app.state::<AppState>();
    authorize(&state, owner)?;
    let generation = state
        .transfers
        .lock()
        .map_err(|_| failure())?
        .generation(owner);
    state
        .transfers
        .lock()
        .map_err(|_| failure())?
        .validate_output_batch(owner, generation, &args.batch_id)?;
    let source_path = super::fs::resolve(
        &state,
        owner,
        &args.source_handle,
        generation,
        Some(FileHandleKind::ReadFile),
    )?;
    let extension = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    validate_conversion(args, &extension)?;
    crate::file_output::validate_name(&args.suggested_name)?;
    let mut source = crate::file_read::FileReadSession::open(&source_path)?;
    let original_hash = hash_source(&mut source)?;
    cancelled(cancel)?;
    let temp = state
        .temp
        .as_ref()
        .ok_or_else(failure)?
        .create_dir(&mut crate::platform::OsRng)
        .map_err(|_| failure())?;
    let copied = temp.path().join(format!("source.{extension}"));
    let output = temp
        .path()
        .join(format!("converted.{}", args.target_format.extension()));
    let mut copy = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&copied)
        .map_err(|_| failure())?;
    let mut offset = 0;
    while offset < source.size() {
        cancelled(cancel)?;
        let length = usize::try_from(
            (source.size() - offset).min(crate::file_read::READ_CHUNK_BYTES as u64),
        )
        .map_err(|_| failure())?;
        let bytes = source.read_chunk(offset, length)?;
        if bytes.is_empty() {
            return Err(failure());
        }
        copy.write_all(&bytes).map_err(|_| failure())?;
        offset += u64::try_from(bytes.len()).map_err(|_| failure())?;
    }
    copy.sync_all().map_err(|_| failure())?;
    drop(copy);
    // Retain a read-only sharing lock instead of setting a persistent Windows read-only
    // attribute, which would prevent cleanup of this app-owned temporary copy.
    let _copy_read_lock = crate::file_read::FileReadSession::open(&copied)?;
    crate::native_workers::run_office(
        crate::native_workers::OfficeJob {
            source: copied,
            output: output.clone(),
            format: args.target_format,
            job_name: String::new(),
        },
        cancel,
    )?;
    cancelled(cancel)?;
    validate_package(&output, args.target_format)?;
    if hash_source(&mut source)? != original_hash {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "원본 상태가 달라졌어요. 다시 선택해 주세요.",
        ));
    }
    authorize(&state, owner)?;
    let mut converted = crate::file_read::FileReadSession::open(&output)?;
    let temp_area = state.file_temp.as_ref().ok_or_else(failure)?;
    let write = state.transfers.lock().map_err(|_| failure())?.begin_write(
        owner,
        generation,
        &args.batch_id,
        &args.suggested_name,
        converted.size(),
        temp_area,
    )?;
    let publication = (|| {
        let mut offset = 0;
        while offset < converted.size() {
            cancelled(cancel)?;
            authorize(&state, owner)?;
            let length =
                usize::try_from((converted.size() - offset).min(65536)).map_err(|_| failure())?;
            let bytes = converted.read_chunk(offset, length)?;
            if bytes.is_empty() {
                return Err(failure());
            }
            offset = state.transfers.lock().map_err(|_| failure())?.write(
                owner,
                generation,
                &write.write_id,
                offset,
                &bytes,
            )?;
        }
        cancelled(cancel)?;
        authorize(&state, owner)?;
        state
            .transfers
            .lock()
            .map_err(|_| failure())?
            .commit(owner, generation, &write.write_id)
    })();
    let path = match publication {
        Ok(path) => path,
        Err(error) => {
            if let Ok(mut transfers) = state.transfers.lock() {
                let _ = transfers.abort(owner, generation, &write.write_id);
            }
            return Err(error);
        }
    };
    let handle = super::fs::issue(
        &state,
        owner,
        path.clone(),
        FileHandleKind::ReadFile,
        generation,
    )?;
    let file = super::fs::file_info(handle, &path).map_err(|_| failure())?;
    Ok(OfficeConvertResult {
        file,
        provider: args.target_format.provider(),
        target_format: args.target_format,
        validation: OfficeValidation {
            package_valid: true,
            reopened: true,
            original_unchanged: true,
        },
        warnings: vec![OfficeWarningCode::ReviewLayout],
    })
}
/// Check actual ZIP structure and finite decompressed size before publication.
fn validate_package(path: &std::path::Path, format: OfficeFormat) -> Result<(), DeckError> {
    let file = std::fs::File::open(path).map_err(|_| failure())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| failure())?;
    if archive.len() > 20000 {
        return Err(failure());
    }
    let mut bytes = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| failure())?;
        bytes = bytes.checked_add(entry.size()).ok_or_else(failure)?;
        if bytes > crate::file_read::MAX_FILE_BYTES || entry.enclosed_name().is_none() {
            return Err(failure());
        }
    }
    let required: &[&str] = match format {
        OfficeFormat::Hwpx => &["mimetype", "Contents/content.hpf", "Contents/section0.xml"],
        OfficeFormat::Xlsx | OfficeFormat::Xlsm => &["[Content_Types].xml", "xl/workbook.xml"],
        OfficeFormat::Pptx | OfficeFormat::Pptm => &["[Content_Types].xml", "ppt/presentation.xml"],
        OfficeFormat::Docx | OfficeFormat::Docm => &["[Content_Types].xml", "word/document.xml"],
    };
    for part in required {
        if archive.by_name(part).is_err() {
            return Err(failure());
        }
    }
    if format == OfficeFormat::Hwpx {
        use std::io::Read;
        let mut text = String::new();
        archive
            .by_name("mimetype")
            .map_err(|_| failure())?
            .take(128)
            .read_to_string(&mut text)
            .map_err(|_| failure())?;
        if text.trim() != "application/hwp+zip" {
            return Err(failure());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_is_owner_bound() {
        let service = OfficeService::default();
        let flag = service.begin("sample-a").unwrap();
        assert!(!service.cancel("sample-b").unwrap());
        assert!(!flag.load(Ordering::Acquire));
        assert!(service.begin("sample-b").is_err());
        assert!(service.cancel("sample-a").unwrap());
        assert!(flag.load(Ordering::Acquire));
        service.finish("sample-a");
        assert!(service.begin("sample-b").is_ok());
    }
    #[test]
    fn provider_registration_does_not_imply_verified_conversion() {
        let service = OfficeService::default();
        assert!(service.verified.lock().unwrap().is_empty());
        service.record_verified(OfficeProvider::Excel).unwrap();
        service.record_verified(OfficeProvider::Excel).unwrap();
        assert_eq!(
            *service.verified.lock().unwrap(),
            vec![OfficeProvider::Excel]
        );
    }
    #[test]
    fn routes_only_fixed_office_methods() {
        assert_eq!(Op::parse("convert"), Some(Op::Convert));
        assert_eq!(Op::parse("runScript"), None);
    }
    #[test]
    fn original_hash_accepts_short_input_and_exact_final_partial_chunk() {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).unwrap();
        let root = std::env::temp_dir().join(format!(
            "deck-office-hash-{}",
            deck_core::util::to_hex(&bytes)
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.bin");
        for bytes in [
            b"synthetic".to_vec(),
            vec![5u8; crate::file_read::READ_CHUNK_BYTES + 17],
        ] {
            std::fs::write(&path, &bytes).unwrap();
            let mut session = crate::file_read::FileReadSession::open(&path).unwrap();
            assert_eq!(
                hash_source(&mut session).unwrap(),
                Sha256::digest(&bytes).to_vec()
            );
            let mut result = Vec::new();
            while (result.len() as u64) < session.size() {
                let remaining = (session.size() - result.len() as u64).min(65536) as usize;
                result.extend(session.read_chunk(result.len() as u64, remaining).unwrap());
            }
            assert_eq!(result, bytes);
        }
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
