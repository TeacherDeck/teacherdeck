// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Fixed isolated Python worker, pinned engines and bounded privacy-safe frames (ADR-0028).
use crate::file_read::{DirectoryGuard, FileReadSession};
use crate::messaging_worker::{PackageLease, hash_file};
use deck_core::caps::media_download::{DOWNLOAD_TIMEOUT_SECONDS, MAX_DOWNLOAD_BYTES};
use deck_core::{DeckError, ErrorCode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub(crate) const DENO_HASH: &str =
    "e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33";
#[derive(Clone, Copy)]
pub(crate) enum Engine {
    Deno,
    Ffmpeg,
}
impl Engine {
    pub(crate) fn cache_name(self) -> &'static str {
        match self {
            Self::Deno => "media-deno-2.9.7",
            Self::Ffmpeg => "media-ffmpeg-9.0.2",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Deno => "deno",
            Self::Ffmpeg => "ffmpeg",
        }
    }
    pub(crate) fn executable(self) -> &'static str {
        match self {
            Self::Deno => "deno.exe",
            Self::Ffmpeg => "ffmpeg.exe",
        }
    }
    fn zip_size(self) -> u64 {
        match self {
            Self::Deno => 42630221,
            Self::Ffmpeg => 114768076,
        }
    }
    fn size(self) -> u64 {
        match self {
            Self::Deno => 97462048,
            Self::Ffmpeg => 105423872,
        }
    }
    fn hash(self) -> &'static str {
        match self {
            Self::Deno => DENO_HASH,
            Self::Ffmpeg => "3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec",
        }
    }
}
const ENGINE: &[u8] = include_bytes!("../../../../tools/media/media_worker.py");
const WHEELS: &[(&str, &[u8])] = &[
    (
        "yt_dlp-2026.8.19-py3-none-any.whl",
        include_bytes!("../../../../vendor/media/yt_dlp-2026.8.19-py3-none-any.whl"),
    ),
    (
        "yt_dlp_ejs-0.8.0-py3-none-any.whl",
        include_bytes!("../../../../vendor/media/yt_dlp_ejs-0.8.0-py3-none-any.whl"),
    ),
];
const DENO_NOTICES: &[(&str, &[u8])] = &[
    (
        "LICENSE.txt",
        include_bytes!("../../../../vendor/media/DENO-LICENSE.txt"),
    ),
    (
        "THIRD-PARTY-NOTICES.txt",
        include_bytes!("../../../../vendor/media/DENO-THIRD-PARTY-NOTICES.txt"),
    ),
    (
        "SOURCES.md",
        include_bytes!("../../../../vendor/media/DENO-THIRD-PARTY-SOURCES.md"),
    ),
];
const FFMPEG_NOTICES: &[(&str, &[u8])] = &[
    (
        "LICENSE.txt",
        include_bytes!("../../../../vendor/media/FFMPEG-LICENSE.txt"),
    ),
    (
        "UPSTREAM-README.txt",
        include_bytes!("../../../../vendor/media/FFMPEG-UPSTREAM-README.txt"),
    ),
    (
        "SOURCES.md",
        include_bytes!("../../../../vendor/media/FFMPEG-SOURCES.md"),
    ),
];
pub(crate) struct RuntimeLease {
    _executable: FileReadSession,
    _notices: Vec<FileReadSession>,
}
fn notices(cache: &Path, engine: Engine) -> Result<Vec<FileReadSession>, DeckError> {
    let entries = match engine {
        Engine::Deno => DENO_NOTICES,
        Engine::Ffmpeg => FFMPEG_NOTICES,
    };
    let mut result = vec![];
    for (name, bytes) in entries {
        let path = cache.join(name);
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .and_then(|_| file.sync_all())
                    .map_err(|_| failure())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(failure()),
        }
        let mut file = FileReadSession::open(&path)?;
        if file.size() != bytes.len() as u64
            || file.read_chunk(0, bytes.len())?.as_slice() != *bytes
        {
            return Err(failure());
        }
        result.push(file);
    }
    Ok(result)
}

pub(crate) fn failure() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "영상을 받지 못했어요. 공개 영상인지와 인터넷 연결을 확인해 주세요. 지원하는 MP4 형식이 없는 영상은 받을 수 없어요.",
    )
}
pub(crate) fn check(cancel: &AtomicBool, started: Instant) -> Result<(), DeckError> {
    if cancel.load(Ordering::Acquire) {
        return Err(DeckError::new(
            ErrorCode::Cancelled,
            "다운로드를 중지했어요.",
        ));
    }
    if started.elapsed() >= Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS) {
        return Err(DeckError::new(
            ErrorCode::Timeout,
            "다운로드 제한 시간이 지났어요. 인터넷 연결을 확인하고 다시 시작해 주세요.",
        ));
    }
    Ok(())
}
#[derive(Debug, Deserialize)]
#[serde(tag = "event", deny_unknown_fields)]
enum Event {
    #[serde(rename = "progress")]
    Progress { downloaded: u64, total: Option<u64> },
    #[serde(rename = "runtime-progress")]
    RuntimeProgress { downloaded: u64, total: u64 },
    #[serde(rename = "runtime-ready")]
    RuntimeReady { sha256: String, size: u64 },
    #[serde(rename = "done")]
    Done { size: u64 },
    #[serde(rename = "error")]
    Error { code: SafeCode },
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum SafeCode {
    InvalidRequest,
    RuntimeIntegrity,
    RestrictedVideo,
    CombinedFormatUnavailable,
    SizeLimit,
    ProviderFailed,
    AuthenticationRequired,
    NetworkCertificate,
    NetworkUnavailable,
}

fn frame(reader: &mut impl BufRead) -> Result<Option<Event>, DeckError> {
    let mut line = vec![];
    loop {
        let buffer = reader.fill_buf().map_err(|_| failure())?;
        if buffer.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(failure())
            };
        }
        let length = buffer
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buffer.len(), |i| i + 1);
        if line.len() + length > 4096 {
            return Err(failure());
        }
        line.extend_from_slice(buffer.get(..length).ok_or_else(failure)?);
        let complete = line.last() == Some(&b'\n');
        reader.consume(length);
        if complete {
            return serde_json::from_slice(&line)
                .map(Some)
                .map_err(|_| failure());
        }
    }
}
struct OwnedWorker {
    child: Child,
    #[cfg(windows)]
    group: Option<crate::native_workers::OfficeProcessGroup>,
}
impl Drop for OwnedWorker {
    fn drop(&mut self) {
        #[cfg(windows)]
        drop(self.group.take()); // Kill only this assigned child and its descendants.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn run(
    python: &Path,
    entry: &Path,
    directory: &Path,
    request: serde_json::Value,
    control: (&AtomicBool, Instant),
    provisioning: Option<Engine>,
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<u64, DeckError> {
    let (cancel, started) = control;
    check(cancel, started)?;
    let mut command = Command::new(python);
    command
        .args(["-I", "-S", "-B"])
        .arg(entry)
        .current_dir(directory)
        .env_clear()
        .env("DENO_NO_UPDATE_CHECK", "1")
        .env("NO_COLOR", "1")
        .env("DENO_DIR", directory.join("deno-cache"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for key in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(windows)]
    let group = crate::native_workers::OfficeProcessGroup::new().map_err(|_| failure())?;
    let child = command.spawn().map_err(|_| failure())?;
    let mut owned = OwnedWorker {
        child,
        #[cfg(windows)]
        group: Some(group),
    };
    #[cfg(windows)]
    owned
        .group
        .as_ref()
        .ok_or_else(failure)?
        .assign_child(&owned.child)
        .map_err(|_| failure())?;
    // The fixed helper blocks reading stdin until its entire process tree is owned.
    let bytes = serde_json::to_vec(&request).map_err(|_| failure())?;
    if bytes.len() > 8192 {
        return Err(failure());
    }
    owned
        .child
        .stdin
        .take()
        .ok_or_else(failure)?
        .write_all(&bytes)
        .map_err(|_| failure())?;
    let output = owned.child.stdout.take().ok_or_else(failure)?;
    let (sender, receiver) = mpsc::sync_channel(16);
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        loop {
            let event = frame(&mut reader);
            let end = !matches!(event, Ok(Some(_)));
            if sender.send(event).is_err() || end {
                break;
            }
        }
    });
    let result = (|| {
        let mut complete = None;
        let mut last = 0;
        loop {
            check(cancel, started)?;
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(Some(event))) => {
                    if complete.is_some() {
                        return Err(failure());
                    }
                    match event {
                        Event::Progress { downloaded, total } if provisioning.is_none() => {
                            validate_progress(downloaded, total, last, MAX_DOWNLOAD_BYTES)?;
                            last = downloaded;
                            progress(downloaded, total);
                        }
                        Event::RuntimeProgress { downloaded, total }
                            if provisioning.is_some_and(|engine| total == engine.zip_size()) =>
                        {
                            validate_progress(downloaded, Some(total), last, total)?;
                            last = downloaded;
                            progress(downloaded, Some(total));
                        }
                        Event::RuntimeReady { sha256, size }
                            if provisioning.is_some_and(|engine| {
                                sha256 == engine.hash() && size == engine.size()
                            }) =>
                        {
                            complete = Some(size);
                        }
                        Event::Done { size }
                            if provisioning.is_none()
                                && size > 0
                                && size <= MAX_DOWNLOAD_BYTES
                                && size >= last =>
                        {
                            complete = Some(size);
                        }
                        Event::Error {
                            code: SafeCode::SizeLimit,
                        } => {
                            return Err(DeckError::new(
                                ErrorCode::InvalidArgs,
                                "영상 크기가 512MiB를 넘어요. 더 작은 영상을 선택해 주세요.",
                            ));
                        }
                        Event::Error {
                            code: SafeCode::AuthenticationRequired,
                        } => {
                            return Err(DeckError::new(
                                ErrorCode::CapabilityUnavailable,
                                "이 영상은 YouTube가 로그인이나 접근 확인을 요구하고 있어요. 로그인·쿠키 연동은 지원하지 않으니 다른 공개 영상을 선택해 주세요.",
                            ));
                        }
                        Event::Error {
                            code: SafeCode::NetworkCertificate,
                        } => {
                            return Err(DeckError::new(
                                ErrorCode::CapabilityUnavailable,
                                "인터넷 보안 인증서를 확인하지 못했어요. PC 날짜와 학교망 연결 상태를 확인해 주세요.",
                            ));
                        }
                        Event::Error {
                            code: SafeCode::NetworkUnavailable,
                        } => {
                            return Err(DeckError::new(
                                ErrorCode::CapabilityUnavailable,
                                "YouTube에 연결하지 못했어요. 인터넷 연결이나 학교망 차단 여부를 확인해 주세요.",
                            ));
                        }
                        Event::Error {
                            code: SafeCode::CombinedFormatUnavailable,
                        } => {
                            return Err(DeckError::new(
                                ErrorCode::CapabilityUnavailable,
                                "이 영상에는 지원하는 MP4 영상·음성 형식이 없어요. 다른 공개 영상을 선택해 주세요.",
                            ));
                        }
                        Event::Error { code } => {
                            let _fixed_code = code;
                            return Err(failure());
                        }
                        _ => return Err(failure()),
                    }
                }
                Ok(Ok(None)) => {
                    // EOF alone cannot mark success; poll the exact child under the same deadline.
                    loop {
                        check(cancel, started)?;
                        if let Some(status) = owned.child.try_wait().map_err(|_| failure())? {
                            return if status.success() {
                                complete.ok_or_else(failure)
                            } else {
                                Err(failure())
                            };
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                }
                Ok(Err(error)) => return Err(error),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return Err(failure()),
            }
        }
    })();
    drop(receiver); // Unblock a bounded sender before owned process cleanup.
    drop(owned);
    let _ = reader.join();
    result
}
fn write_new(path: &Path, bytes: &[u8]) -> Result<(), DeckError> {
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|_| failure())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| failure())
}
/// Prepare the pinned helper in an app-owned isolated directory and retain its read locks.
pub(crate) fn prepare(directory: &Path) -> Result<(PathBuf, Vec<FileReadSession>), DeckError> {
    let entry = directory.join("media_worker.py");
    write_new(&entry, ENGINE)?;
    let mut locks = vec![verified_asset(&entry, ENGINE)?];
    for (name, bytes) in WHEELS {
        let path = directory.join(name);
        write_new(&path, bytes)?;
        locks.push(verified_asset(&path, bytes)?);
    }
    Ok((entry, locks))
}
fn verified_asset(path: &Path, expected: &[u8]) -> Result<FileReadSession, DeckError> {
    let mut file = FileReadSession::open(path)?;
    if file.size() != expected.len() as u64
        || hash_file(&mut file)? != deck_core::util::to_hex(&Sha256::digest(expected))
    {
        return Err(failure());
    }
    Ok(file)
}
/// Verify any cached executable before running it and retain the read lock across execution.
pub(crate) fn runtime_lock(path: &Path, engine: Engine) -> Result<FileReadSession, DeckError> {
    let mut file = FileReadSession::open(path)?;
    if file.size() != engine.size() || hash_file(&mut file)? != engine.hash() {
        return Err(failure());
    }
    Ok(file)
}
/// First-use provisioning writes only a new private file; no existing cache file is replaced.
pub(crate) fn provision(
    package: &PackageLease,
    entry: &Path,
    directory: &Path,
    cache: &Path,
    engine: Engine,
    control: (&AtomicBool, Instant),
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<RuntimeLease, DeckError> {
    let (cancel, started) = control;
    let cache_guard = DirectoryGuard::open(cache)?;
    let destination = cache.join(engine.executable());
    if std::fs::symlink_metadata(&destination).is_ok() {
        return Ok(RuntimeLease {
            _executable: runtime_lock(&destination, engine)?,
            _notices: notices(cache, engine)?,
        });
    }
    run(
        package.python(),
        entry,
        directory,
        serde_json::json!({"mode":"provision", "directory":directory, "engine":engine.name()}),
        (cancel, started),
        Some(engine),
        progress,
    )?;
    let source = directory.join(engine.executable());
    let mut verified = runtime_lock(&source, engine)?;
    check(cancel, started)?;
    cache_guard.validate()?;
    // A hard link atomically publishes a complete verified cache file without replacement.
    // Temp cleanup removes only the app-owned staging link; the pinned cache link remains.
    match std::fs::hard_link(&source, &destination) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(failure()),
    }
    if hash_file(&mut verified)? != engine.hash() {
        return Err(failure());
    }
    Ok(RuntimeLease {
        _executable: runtime_lock(&destination, engine)?,
        _notices: notices(cache, engine)?,
    })
}
pub(crate) fn download(
    package: &PackageLease,
    entry: &Path,
    directory: &Path,
    deno: &Path,
    id: &str,
    control: (&AtomicBool, Instant),
    progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<u64, DeckError> {
    let (cancel, started) = control;
    run(
        package.python(),
        entry,
        directory,
        serde_json::json!({"mode":"download", "videoId":id,"directory":directory,"deno":deno}),
        (cancel, started),
        None,
        progress,
    )
}
fn mux_command(executable: &Path, directory: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .current_dir(directory)
        .env_clear()
        .args(["-nostdin", "-nostats", "-v", "error", "-n", "-threads", "1"])
        .args(["-protocol_whitelist", "file,pipe", "-i"])
        .arg(directory.join("video-only.mp4"))
        .args(["-protocol_whitelist", "file,pipe", "-i"])
        .arg(directory.join("audio-only.m4a"))
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-c",
            "copy",
            "-f",
            "mp4",
        ])
        .arg(directory.join("video.mp4"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    for key in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
/// Mux only fixed private local inputs. Every FFmpeg input has an explicit local protocol list.
pub(crate) fn mux(
    executable: &Path,
    directory: &Path,
    input_size: u64,
    control: (&AtomicBool, Instant),
) -> Result<u64, DeckError> {
    let (cancel, started) = control;
    check(cancel, started)?;
    let combined = directory.join("video.mp4");
    if std::fs::symlink_metadata(&combined).is_ok() {
        let mut file = FileReadSession::open(&combined)?;
        if file.size() == 0 || file.size() != input_size || input_size > MAX_DOWNLOAD_BYTES {
            return Err(failure());
        }
        crate::media_mp4::validate(&mut file)?;
        return Ok(file.size());
    }
    let video = FileReadSession::open(&directory.join("video-only.mp4"))?;
    let audio = FileReadSession::open(&directory.join("audio-only.m4a"))?;
    if video.size() == 0
        || audio.size() == 0
        || video.size().checked_add(audio.size()) != Some(input_size)
        || input_size > MAX_DOWNLOAD_BYTES
    {
        return Err(failure());
    }
    let mut command = mux_command(executable, directory);
    #[cfg(windows)]
    let group = crate::native_workers::OfficeProcessGroup::new().map_err(|_| failure())?;
    let child = command.spawn().map_err(|_| failure())?;
    let mut owned = OwnedWorker {
        child,
        #[cfg(windows)]
        group: Some(group),
    };
    #[cfg(windows)]
    owned
        .group
        .as_ref()
        .ok_or_else(failure)?
        .assign_child(&owned.child)
        .map_err(|_| failure())?;
    let output = directory.join("video.mp4");
    loop {
        check(cancel, started)?;
        if std::fs::symlink_metadata(&output)
            .is_ok_and(|metadata| metadata.len() > MAX_DOWNLOAD_BYTES)
        {
            return Err(failure());
        }
        if let Some(status) = owned.child.try_wait().map_err(|_| failure())? {
            if !status.success() {
                return Err(failure());
            }
            let file = FileReadSession::open(&output)?;
            if file.size() == 0 || file.size() > MAX_DOWNLOAD_BYTES {
                return Err(failure());
            }
            return Ok(file.size());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
fn validate_progress(
    count: u64,
    total: Option<u64>,
    previous: u64,
    limit: u64,
) -> Result<(), DeckError> {
    if count < previous || count > limit || total.is_some_and(|t| t > limit || count > t) {
        return Err(failure());
    }
    Ok(())
}

#[cfg(debug_assertions)]
pub(crate) fn synthetic_stop_proofs(
    package: &PackageLease,
    area: &crate::platform::TempArea,
    deno: &Path,
) -> Result<(bool, bool), DeckError> {
    use std::sync::Arc;
    let mut cancellation_verified = false;
    let mut timeout_verified = false;
    for timeout in [false, true] {
        let temp = area
            .create_dir(&mut crate::platform::OsRng)
            .map_err(|_| failure())?;
        let (entry, locks) = prepare(temp.path())?;
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let timer = if timeout {
            None
        } else {
            Some(std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                flag.store(true, Ordering::Release);
            }))
        };
        let started = if timeout {
            Instant::now() - Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS - 1)
        } else {
            Instant::now()
        };
        let result = download(
            package,
            &entry,
            temp.path(),
            deno,
            "aqz-KE-bpKQ",
            (&cancel, started),
            &mut |_, _| {},
        );
        if let Some(timer) = timer {
            timer.join().map_err(|_| failure())?;
        }
        let error = result.err().ok_or_else(failure)?;
        if error.code
            != if timeout {
                ErrorCode::Timeout
            } else {
                ErrorCode::Cancelled
            }
        {
            return Err(failure());
        }
        if timeout {
            timeout_verified = true;
        } else {
            cancellation_verified = true;
        }
        drop(locks);
        drop(temp);
    }
    Ok((cancellation_verified, timeout_verified))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frame_rejects_provider_text_oversize_unknown_and_truncation() {
        for input in [
            b"provider path\n".to_vec(),
            b"{\"event\":\"done\",\"size\":1,\"url\":\"private\"}\n".to_vec(),
            b"{\"event\":\"done\",\"size\":1}".to_vec(),
            vec![b'a'; 4097],
        ] {
            assert!(frame(&mut std::io::Cursor::new(input)).is_err());
        }
        assert!(matches!(
            frame(&mut std::io::Cursor::new(
                b"{\"event\":\"done\",\"size\":1}\n"
            ))
            .unwrap(),
            Some(Event::Done { size: 1 })
        ));
    }
    #[test]
    fn byte_progress_cannot_regress_overflow_or_exceed_total() {
        assert!(validate_progress(16, Some(20), 8, 32).is_ok());
        for (count, total, last) in [
            (7, Some(20), 8),
            (33, None, 0),
            (20, Some(19), 0),
            (0, Some(33), 0),
        ] {
            assert!(validate_progress(count, total, last, 32).is_err());
        }
    }
    #[test]
    fn cancel_and_deadline_are_bounded() {
        assert_eq!(
            check(&AtomicBool::new(true), Instant::now())
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
        assert_eq!(
            check(
                &AtomicBool::new(false),
                Instant::now() - Duration::from_secs(1801)
            )
            .unwrap_err()
            .code,
            ErrorCode::Timeout
        );
    }
    #[test]
    fn executable_read_lock_also_checks_expected_content_after_materialization() {
        let mut token = [0; 16];
        getrandom::fill(&mut token).unwrap();
        let root = std::env::temp_dir().join(format!(
            "deck-media-asset-{}",
            deck_core::util::to_hex(&token)
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("synthetic.py");
        std::fs::write(&path, b"synthetic-original").unwrap();
        assert!(verified_asset(&path, b"synthetic-original").is_ok());
        std::fs::write(&path, b"synthetic-replaced").unwrap();
        assert!(verified_asset(&path, b"synthetic-original").is_err());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn mux_has_fixed_local_only_arguments_and_no_shell_or_network_input() {
        let command = mux_command(
            Path::new("fixed-ffmpeg.exe"),
            Path::new("synthetic-staging"),
        );
        let args: Vec<_> = command
            .get_args()
            .map(|s| s.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.iter().filter(|s| s.as_str() == "file,pipe").count(), 2);
        assert_eq!(args.iter().filter(|s| s.as_str() == "-i").count(), 2);
        assert!(args.iter().any(|s| s.ends_with("video-only.mp4")));
        assert!(args.iter().any(|s| s.ends_with("audio-only.m4a")));
        assert!(
            !args
                .iter()
                .any(|s| s.contains("https:") || s == "-y" || s == "-enable_drefs")
        );
        assert!(args.windows(2).any(|pair| pair == ["-c", "copy"]));
    }
    #[cfg(windows)]
    #[test]
    fn fixed_python_helper_synthetic_regressions_run_in_host_suite() {
        let host = Path::new(env!("CARGO_MANIFEST_DIR"));
        let package = PackageLease::open(&host.join("resources/native/coolreserve")).unwrap();
        let root = host.join("../../..").canonicalize().unwrap();
        let mut token = [0; 16];
        getrandom::fill(&mut token).unwrap();
        let temp = std::env::temp_dir().join(format!(
            "deck-media-python-{}",
            deck_core::util::to_hex(&token)
        ));
        std::fs::create_dir(&temp).unwrap();
        let mut command = Command::new(package.python());
        command
            .args(["-I", "-S", "-B"])
            .arg(root.join("tools/media/test_media_worker.py"))
            .current_dir(&root)
            .env_clear()
            .env("TEMP", &temp)
            .env("TMP", &temp)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for key in ["SystemRoot", "WINDIR"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        let result = command.status();
        std::fs::remove_dir(&temp).unwrap();
        assert!(
            result.unwrap().success(),
            "fixed synthetic Python regressions failed"
        );
    }
}
