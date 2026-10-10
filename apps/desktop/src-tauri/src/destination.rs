// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Host-private append-new destination grants. Paths never enter module metadata.
//! A service mutex serializes revoke with publication; completed user files remain.
//! Retained directory guards plus persisted metadata detect ordinary replacement.
//! Stable std Windows metadata is not a cryptographic file-id guarantee.

use crate::{
    file_output::{OutputBatch, WRITE_CHUNK_BYTES},
    file_read::{DirectoryGuard, FileReadSession},
    platform::{OsRng, TempArea},
    state::{AppState, FileHandleKind, FileHandleTarget},
};
use deck_core::{
    DeckError, ErrorCode,
    caps::fs::{DestinationGrant, FileHandleInfo, extension_of},
    handles::{HANDLE_BYTES, RandomSource},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_CAPTURE_BYTES: usize = 128 * 1024 * 1024;
const MAX_RECORD_BYTES: u64 = 8192;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fingerprint {
    created: u128,
    #[cfg(windows)]
    attributes: u32,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}
impl Fingerprint {
    fn read(path: &Path) -> Result<Self, DeckError> {
        let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(unavailable());
        }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt;
        #[cfg(windows)]
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(unavailable());
        }
        Ok(Self {
            created: metadata
                .created()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos()),
            #[cfg(windows)]
            attributes: metadata.file_attributes(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        })
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    owner: String,
    handle: String,
    path: PathBuf,
    fingerprint: Fingerprint,
    persistent: bool,
}
impl Record {
    fn validate(&self) -> Result<DirectoryGuard, DeckError> {
        let guard = DirectoryGuard::open(&self.path)?;
        if Fingerprint::read(&self.path)? != self.fingerprint {
            return Err(unavailable());
        }
        guard.validate()?;
        Ok(guard)
    }
    fn info(&self) -> DestinationGrant {
        DestinationGrant {
            grant_handle: self.handle.clone(),
            label: "선택한 저장 폴더".into(),
            persistent: self.persistent,
            available: self.validate().is_ok(),
        }
    }
}

/// Per-module persistent destination metadata, never a general filesystem permission.
pub struct DestinationService {
    root: PathBuf,
    records: HashMap<String, Option<Record>>,
}
impl DestinationService {
    /// Creates only the application-private metadata folder, never a user destination.
    pub fn open(root: PathBuf) -> Result<Self, DeckError> {
        // The application's data directory may not exist on first launch. Build
        // only this host-private tree while retaining guards on every existing parent.
        if !root.is_absolute() {
            return Err(invalid());
        }
        let mut missing = Vec::new();
        let mut ancestor = root.as_path();
        loop {
            match fs::symlink_metadata(ancestor) {
                Ok(_) => break,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    missing.push(ancestor.to_path_buf());
                    ancestor = ancestor.parent().ok_or_else(invalid)?;
                }
                Err(_) => return Err(internal()),
            }
        }
        let mut guards = vec![DirectoryGuard::open(ancestor)?];
        for path in missing.into_iter().rev() {
            for guard in &guards {
                guard.validate()?;
            }
            match fs::create_dir(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(internal()),
            }
            guards.push(DirectoryGuard::open(&path)?);
        }
        DirectoryGuard::open(&root)?.validate()?;
        Ok(Self {
            root,
            records: HashMap::new(),
        })
    }
    fn record_path(&self, owner: &str) -> Result<PathBuf, DeckError> {
        if !deck_core::util::is_valid_module_id(owner) {
            return Err(invalid());
        }
        Ok(self.root.join(format!("{owner}.json")))
    }
    fn load(&mut self, owner: &str) -> Result<(), DeckError> {
        let path = self.record_path(owner)?;
        if self.records.contains_key(owner) {
            return Ok(());
        }
        let guard = DirectoryGuard::open(&self.root)?;
        guard.validate()?;
        let record = match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(internal()),
            Ok(_) => {
                let mut read = FileReadSession::open(&path)?;
                if read.size() > MAX_RECORD_BYTES {
                    return Err(internal());
                }
                let bytes = if read.size() == 0 {
                    vec![]
                } else {
                    read.read_chunk(0, usize::try_from(read.size()).map_err(|_| internal())?)?
                };
                let record: Record = serde_json::from_slice(&bytes).map_err(|_| internal())?;
                if record.version != 1
                    || record.owner != owner
                    || !record.persistent
                    || record.handle.len() != HANDLE_BYTES * 2
                    || !record.handle.bytes().all(|c| c.is_ascii_hexdigit())
                {
                    return Err(internal());
                }
                Some(record)
            }
        };
        self.records.insert(owner.to_owned(), record);
        Ok(())
    }
    fn persist(&self, owner: &str, record: Option<&Record>) -> Result<(), DeckError> {
        let path = self.record_path(owner)?;
        let guard = DirectoryGuard::open(&self.root)?;
        guard.validate()?;
        if let Some(record) = record {
            let bytes = serde_json::to_vec(record).map_err(|_| internal())?;
            if bytes.len() > MAX_RECORD_BYTES as usize {
                return Err(invalid());
            }
            let stage = self.root.join(format!(".{}.part", token()));
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            let mut file = options.open(&stage).map_err(|_| internal())?;
            let result = (|| {
                file.write_all(&bytes).map_err(|_| internal())?;
                file.sync_all().map_err(|_| internal())?;
                guard.validate()?;
                // Replacement is limited to the host-owned grant record, never user files.
                fs::rename(&stage, &path).map_err(|_| internal())
            })();
            drop(file);
            if result.is_err() {
                let _ = fs::remove_file(stage);
            }
            result
        } else {
            match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(_) => Err(internal()),
            }
        }
    }
    /// Called only after host folder selection and explicit remember confirmation.
    pub fn pick(
        &mut self,
        owner: &str,
        path: &Path,
        remember: bool,
    ) -> Result<DestinationGrant, DeckError> {
        self.record_path(owner)?;
        let guard = DirectoryGuard::open(path)?;
        let path = fs::canonicalize(path).map_err(|_| unavailable())?;
        guard.validate()?;
        let record = Record {
            version: 1,
            owner: owner.into(),
            handle: token(),
            fingerprint: Fingerprint::read(&path)?,
            path,
            persistent: remember,
        };
        record.validate()?;
        self.persist(owner, if remember { Some(&record) } else { None })?;
        let info = record.info();
        self.records.insert(owner.into(), Some(record));
        Ok(info)
    }
    /// Restores this owner's remembered grant; missing destinations stay unavailable.
    pub fn status(
        &mut self,
        owner: &str,
        handle: Option<&str>,
    ) -> Result<Option<DestinationGrant>, DeckError> {
        self.load(owner)?;
        let record = self.records.get(owner).and_then(Option::as_ref);
        if let Some(handle) = handle
            && record.is_none_or(|r| r.handle != handle)
        {
            return Err(denied());
        }
        Ok(record.map(Record::info))
    }
    fn get(&mut self, owner: &str, handle: &str) -> Result<Record, DeckError> {
        self.load(owner)?;
        let record = self
            .records
            .get(owner)
            .and_then(Option::as_ref)
            .filter(|r| r.handle == handle)
            .ok_or_else(denied)?;
        Ok(record.clone())
    }
    /// Validates owner, persisted identity, root ancestors and availability on every job.
    pub fn validate(&mut self, owner: &str, handle: &str) -> Result<(), DeckError> {
        self.get(owner, handle)?.validate()?.validate()
    }
    /// Revokes only host records; holding the service lock orders this after in-flight publication.
    pub fn revoke(&mut self, owner: &str, handle: &str) -> Result<(), DeckError> {
        self.get(owner, handle)?;
        self.persist(owner, None)?;
        self.records.insert(owner.into(), None);
        Ok(())
    }
    /// Publishes one immutable new file with bounded chunks and existing crash journal.
    pub fn append(
        &mut self,
        owner: &str,
        handle: &str,
        name: &str,
        bytes: &[u8],
        temp: &TempArea,
    ) -> Result<PathBuf, DeckError> {
        if bytes.is_empty() || bytes.len() > MAX_CAPTURE_BYTES {
            return Err(invalid());
        }
        crate::file_output::validate_name(name)?;
        let record = self.get(owner, handle)?;
        let guard = record.validate()?;
        let output = OutputBatch::append_destination(&record.path)?;
        let mut write = output.begin(name, bytes.len() as u64, temp)?;
        for (index, chunk) in bytes.chunks(WRITE_CHUNK_BYTES).enumerate() {
            write.append((index * WRITE_CHUNK_BYTES) as u64, chunk)?;
        }
        guard.validate()?;
        record.validate()?;
        write.commit()
    }
    fn path(&mut self, owner: &str, handle: &str) -> Result<(PathBuf, DirectoryGuard), DeckError> {
        let record = self.get(owner, handle)?;
        let guard = record.validate()?;
        Ok((record.path, guard))
    }
}

fn token() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    OsRng.fill(&mut bytes);
    deck_core::util::to_hex(&bytes)
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "저장 이름과 파일 크기를 확인해 주세요.",
    )
}
fn denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 저장 폴더 권한을 사용할 수 없어요. 폴더를 다시 선택해 주세요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::NotFound,
        "저장 폴더가 없거나 바뀌었어요. 폴더를 다시 선택해 주세요.",
    )
}
fn internal() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "저장 폴더 권한을 처리하지 못했어요. 다시 선택해 주세요.",
    )
}

/// Creates a grant after the capability handler obtained explicit user selection.
pub fn pick(
    state: &AppState,
    owner: &str,
    path: &Path,
    remember: bool,
) -> Result<DestinationGrant, DeckError> {
    state
        .destinations
        .lock()
        .map_err(|_| internal())?
        .pick(owner, path, remember)
}
/// Owner-isolated remembered grant lookup.
pub fn status(
    state: &AppState,
    owner: &str,
    grant: Option<&str>,
) -> Result<Option<DestinationGrant>, DeckError> {
    state
        .destinations
        .lock()
        .map_err(|_| internal())?
        .status(owner, grant)
}
/// Removes authority only; never deletes saved capture files.
pub fn revoke(state: &AppState, owner: &str, grant: &str) -> Result<(), DeckError> {
    state
        .destinations
        .lock()
        .map_err(|_| internal())?
        .revoke(owner, grant)
}
/// Native capture checks this before every trigger, including detached iframe sessions.
pub fn validate(state: &AppState, owner: &str, grant: &str) -> Result<(), DeckError> {
    state
        .destinations
        .lock()
        .map_err(|_| internal())?
        .validate(owner, grant)
}
/// Saves host-side encoded bytes and issues only a current-generation read-only handle.
pub fn save(
    state: &AppState,
    owner: &str,
    grant: &str,
    name: &str,
    bytes: &[u8],
) -> Result<FileHandleInfo, DeckError> {
    let mut service = state.destinations.lock().map_err(|_| internal())?;
    let temp = state.file_temp.as_ref().ok_or_else(internal)?;
    let path = service.append(owner, grant, name, bytes, temp)?;
    let transfers = state.transfers.lock().map_err(|_| internal())?;
    let generation = transfers.generation(owner);
    let metadata = fs::metadata(&path).map_err(|_| internal())?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(internal)?
        .to_owned();
    let handle = state.handles.lock().map_err(|_| internal())?.issue(
        owner,
        FileHandleTarget {
            path,
            kind: FileHandleKind::ReadFile,
            generation,
        },
    );
    Ok(FileHandleInfo {
        handle,
        ext: extension_of(&name),
        name,
        size: metadata.len(),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)),
    })
}
/// Opens the validated destination via the fixed Windows Explorer executable.
pub fn reveal(state: &AppState, owner: &str, grant: &str) -> Result<(), DeckError> {
    let mut service = state.destinations.lock().map_err(|_| internal())?;
    let (path, guard) = service.path(owner, grant)?;
    guard.validate()?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|_| internal())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "이 운영체제에서는 폴더 열기를 지원하지 않아요.",
        ))
    }
}

#[cfg(test)]
#[path = "destination_tests.rs"]
mod tests;
