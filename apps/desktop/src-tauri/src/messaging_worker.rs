// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Fixed, hash-locked CoolReserve private worker. No caller-supplied commands or paths.
use crate::file_read::{DirectoryGuard, FileReadPool, FileReadSession, READ_CHUNK_BYTES};
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_LINE: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);
const RUNTIME_LOCK: &str = include_str!("../../../../tools/checks/coolreserve-runtime.allow.json");
const SOURCE_LOCK: &str = include_str!("../../../../tools/checks/coolreserve-source.allow.json");

#[derive(Deserialize)]
struct Manifest {
    files: Vec<LockedFile>,
}
#[derive(Deserialize)]
struct LockedFile {
    path: String,
    size: u64,
    sha256: String,
}

/// Retains every verified executable/module/library file until its child is gone.
pub struct PackageLease {
    _root: DirectoryGuard,
    _files: Vec<FileReadSession>,
    python: PathBuf,
    entry: PathBuf,
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "메신저 연동 파일을 확인하지 못했어요. 앱을 복구한 뒤 다시 연결해 주세요.",
    )
}
fn protocol() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "메신저 연동 응답을 확인하지 못했어요. 등록 결과를 직접 확인해 주세요.",
    )
}
fn read_frame(reader: &mut impl BufRead) -> Result<Vec<u8>, ()> {
    let mut line = Vec::new();
    std::io::Read::by_ref(reader)
        .take((MAX_LINE + 1) as u64)
        .read_until(b'\n', &mut line)
        .map_err(|_| ())?;
    if line.is_empty() || line.len() > MAX_LINE || line.last() != Some(&b'\n') {
        return Err(());
    }
    Ok(line)
}
fn relative(value: &str) -> Result<PathBuf, DeckError> {
    let p = PathBuf::from(value);
    if value.is_empty()
        || value.contains(['\\', ':'])
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || p.is_absolute()
        || p.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(unavailable());
    }
    Ok(p)
}
fn enumerate(root: &Path, at: &Path, result: &mut HashSet<String>) -> Result<(), DeckError> {
    for item in std::fs::read_dir(at).map_err(|_| unavailable())? {
        let path = item.map_err(|_| unavailable())?.path();
        let meta = std::fs::symlink_metadata(&path).map_err(|_| unavailable())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(unavailable());
            }
        }
        if meta.file_type().is_symlink() {
            return Err(unavailable());
        }
        if meta.is_dir() {
            enumerate(root, &path, result)?;
        } else if meta.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|_| unavailable())?
                .to_str()
                .ok_or_else(unavailable)?
                .replace('\\', "/");
            if !result.insert(rel) || result.len() > 4096 {
                return Err(unavailable());
            }
        } else {
            return Err(unavailable());
        }
    }
    Ok(())
}
fn verify_tree_with_pool(
    root: &Path,
    lock: &str,
    parents: &mut FileReadPool,
) -> Result<Vec<FileReadSession>, DeckError> {
    let manifest: Manifest = serde_json::from_str(lock).map_err(|_| unavailable())?;
    if manifest.files.is_empty() || manifest.files.len() > 4096 {
        return Err(unavailable());
    }
    let mut expected = HashSet::new();
    let mut files = Vec::with_capacity(manifest.files.len());
    for entry in manifest.files {
        let rel = relative(&entry.path)?;
        if !expected.insert(entry.path)
            || entry.size > 512 * 1024 * 1024
            || entry.sha256.len() != 64
        {
            return Err(unavailable());
        }
        let mut file = parents.open(&root.join(rel)).map_err(|_| unavailable())?;
        if file.size() != entry.size {
            return Err(unavailable());
        }
        if hash_file(&mut file).map_err(|_| unavailable())? != entry.sha256 {
            return Err(unavailable());
        }
        files.push(file);
    }
    let mut actual = HashSet::new();
    enumerate(root, root, &mut actual)?;
    if actual != expected {
        return Err(unavailable());
    }
    Ok(files)
}
#[cfg(test)]
fn verify_tree(root: &Path, lock: &str) -> Result<Vec<FileReadSession>, DeckError> {
    verify_tree_with_pool(root, lock, &mut FileReadPool::default())
}
/// Hash a retained readonly file without loading an entire attachment into memory.
pub fn hash_file(file: &mut FileReadSession) -> Result<String, DeckError> {
    let mut hash = Sha256::new();
    let mut offset = 0;
    while offset < file.size() {
        let length = usize::try_from((file.size() - offset).min(READ_CHUNK_BYTES as u64))
            .map_err(|_| protocol())?;
        let chunk = file.read_chunk(offset, length)?;
        if chunk.is_empty() {
            return Err(protocol());
        }
        offset += chunk.len() as u64;
        hash.update(chunk);
    }
    Ok(deck_core::util::to_hex(&hash.finalize()))
}
impl PackageLease {
    /// Borrow the verified private interpreter while this lease retains its locks.
    pub(crate) fn python(&self) -> &Path {
        &self.python
    }

    /// Validate compile-time locks, reject extra files, and retain readonly locks.
    pub fn open(root: &Path) -> Result<Self, DeckError> {
        let guard = DirectoryGuard::open(root).map_err(|_| unavailable())?;
        let mut parents = FileReadPool::default();
        let mut files = verify_tree_with_pool(&root.join("python"), RUNTIME_LOCK, &mut parents)?;
        files.extend(verify_tree_with_pool(
            &root.join("source"),
            SOURCE_LOCK,
            &mut parents,
        )?);
        let lease = Self {
            _root: guard,
            _files: files,
            python: root.join("python/python.exe"),
            entry: root.join("source/teacherdeck_worker.py"),
        };
        if !lease.python.is_file() || !lease.entry.is_file() {
            return Err(unavailable());
        }
        Ok(lease)
    }
}
#[derive(Serialize)]
struct Request<'a, T> {
    id: String,
    method: &'a str,
    args: &'a T,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response<T> {
    id: Option<String>,
    ok: bool,
    result: Option<T>,
    error: Option<PrivateError>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PrivateError {
    code: String,
}
fn private_error(code: &str) -> DeckError {
    let (kind, message) = match code {
        "BUSY" => (ErrorCode::Busy, "메신저 작업이 진행 중이에요."),
        "INVALID_HANDLE" | "PLAN_EXPIRED" => (
            ErrorCode::NotFound,
            "연결 또는 미리보기가 만료됐어요. 다시 확인해 주세요.",
        ),
        "INVALID_ARGS" | "INVALID_MESSAGE" => {
            (ErrorCode::InvalidArgs, "예약 메시지 입력을 확인해 주세요.")
        }
        "CONNECTION_CHANGED" => (
            ErrorCode::PermissionDenied,
            "메신저 로그인 정보가 바뀌었어요. 다시 연결해 주세요.",
        ),
        "SELF_VERIFICATION_REQUIRED" => (
            ErrorCode::PermissionDenied,
            "처음 연결할 때 쿨메신저에서 본인 항목을 선택하고 나에게 보내기를 켠 본인 작성창을 준비한 뒤 연결해 주세요.",
        ),
        "CONFIRMATION_REQUIRED" | "PLAN_BLOCKED" | "RECIPIENT_MISMATCH" => (
            ErrorCode::PermissionDenied,
            "받는 사람과 등록 조건을 다시 확인해 주세요.",
        ),
        _ => (
            ErrorCode::Internal,
            "메신저 작업을 완료하지 못했어요. 등록 여부를 직접 확인해 주세요.",
        ),
    };
    let mut error = DeckError::new(kind, message);
    if code == "SELF_VERIFICATION_REQUIRED" {
        error.details = Some(serde_json::json!({"reason":"SELF_VERIFICATION_REQUIRED"}));
    }
    error
}
/// One owned worker with bounded lines and no inherited environment or diagnostic output.
pub struct Worker {
    child: Arc<Mutex<Child>>,
    input: mpsc::SyncSender<Vec<u8>>,
    output: Receiver<Result<Vec<u8>, ()>>,
    sequence: u64,
    dead: bool,
    _package: PackageLease,
}
impl Worker {
    /// A stopped protocol session cannot be reused; reconnect must create a new worker.
    pub fn is_dead(&self) -> bool {
        self.dead
    }

    /// Launch only the approved isolated interpreter and compiled fixed bootstrap.
    pub fn spawn(package: PackageLease, data: &Path) -> Result<Self, DeckError> {
        let mut command = Command::new(&package.python);
        command
            .args(["-I", "-S", "-B"])
            .arg(&package.entry)
            .arg("--data-dir")
            .arg(data)
            .current_dir(package.entry.parent().ok_or_else(unavailable)?)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        // DLL and COM discovery need only the Windows installation, never Python search paths.
        for key in ["SystemRoot", "WINDIR"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().map_err(|_| unavailable())?;
        let mut input: ChildStdin = child.stdin.take().ok_or_else(protocol)?;
        let output = child.stdout.take().ok_or_else(protocol)?;
        let (send, receive) = mpsc::sync_channel(1);
        let (write_send, write_receive) = mpsc::sync_channel::<Vec<u8>>(1);
        std::thread::spawn(move || {
            while let Ok(line) = write_receive.recv() {
                if input.write_all(&line).and_then(|_| input.flush()).is_err() {
                    break;
                }
            }
        });
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let frame = read_frame(&mut reader);
                let failed = frame.is_err();
                if send.send(frame).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Self {
            child: Arc::new(Mutex::new(child)),
            input: write_send,
            output: receive,
            sequence: 0,
            dead: false,
            _package: package,
        })
    }
    /// Typed private protocol. Never return raw provider messages or response fragments.
    pub fn call<A: Serialize, R: DeserializeOwned>(
        &mut self,
        method: &str,
        args: &A,
    ) -> Result<R, DeckError> {
        if self.dead
            || !["connect", "recipients", "plan", "start", "status", "cancel"].contains(&method)
        {
            return Err(protocol());
        }
        self.sequence = self.sequence.checked_add(1).ok_or_else(protocol)?;
        let id = self.sequence.to_string();
        let mut line = serde_json::to_vec(&Request {
            id: id.clone(),
            method,
            args,
        })
        .map_err(|_| protocol())?;
        line.push(b'\n');
        if line.len() > MAX_LINE {
            return Err(DeckError::new(
                ErrorCode::InvalidArgs,
                "예약 메시지 입력 크기가 너무 커요.",
            ));
        }
        if self.input.try_send(line).is_err() {
            self.stop();
            return Err(protocol());
        }
        let raw = match self.output.recv_timeout(TIMEOUT) {
            Ok(Ok(raw)) => raw,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.stop();
                return Err(DeckError::new(
                    ErrorCode::Timeout,
                    "메신저 응답 시간이 초과됐어요. 등록 여부를 직접 확인해 주세요.",
                ));
            }
            _ => {
                self.stop();
                return Err(protocol());
            }
        };
        let response: Response<R> = match serde_json::from_slice(&raw) {
            Ok(value) => value,
            Err(_) => {
                self.stop();
                return Err(protocol());
            }
        };
        if response.id.as_deref() != Some(&id) {
            self.stop();
            return Err(protocol());
        }
        match (response.ok, response.result, response.error) {
            (true, Some(value), None) => Ok(value),
            (false, None, Some(error)) => Err(private_error(&error.code)),
            _ => {
                self.stop();
                Err(protocol())
            }
        }
    }
    /// Terminate only the child created by this Worker, preserving its durable attempt ledger.
    pub fn stop(&mut self) {
        self.dead = true;
        self.stop_token().stop();
    }
    /// Independent permission-revocation guard can stop a blocked private request.
    pub fn stop_token(&self) -> StopToken {
        StopToken(self.child.clone())
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop();
    }
}
/// Own-child-only termination; no process enumeration or external application cleanup.
#[derive(Clone)]
pub struct StopToken(Arc<Mutex<Child>>);
impl StopToken {
    pub fn stop(&self) {
        if let Ok(mut child) = self.0.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lock_paths_cannot_escape_or_use_windows_prefixes() {
        for path in ["", "../x", "/x", "C:/x", "x\\y", "a/./b"] {
            assert!(relative(path).is_err(), "{path}");
        }
        assert!(relative("app/core.py").is_ok());
    }
    #[test]
    fn private_diagnostics_never_reach_modules() {
        let error = private_error("PRIVATE_PATH_OR_ACCOUNT");
        assert!(!error.message.contains("PRIVATE_PATH"));
        assert_eq!(
            private_error("CONNECTION_CHANGED").code,
            ErrorCode::PermissionDenied
        );
    }
    #[test]
    fn worker_frames_require_newline_and_bound_bytes_before_decode() {
        assert_eq!(
            read_frame(&mut std::io::Cursor::new(b"{}\n")).unwrap(),
            b"{}\n"
        );
        assert!(read_frame(&mut std::io::Cursor::new(b"{}")).is_err());
        assert!(read_frame(&mut std::io::Cursor::new(vec![b'x'; MAX_LINE + 1])).is_err());
        assert!(read_frame(&mut std::io::Cursor::new(Vec::<u8>::new())).is_err());
    }
    #[test]
    fn compiled_asset_lock_requires_exact_files_and_content() {
        let root = std::env::temp_dir().join(format!(
            "teacherdeck-messaging-asset-{}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("synthetic.py");
        std::fs::write(&source, b"synthetic").unwrap();
        let hash = deck_core::util::to_hex(&Sha256::digest(b"synthetic"));
        let lock = serde_json::json!({"files":[{"path":"synthetic.py","size":9,"sha256":hash}]})
            .to_string();
        let files = verify_tree(&root, &lock).unwrap();
        #[cfg(windows)]
        assert!(std::fs::write(&source, b"changed!!").is_err());
        drop(files);
        std::fs::write(root.join("extra.py"), b"extra").unwrap();
        assert!(verify_tree(&root, &lock).is_err());
        std::fs::remove_file(root.join("extra.py")).unwrap();
        std::fs::write(&source, b"changed!!").unwrap();
        assert!(verify_tree(&root, &lock).is_err());
        std::fs::remove_file(source).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
