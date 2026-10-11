// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Owner/generation-bound queued media downloads with append-new publication (ADR-0028).
use super::{parse_args, to_value};
use crate::file_read::{DirectoryGuard, FileReadSession};
use crate::media_worker::{check, failure};
use crate::state::{AppState, FileHandleKind};
use deck_core::caps::media_download::*;
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager};

/// Fixed registered media operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Queue one normalized video and selected folder.
    Start,
    /// Read only the owned job snapshot.
    Status,
    /// Signal an owned active job.
    Cancel,
}
impl Op {
    /// Map registry methods only.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "start" => Some(Self::Start),
            "status" => Some(Self::Status),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}
struct Job {
    owner: String,
    generation: u64,
    created: Instant,
    cancel: AtomicBool,
    status: Mutex<MediaDownloadStatus>,
}
/// Keeps the most recent 32 snapshots without ever evicting active work.
#[derive(Default)]
pub struct MediaDownloadService {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}
fn terminal(stage: MediaDownloadStage) -> bool {
    matches!(
        stage,
        MediaDownloadStage::Complete | MediaDownloadStage::Cancelled | MediaDownloadStage::Failed
    )
}
impl MediaDownloadService {
    fn begin(&self, owner: &str, generation: u64) -> Result<(String, Arc<Job>), DeckError> {
        let mut jobs = self.jobs.lock().map_err(|_| failure())?;
        if jobs.values().any(|job| {
            job.status
                .lock()
                .map(|s| !terminal(s.stage))
                .unwrap_or(true)
        }) {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "이전 다운로드를 완료하거나 취소한 뒤 다시 시작해 주세요.",
            ));
        }
        if jobs.len() >= 32 {
            let oldest = jobs
                .iter()
                .min_by_key(|(_, job)| job.created)
                .map(|(id, _)| id.clone())
                .ok_or_else(failure)?;
            jobs.remove(&oldest); // Snapshot only; completed fs handles and files remain untouched.
        }
        let mut token = [0; 16];
        getrandom::fill(&mut token).map_err(|_| failure())?;
        let id = deck_core::util::to_hex(&token);
        if jobs.contains_key(&id) {
            return Err(failure());
        }
        let job = Arc::new(Job {
            owner: owner.into(),
            generation,
            created: Instant::now(),
            cancel: AtomicBool::new(false),
            status: Mutex::new(MediaDownloadStatus {
                job_handle: id.clone(),
                stage: MediaDownloadStage::PreparingEngine,
                downloaded_bytes: 0,
                total_bytes: None,
                file: None,
                error: None,
            }),
        });
        jobs.insert(id.clone(), job.clone());
        Ok((id, job))
    }
    fn get(&self, owner: &str, generation: u64, id: &str) -> Result<Arc<Job>, DeckError> {
        let jobs = self.jobs.lock().map_err(|_| failure())?;
        let job = jobs.get(id).ok_or_else(|| {
            DeckError::new(
                ErrorCode::NotFound,
                "이전 다운로드 상태가 만료됐어요. 새 작업을 시작해 주세요.",
            )
        })?;
        if job.owner != owner || job.generation != generation {
            return Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "이 도구 연결에서 사용할 수 없는 다운로드예요.",
            ));
        }
        Ok(job.clone())
    }
    fn cancel(&self, owner: &str, generation: u64, id: &str) -> Result<bool, DeckError> {
        let job = self.get(owner, generation, id)?;
        let status = job.status.lock().map_err(|_| failure())?;
        if terminal(status.stage) {
            return Ok(false);
        }
        job.cancel.store(true, Ordering::Release);
        Ok(true)
    }
    fn unload(&self, owner: &str) {
        if let Ok(mut jobs) = self.jobs.lock() {
            jobs.retain(|_, job| {
                if job.owner == owner {
                    job.cancel.store(true, Ordering::Release);
                    job.status
                        .lock()
                        .map(|status| !terminal(status.stage))
                        .unwrap_or(true)
                } else {
                    true
                }
            });
        }
    }
}
/// Removing an iframe revokes its job and stops only its owned helper process tree.
pub fn cancel_owner(app: &AppHandle, owner: &str) {
    if let Some(service) = app.try_state::<MediaDownloadService>() {
        service.unload(owner);
    }
}
fn authorize(state: &AppState, owner: &str, expected: Option<u64>) -> Result<u64, DeckError> {
    let generation = state
        .transfers
        .lock()
        .map_err(|_| failure())?
        .generation(owner);
    if expected.is_some_and(|g| g != generation) {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "도구 연결이 바뀌었어요. 다시 시작해 주세요.",
        ));
    }
    let modules = state.modules.read().map_err(|_| failure())?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "media-download", "start")?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "fs", "beginWrite")?;
    Ok(generation)
}
/// Dispatch fixed queued operations without keeping a long bridge request open.
pub async fn call(
    app: &AppHandle,
    state: &AppState,
    owner: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    let generation = authorize(state, owner, None)?;
    let service = app.state::<MediaDownloadService>();
    match op {
        Op::Start => {
            let args: MediaDownloadStartArgs = parse_args(args)?;
            let id = youtube_video_id(&args.url)?;
            let parent = super::fs::resolve(
                state,
                owner,
                &args.folder_handle,
                generation,
                Some(FileHandleKind::OutputParent),
            )?;
            let parent_guard = DirectoryGuard::open(&parent)?;
            let (handle, job) = service.begin(owner, generation)?;
            let app = app.clone();
            let owner = owner.to_owned();
            let job_for_thread = job.clone();
            if std::thread::Builder::new()
                .name("deck-media".into())
                .spawn(move || {
                    let result = execute(
                        &app,
                        &owner,
                        generation,
                        &id,
                        &parent,
                        &parent_guard,
                        &job_for_thread,
                    );
                    if let Err(error) = result
                        && let Ok(mut status) = job_for_thread.status.lock()
                        && !terminal(status.stage)
                    {
                        status.stage = if error.code == ErrorCode::Cancelled {
                            MediaDownloadStage::Cancelled
                        } else {
                            MediaDownloadStage::Failed
                        };
                        status.error = Some(error);
                    }
                })
                .is_err()
            {
                job.cancel.store(true, Ordering::Release);
                let mut status = job.status.lock().map_err(|_| failure())?;
                status.stage = MediaDownloadStage::Failed;
                status.error = Some(failure());
                return Err(failure());
            }
            to_value(&MediaDownloadJob { job_handle: handle })
        }
        Op::Status => {
            let args: MediaDownloadJob = parse_args(args)?;
            let job = service.get(owner, generation, &args.job_handle)?;
            to_value(&job.status.lock().map_err(|_| failure())?.clone())
        }
        Op::Cancel => {
            let args: MediaDownloadJob = parse_args(args)?;
            to_value(&MediaDownloadCancelResult {
                requested: service.cancel(owner, generation, &args.job_handle)?,
            })
        }
    }
}
fn set_stage(job: &Job, stage: MediaDownloadStage) {
    if let Ok(mut status) = job.status.lock() {
        status.stage = stage;
        status.downloaded_bytes = 0;
        status.total_bytes = None;
    }
}
fn progress(job: &Job, count: u64, total: Option<u64>) {
    if let Ok(mut status) = job.status.lock() {
        status.downloaded_bytes = count;
        status.total_bytes = total;
    }
}
fn cache_directory(
    app: &AppHandle,
    engine: crate::media_worker::Engine,
) -> Result<(PathBuf, DirectoryGuard), DeckError> {
    let root = app.path().app_cache_dir().map_err(|_| failure())?;
    // The application's cache root is provisioned by the shell before native work.
    let root_guard = DirectoryGuard::open(&root)?;
    let directory = root.join(engine.cache_name());
    match std::fs::create_dir(&directory) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(failure()),
    }
    root_guard.validate()?;
    let guard = DirectoryGuard::open(&directory)?;
    Ok((directory, guard))
}
fn execute(
    app: &AppHandle,
    owner: &str,
    generation: u64,
    id: &str,
    parent: &Path,
    parent_guard: &DirectoryGuard,
    job: &Job,
) -> Result<(), DeckError> {
    let started = job.created;
    let state = app.state::<AppState>();
    authorize(&state, owner, Some(generation))?;
    check(&job.cancel, started)?;
    let resource = app
        .path()
        .resource_dir()
        .map_err(|_| failure())?
        .join("native/coolreserve");
    let package = crate::messaging_worker::PackageLease::open(&resource)?;
    check(&job.cancel, started)?;
    let temp = state
        .temp
        .as_ref()
        .ok_or_else(failure)?
        .create_dir(&mut crate::platform::OsRng)
        .map_err(|_| failure())?;
    let temp_guard = DirectoryGuard::open(temp.path())?;
    let (entry, _engine_locks) = crate::media_worker::prepare(temp.path())?;
    let (cache, _cache_guard) = cache_directory(app, crate::media_worker::Engine::Deno)?;
    let _runtime_lock = crate::media_worker::provision(
        &package,
        &entry,
        temp.path(),
        &cache,
        crate::media_worker::Engine::Deno,
        (&job.cancel, started),
        &mut |n, t| progress(job, n, t),
    )?;
    let (ffmpeg_cache, _ffmpeg_cache_guard) =
        cache_directory(app, crate::media_worker::Engine::Ffmpeg)?;
    let _ffmpeg_lock = crate::media_worker::provision(
        &package,
        &entry,
        temp.path(),
        &ffmpeg_cache,
        crate::media_worker::Engine::Ffmpeg,
        (&job.cancel, started),
        &mut |n, t| progress(job, n, t),
    )?;
    check(&job.cancel, started)?;
    authorize(&state, owner, Some(generation))?;
    set_stage(job, MediaDownloadStage::Downloading);
    let input_size = crate::media_worker::download(
        &package,
        &entry,
        temp.path(),
        &cache.join("deno.exe"),
        id,
        (&job.cancel, started),
        &mut |n, t| progress(job, n, t),
    )?;
    let size = crate::media_worker::mux(
        &ffmpeg_cache.join("ffmpeg.exe"),
        temp.path(),
        input_size,
        (&job.cancel, started),
    )?;
    check(&job.cancel, started)?;
    set_stage(job, MediaDownloadStage::Validating);
    temp_guard.validate()?;
    let mut source = FileReadSession::open(&temp.path().join("video.mp4"))?;
    if source.size() != size || size == 0 || size > MAX_DOWNLOAD_BYTES {
        return Err(failure());
    }
    crate::media_mp4::validate(&mut source)?;
    check(&job.cancel, started)?;
    authorize(&state, owner, Some(generation))?;
    parent_guard.validate()?;
    let (batch, _folder) = state
        .transfers
        .lock()
        .map_err(|_| failure())?
        .create_output(owner, generation, parent, "영상 다운로드")?;
    let result = publish(&state, owner, generation, &batch, &mut source, job, started);
    if let Ok(mut transfers) = state.transfers.lock() {
        let _ = transfers.close_output(owner, generation, &batch);
    }
    result
}
fn publish(
    state: &AppState,
    owner: &str,
    generation: u64,
    batch: &str,
    source: &mut FileReadSession,
    job: &Job,
    started: Instant,
) -> Result<(), DeckError> {
    let write = state.transfers.lock().map_err(|_| failure())?.begin_write(
        owner,
        generation,
        batch,
        "video.mp4",
        source.size(),
        state.file_temp.as_ref().ok_or_else(failure)?,
    )?;
    let publication = (|| {
        let mut offset = 0;
        while offset < source.size() {
            check(&job.cancel, started)?;
            authorize(state, owner, Some(generation))?;
            let length =
                usize::try_from((source.size() - offset).min(65536)).map_err(|_| failure())?;
            let bytes = source.read_chunk(offset, length)?;
            offset = state.transfers.lock().map_err(|_| failure())?.write(
                owner,
                generation,
                &write.write_id,
                offset,
                &bytes,
            )?;
        }
        // Cancellation and successful publication serialize on this status lock.
        let mut status = job.status.lock().map_err(|_| failure())?;
        check(&job.cancel, started)?;
        authorize(state, owner, Some(generation))?;
        // Acquire the infallible handle table before the publication point. Metadata refresh
        // after commit is optional: a deleted/unavailable file must not turn a saved result
        // into a failed download that invites a duplicate retry.
        // Match fs::issue_dropped's transfers -> handles order to avoid cross-thread ABBA.
        let mut transfers = state.transfers.lock().map_err(|_| failure())?;
        let mut handles = state.handles.lock().map_err(|_| failure())?;
        let path = transfers.commit(owner, generation, &write.write_id)?;
        let handle = handles.issue(
            owner,
            crate::state::FileHandleTarget {
                path: path.clone(),
                kind: FileHandleKind::ReadFile,
                generation,
            },
        );
        let file = published_file(handle, &path, source.size());
        status.stage = MediaDownloadStage::Complete;
        status.downloaded_bytes = source.size();
        status.total_bytes = Some(source.size());
        status.file = Some(file);
        Ok(())
    })();
    if publication.is_err()
        && let Ok(mut transfers) = state.transfers.lock()
    {
        let _ = transfers.abort(owner, generation, &write.write_id);
    }
    publication
}
fn published_file(handle: String, path: &Path, size: u64) -> deck_core::caps::fs::FileHandleInfo {
    let modified_at = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0);
    deck_core::caps::fs::FileHandleInfo {
        handle,
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "video.mp4".into()),
        ext: "mp4".into(),
        size,
        modified_at,
    }
}

/// Development-only explicit public-film proof using the exact production worker and fs journal.
/// This is not a bridge method and does not open any user document or native UI.
#[cfg(debug_assertions)]
pub fn synthetic_proof(workspace: &Path) -> Result<Value, DeckError> {
    let started = Instant::now();
    let review = workspace.join("target/media-review");
    let _review_guard = DirectoryGuard::open(&review)?;
    let proof = review.join("native-proof");
    match std::fs::create_dir(&proof) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(failure()),
    }
    let _proof_guard = DirectoryGuard::open(&proof)?;
    let temp_area =
        crate::platform::TempArea::init_preserving(proof.join("tmp")).map_err(|_| failure())?;
    let temp = temp_area
        .create_dir(&mut crate::platform::OsRng)
        .map_err(|_| failure())?;
    let (entry, _locks) = crate::media_worker::prepare(temp.path())?;
    let package = crate::messaging_worker::PackageLease::open(
        &workspace.join("apps/desktop/src-tauri/resources/native/coolreserve"),
    )?;
    let cancel = AtomicBool::new(false);
    let mut leases = vec![];
    let mut executables = vec![];
    for engine in [
        crate::media_worker::Engine::Deno,
        crate::media_worker::Engine::Ffmpeg,
    ] {
        let cache = proof.join(engine.cache_name());
        match std::fs::create_dir(&cache) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(failure()),
        }
        leases.push(crate::media_worker::provision(
            &package,
            &entry,
            temp.path(),
            &cache,
            engine,
            (&cancel, started),
            &mut |_, _| {},
        )?);
        executables.push(cache.join(engine.executable()));
    }
    let preparation_ms = started.elapsed().as_millis();
    let inputs = crate::media_worker::download(
        &package,
        &entry,
        temp.path(),
        executables.first().ok_or_else(failure)?,
        "aqz-KE-bpKQ",
        (&cancel, started),
        &mut |_, _| {},
    )?;
    let download_ms = started.elapsed().as_millis() - preparation_ms;
    let size = crate::media_worker::mux(
        executables.get(1).ok_or_else(failure)?,
        temp.path(),
        inputs,
        (&cancel, started),
    )?;
    let mut source = FileReadSession::open(&temp.path().join("video.mp4"))?;
    crate::media_mp4::validate(&mut source)?;
    let expected = crate::messaging_worker::hash_file(&mut source)?;
    let original = proof.join("synthetic-original.txt");
    match std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&original)
    {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(b"synthetic-preserved")
                .map_err(|_| failure())?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(failure()),
    }
    let mut original_lock = FileReadSession::open(&original)?;
    let original_hash = crate::messaging_worker::hash_file(&mut original_lock)?;
    let output_temp = crate::platform::TempArea::init_preserving(proof.join("file-tmp"))
        .map_err(|_| failure())?;
    let mut transfers = crate::file_transfer::FileTransfers::default();
    let (batch, _) = transfers.create_output("synthetic-media", 0, &proof, "synthetic-output")?;
    let mut output_paths = vec![];
    for _ in 0..2 {
        let write = transfers.begin_write(
            "synthetic-media",
            0,
            &batch,
            "video.mp4",
            size,
            &output_temp,
        )?;
        let mut offset = 0;
        while offset < size {
            let bytes = source.read_chunk(
                offset,
                usize::try_from((size - offset).min(65536)).map_err(|_| failure())?,
            )?;
            offset = transfers.write("synthetic-media", 0, &write.write_id, offset, &bytes)?;
        }
        output_paths.push(transfers.commit("synthetic-media", 0, &write.write_id)?);
    }
    transfers.close_output("synthetic-media", 0, &batch)?;
    if output_paths.first() == output_paths.get(1) {
        return Err(failure());
    }
    for path in &output_paths {
        let mut output = FileReadSession::open(path)?;
        crate::media_mp4::validate(&mut output)?;
        if crate::messaging_worker::hash_file(&mut output)? != expected {
            return Err(failure());
        }
    }
    if crate::messaging_worker::hash_file(&mut original_lock)? != original_hash {
        return Err(failure());
    }
    let (cancellation_verified, timeout_verified) = crate::media_worker::synthetic_stop_proofs(
        &package,
        &temp_area,
        executables.first().ok_or_else(failure)?,
    )?;
    let proof_ms = started.elapsed().as_millis();
    drop(source);
    drop(leases);
    drop(_locks);
    drop(temp);
    let staging_clean = std::fs::read_dir(temp_area.root())
        .map_err(|_| failure())?
        .next()
        .is_none();
    Ok(
        serde_json::json!({"passed":staging_clean,"preparationMs":preparation_ms,"downloadMs":download_ms,"totalMs":proof_ms,"inputBytes":inputs,"outputBytes":size,"sha256":expected,"combinedVideoAudio":true,"appendNewCopies":2,"sameNameDistinct":true,"originalPreserved":true,"stagingClean":staging_clean,"cancellationVerified":cancellation_verified,"timeoutVerified":timeout_verified,"nativeFolderPickerTested":false}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jobs_are_owner_generation_bound_and_terminal_snapshots_survive() {
        let service = MediaDownloadService::default();
        let (id, job) = service.begin("sample-a", 0).unwrap();
        assert!(service.get("sample-b", 0, &id).is_err());
        assert!(service.get("sample-a", 1, &id).is_err());
        assert!(service.begin("sample-a", 0).is_err());
        assert!(service.cancel("sample-a", 0, &id).unwrap());
        job.status.lock().unwrap().stage = MediaDownloadStage::Complete;
        assert!(!service.cancel("sample-a", 0, &id).unwrap());
        assert!(service.get("sample-a", 0, &id).is_ok());
        service.unload("sample-b");
        assert!(service.get("sample-a", 0, &id).is_ok());
        service.unload("sample-a");
        assert!(service.get("sample-a", 0, &id).is_err());
    }
    #[test]
    fn unloaded_active_worker_keeps_global_slot_until_cleanup_finishes() {
        let service = MediaDownloadService::default();
        let (_, job) = service.begin("sample-a", 0).unwrap();
        service.unload("sample-a");
        assert!(job.cancel.load(Ordering::Acquire));
        assert_eq!(
            service.begin("sample-b", 0).err().unwrap().code,
            ErrorCode::Busy
        );
        job.status.lock().unwrap().stage = MediaDownloadStage::Cancelled;
        assert!(service.begin("sample-b", 0).is_ok());
    }
    #[test]
    fn fixed_routes_only() {
        assert_eq!(Op::parse("start"), Some(Op::Start));
        assert_eq!(Op::parse("run"), None);
    }
    #[test]
    fn committed_result_survives_optional_metadata_refresh_failure() {
        let info = published_file(
            "opaque-result".into(),
            Path::new("missing-synthetic-directory/video.mp4"),
            123,
        );
        assert_eq!(info.handle, "opaque-result");
        assert_eq!(info.size, 123);
        assert_eq!(info.modified_at, 0);
        assert_eq!(info.ext, "mp4");
    }
    #[test]
    fn terminal_history_evicts_oldest_after_32_without_touching_results() {
        let service = MediaDownloadService::default();
        let mut ids = vec![];
        for _ in 0..33 {
            let (id, job) = service.begin("sample-a", 0).unwrap();
            assert!(service.begin("sample-a", 0).is_err());
            job.status.lock().unwrap().stage = MediaDownloadStage::Complete;
            ids.push(id);
        }
        assert_eq!(service.jobs.lock().unwrap().len(), 32);
        assert_eq!(
            service.get("sample-a", 0, &ids[0]).err().unwrap().code,
            ErrorCode::NotFound
        );
        assert!(service.get("sample-a", 0, &ids[32]).is_ok());
        // The history contains status objects only: it never revokes fs handles or deletes files.
    }
}
