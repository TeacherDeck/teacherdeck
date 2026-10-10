// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Sequential output sessions for host-owned new result folders. No original is overwritten.
//! Temporary/staging cleanup checks ownership and is non-recursive. Native Windows sharing
//! and directory guards prevent ordinary replacement; metadata checks are conservative,
//! not an absolute identity guarantee against privileged external filesystem races.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::file_read::{DirectoryGuard, MAX_FILE_BYTES, same_file_identity, same_file_snapshot};
use crate::platform::{OsRng, TempArea};
use deck_core::{
    DeckError, ErrorCode,
    handles::{HANDLE_BYTES, RandomSource},
};

/// Maximum raw bytes accepted per authenticated bridge output chunk.
pub const WRITE_CHUNK_BYTES: usize = 64 * 1024;
const NAME_ATTEMPTS: usize = 10000;

#[path = "file_output_journal.rs"]
mod journal;

/// Conservatively removes verified host-owned work files from an earlier app run.
/// Corrupt, unknown, user-modified entries and all published results are preserved.
pub fn recover(temp: &TempArea) -> Result<(), DeckError> {
    journal::recover_area(temp)
}

struct BatchInner {
    folder: PathBuf,
    guard: DirectoryGuard,
}

/// A newly created output folder; dropping it never removes the folder or user files.
pub struct OutputBatch {
    inner: Arc<BatchInner>,
}

impl OutputBatch {
    /// Creates a new uniquely numbered child folder below a selected ordinary parent.
    pub fn create(parent: &Path, suggested_name: &str) -> Result<Self, DeckError> {
        validate_name(suggested_name)?;
        let parent_guard = DirectoryGuard::open(parent)?;
        for index in 0..NAME_ATTEMPTS {
            parent_guard.validate()?;
            let name = numbered(suggested_name, index, false);
            if exists_case_insensitive(parent, &name)? {
                continue;
            }
            let folder = parent.join(name);
            match fs::create_dir(&folder) {
                Ok(()) => {
                    let guard = DirectoryGuard::open(&folder)?;
                    return Ok(Self {
                        inner: Arc::new(BatchInner { folder, guard }),
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(map_io(error)),
            }
        }
        Err(busy())
    }

    /// Host-private output path; do not send it to a module or log it.
    pub fn folder_path(&self) -> &Path {
        &self.inner.folder
    }

    /// Starts one new file in application-private temp. No final output appears yet.
    pub fn begin(
        &self,
        suggested_name: &str,
        size: u64,
        temp: &TempArea,
    ) -> Result<FileWriteSession, DeckError> {
        validate_name(suggested_name)?;
        if size > MAX_FILE_BYTES {
            return Err(invalid());
        }
        self.inner.guard.validate()?;
        let temp_root_guard = DirectoryGuard::open(temp.root())?;
        temp_root_guard.validate()?;
        let temp_dir = temp.create_dir(&mut OsRng).map_err(map_io)?;
        // Disarm the generic recursive TempDir drop; cleanup below only deletes owned files.
        let temp_path = temp_dir.into_path();
        let temp_guard = Arc::new(DirectoryGuard::open(&temp_path)?);
        let path = temp_path.join("input.part");
        let source = OwnedFile::create(path, Arc::clone(&temp_guard))?;
        let journal = journal::Journal::create(&source)?;
        Ok(FileWriteSession {
            batch: Arc::clone(&self.inner),
            name: suggested_name.into(),
            size,
            next_offset: 0,
            previous: None,
            state: WriteState::Pending,
            source: Some(source),
            staging: None,
            temp_path,
            temp_guard: Some(temp_guard),
            journal: Some(journal),
            cleanup_uncertain: false,
        })
    }
}

#[derive(PartialEq, Eq)]
enum WriteState {
    Pending,
    Committed(PathBuf),
    Aborted,
}

/// Host-owned sequential writer. The orchestration service serializes append/commit/abort.
/// Only one previous chunk is retained; it permits an identical immediate retransmission.
pub struct FileWriteSession {
    batch: Arc<BatchInner>,
    name: String,
    size: u64,
    next_offset: u64,
    previous: Option<(u64, Vec<u8>)>,
    state: WriteState,
    source: Option<OwnedFile>,
    staging: Option<OwnedFile>,
    temp_path: PathBuf,
    temp_guard: Option<Arc<DirectoryGuard>>,
    journal: Option<journal::Journal>,
    cleanup_uncertain: bool,
}

impl FileWriteSession {
    /// Appends the next chunk, or acknowledges the identical immediately previous chunk.
    pub fn append(&mut self, offset: u64, data: &[u8]) -> Result<u64, DeckError> {
        if self.state != WriteState::Pending {
            return Err(cancelled());
        }
        if data.is_empty() || data.len() > WRITE_CHUNK_BYTES {
            return Err(invalid());
        }
        self.batch.guard.validate()?;
        self.source.as_ref().ok_or_else(cancelled)?.validate()?;
        if let Some((previous_offset, previous_data)) = &self.previous
            && offset == *previous_offset
        {
            return if data == previous_data {
                Ok(self.next_offset)
            } else {
                Err(invalid())
            };
        }
        if offset != self.next_offset {
            return Err(invalid());
        }
        let end = offset
            .checked_add(u64::try_from(data.len()).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        if end > self.size {
            return Err(invalid());
        }
        self.batch.guard.validate()?;
        let source = self.source.as_mut().ok_or_else(cancelled)?;
        source.validate()?;
        if let Err(error) = source.write_all(data) {
            self.state = WriteState::Aborted;
            let _ = self.cleanup();
            return Err(error);
        }
        self.next_offset = end;
        if let Err(error) = self.journal.as_mut().ok_or_else(cancelled)?.append(data) {
            self.state = WriteState::Aborted;
            let _ = self.cleanup();
            return Err(error);
        }
        if end == self.size
            && let Err(error) = self.journal.as_mut().ok_or_else(cancelled)?.checkpoint()
        {
            self.state = WriteState::Aborted;
            let _ = self.cleanup();
            return Err(error);
        }
        self.previous = Some((offset, data.to_vec()));
        Ok(end)
    }

    /// Validates full size, copies with one 64 KiB buffer, then atomically publishes a
    /// new file on the destination volume. Existing names receive a numeric suffix.
    /// The original locked stage handle remains open while a new hard link is created.
    /// Unsupported filesystems fail safely without an overwrite fallback.
    /// Repeating commit returns the same successfully published path.
    pub fn commit(&mut self) -> Result<PathBuf, DeckError> {
        match &self.state {
            WriteState::Committed(path) => return Ok(path.clone()),
            WriteState::Aborted => return Err(cancelled()),
            WriteState::Pending => {}
        }
        if self.next_offset != self.size {
            return Err(invalid());
        }
        self.batch.guard.validate()?;
        let source = self.source.as_mut().ok_or_else(cancelled)?;
        source.validate()?;
        source.flush()?;
        if source.metadata.len() != self.size {
            return Err(changed());
        }
        let guard = Arc::new(DirectoryGuard::open(&self.batch.folder)?);
        let stage_name = format!(".deck-stage-{}.part", random_suffix());
        self.staging = Some(OwnedFile::create(
            self.batch.folder.join(stage_name),
            guard,
        )?);
        self.journal
            .as_mut()
            .ok_or_else(cancelled)?
            .stage(self.staging.as_ref().ok_or_else(cancelled)?)?;
        let result = self.copy_and_publish();
        match result {
            Ok(path) => {
                // The visible file is committed before cleanup. Cleanup failures must not
                // turn a published result into a failed/cancelled result or delete it.
                self.state = WriteState::Committed(path.clone());
                self.previous = None;
                let _ = self.cleanup();
                Ok(path)
            }
            Err(error) => {
                self.state = WriteState::Aborted;
                self.previous = None;
                let _ = self.cleanup();
                Err(error)
            }
        }
    }

    fn copy_and_publish(&mut self) -> Result<PathBuf, DeckError> {
        let source = self.source.as_mut().ok_or_else(cancelled)?;
        let staging = self.staging.as_mut().ok_or_else(cancelled)?;
        source.seek_start()?;
        let mut buffer = [0u8; WRITE_CHUNK_BYTES];
        let mut copied = 0u64;
        loop {
            self.batch.guard.validate()?;
            source.validate()?;
            staging.validate()?;
            let count = source.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            copied = copied
                .checked_add(u64::try_from(count).map_err(|_| invalid())?)
                .ok_or_else(invalid)?;
            if copied > self.size {
                return Err(changed());
            }
            staging.write_all(buffer.get(..count).ok_or_else(invalid)?)?;
        }
        if copied != self.size {
            return Err(changed());
        }
        staging.flush()?;
        source.validate()?;
        staging.validate()?;
        for index in 0..NAME_ATTEMPTS {
            self.batch.guard.validate()?;
            staging.validate()?;
            let name = numbered(&self.name, index, true);
            if exists_case_insensitive(&self.batch.folder, &name)? {
                continue;
            }
            let final_path = self.batch.folder.join(name);
            let published = fs::hard_link(&staging.path, &final_path);
            match published {
                Ok(()) => {
                    let _ = staging.refresh();
                    return Ok(final_path);
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(DeckError::new(
                        ErrorCode::Internal,
                        "이 저장 위치에는 새 결과를 안전하게 게시할 수 없어요. NTFS 저장 위치를 선택해 주세요.",
                    ));
                }
            }
        }
        Err(busy())
    }

    /// Cancels unfinished output and removes only unmodified host-owned work files.
    /// Once committed, abort is a no-op and the completed result remains intact.
    pub fn abort(&mut self) -> Result<(), DeckError> {
        if matches!(self.state, WriteState::Committed(_)) {
            return Ok(());
        }
        self.state = WriteState::Aborted;
        self.previous = None;
        self.cleanup()
    }

    fn cleanup(&mut self) -> Result<(), DeckError> {
        let mut failure = None;
        if let Some(mut source) = self.source.take()
            && let Err(error) = source.remove_if_owned()
        {
            failure = Some(error);
        }
        if let Some(mut staging) = self.staging.take()
            && staging.remove_on_drop
            && let Err(error) = staging.remove_if_owned()
        {
            failure = Some(error);
        }
        self.cleanup_uncertain |= failure.is_some();
        if !self.cleanup_uncertain
            && let Some(mut journal) = self.journal.take()
            && let Err(error) = journal.remove()
        {
            failure = Some(error);
        }
        if let Some(guard) = self.temp_guard.take() {
            let safe = guard.validate().is_ok();
            drop(guard);
            if safe {
                // Non-recursive: a user-added file is preserved rather than swept away.
                if let Err(error) = fs::remove_dir(&self.temp_path)
                    && error.kind() != io::ErrorKind::NotFound
                    && failure.is_none()
                {
                    failure = Some(map_io(error));
                }
            } else if failure.is_none() {
                failure = Some(changed());
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

impl Drop for FileWriteSession {
    fn drop(&mut self) {
        let _ = self.abort();
        let _ = self.cleanup();
    }
}

struct OwnedFile {
    path: PathBuf,
    file: Option<File>,
    metadata: Metadata,
    guard: Arc<DirectoryGuard>,
    remove_on_drop: bool,
}
impl OwnedFile {
    fn create(path: PathBuf, guard: Arc<DirectoryGuard>) -> Result<Self, DeckError> {
        guard.validate()?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(1).custom_flags(0x0020_0000);
        }
        let file = options.open(&path).map_err(map_io)?;
        let metadata = file.metadata().map_err(map_io)?;
        let owned = Self {
            path,
            file: Some(file),
            metadata,
            guard,
            remove_on_drop: true,
        };
        owned.validate()?;
        Ok(owned)
    }
    fn validate(&self) -> Result<(), DeckError> {
        self.guard.validate()?;
        let current = fs::symlink_metadata(&self.path).map_err(map_io)?;
        let opened = match &self.file {
            Some(file) => file.metadata().map_err(map_io)?,
            None => current.clone(),
        };
        if !same_file_snapshot(&self.metadata, &current)?
            || !same_file_snapshot(&self.metadata, &opened)?
        {
            return Err(changed());
        }
        Ok(())
    }
    fn refresh(&mut self) -> Result<(), DeckError> {
        self.metadata = match &self.file {
            Some(file) => file.metadata().map_err(map_io)?,
            None => fs::symlink_metadata(&self.path).map_err(map_io)?,
        };
        Ok(())
    }
    #[cfg(test)]
    fn close_writer(&mut self) -> Result<(), DeckError> {
        self.validate()?;
        let before = self.metadata.clone();
        drop(self.file.take());
        let after = fs::symlink_metadata(&self.path).map_err(map_io)?;
        if !same_file_identity(&before, &after) {
            return Err(changed());
        }
        self.metadata = after;
        self.validate()
    }
    fn write_all(&mut self, data: &[u8]) -> Result<(), DeckError> {
        let result = self
            .file
            .as_mut()
            .ok_or_else(cancelled)?
            .write_all(data)
            .map_err(map_io);
        // Even a partial I/O failure is our own write; refresh before conservative cleanup.
        self.refresh()?;
        result
    }
    fn flush(&mut self) -> Result<(), DeckError> {
        self.file
            .as_mut()
            .ok_or_else(cancelled)?
            .sync_all()
            .map_err(map_io)?;
        self.refresh()
    }
    fn seek_start(&mut self) -> Result<(), DeckError> {
        self.file
            .as_mut()
            .ok_or_else(cancelled)?
            .seek(SeekFrom::Start(0))
            .map_err(map_io)?;
        Ok(())
    }
    fn read(&mut self, buffer: &mut [u8]) -> Result<usize, DeckError> {
        self.file
            .as_mut()
            .ok_or_else(cancelled)?
            .read(buffer)
            .map_err(map_io)
    }
    fn remove_if_owned(&mut self) -> Result<(), DeckError> {
        self.validate()?;
        let before = self.metadata.clone();
        drop(self.file.take());
        let after = match fs::symlink_metadata(&self.path) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(map_io(error)),
        };
        // A writer's last-write timestamp may be finalized only on close on Windows.
        if !same_file_identity(&before, &after) {
            return Err(changed());
        }
        self.guard.validate()?;
        let confirmed = fs::symlink_metadata(&self.path).map_err(map_io)?;
        if !same_file_snapshot(&after, &confirmed)? {
            return Err(changed());
        }
        fs::remove_file(&self.path).map_err(map_io)
    }
}
impl Drop for OwnedFile {
    fn drop(&mut self) {
        if self.remove_on_drop {
            let _ = self.remove_if_owned();
        }
    }
}

/// Validates one portable filename/folder name, including Windows device/stream rules.
pub fn validate_name(name: &str) -> Result<(), DeckError> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || stem.strip_prefix("COM").is_some_and(|suffix| {
        matches!(
            suffix,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        )
    }) || stem.strip_prefix("LPT").is_some_and(|suffix| {
        matches!(
            suffix,
            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
        )
    });
    if name.is_empty()
        || name.encode_utf16().count() > 200
        || name.contains("..")
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || reserved
    {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "결과 이름은 경로나 예약 이름 없이 하나의 이름으로 입력해 주세요.",
        ));
    }
    Ok(())
}
fn numbered(name: &str, index: usize, extension: bool) -> String {
    if index == 0 {
        return name.into();
    }
    if extension {
        let path = Path::new(name);
        if let (Some(stem), Some(ext)) = (
            path.file_stem().and_then(|v| v.to_str()),
            path.extension().and_then(|v| v.to_str()),
        ) {
            return format!("{stem} ({}).{ext}", index + 1);
        }
    }
    format!("{name} ({})", index + 1)
}
fn exists_case_insensitive(parent: &Path, name: &str) -> Result<bool, DeckError> {
    let folded = name.to_lowercase();
    for entry in fs::read_dir(parent).map_err(map_io)? {
        let entry = entry.map_err(map_io)?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|n| n.to_lowercase() == folded)
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn random_suffix() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    OsRng.fill(&mut bytes);
    deck_core::util::to_hex(&bytes)
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "쓰기 순서·청크 길이·총크기를 확인해 주세요.",
    )
}
fn cancelled() -> DeckError {
    DeckError::new(
        ErrorCode::Cancelled,
        "쓰기가 끝났거나 취소됐어요. 새 쓰기를 시작해 주세요.",
    )
}
fn changed() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "작업 파일 상태가 바뀌었어요. 변경된 파일을 보존하고 작업을 중단했어요.",
    )
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "결과 이름을 정할 수 없어요. 다른 이름을 선택해 주세요.",
    )
}
fn map_io(error: io::Error) -> DeckError {
    match error.kind() {
        io::ErrorKind::NotFound => DeckError::new(
            ErrorCode::NotFound,
            "저장 위치를 찾을 수 없어요. 저장 위치를 다시 선택해 주세요.",
        ),
        io::ErrorKind::PermissionDenied => DeckError::new(
            ErrorCode::PermissionDenied,
            "저장할 권한이 없어요. 쓰기 가능한 저장 위치를 선택해 주세요.",
        ),
        _ => DeckError::new(
            ErrorCode::Internal,
            "결과를 저장하지 못했어요. 저장 공간과 파일 상태를 확인해 주세요.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct Fixture {
        root: PathBuf,
        area: TempArea,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("deck-output-test-{}", random_suffix()));
            let area = TempArea::init(root.clone()).unwrap();
            Self { root, area }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir(&self.root);
        }
    }

    #[test]
    fn names_are_single_portable_names_and_numbering_preserves_extensions() {
        for name in [
            "",
            ".",
            "..",
            "a..b",
            "a/b",
            "a\\b",
            "C:x",
            "CON",
            "con.txt",
            "LPT1",
            "COM¹.docx",
            "NUL",
            "NUL .txt",
            "x.",
            "x ",
            "x\0y",
        ] {
            assert_eq!(
                validate_name(name).unwrap_err().code,
                ErrorCode::InvalidArgs
            );
        }
        for name in ["합성 결과", "report.txt", ".metadata", "교사A 자료.xlsx"] {
            assert!(validate_name(name).is_ok());
        }
        assert_eq!(numbered("synthetic.xlsx", 1, true), "synthetic (2).xlsx");
    }

    #[test]
    fn writes_boundary_chunks_retries_exactly_one_and_preserves_originals() {
        let fixture = Fixture::new();
        let selected = fixture.root.join("selected");
        fs::create_dir(&selected).unwrap();
        let original = selected.join("synthetic-original.txt");
        fs::write(&original, b"original-data").unwrap();
        let before = deck_core::util::sha256_hex(&fs::read(&original).unwrap());
        let batch = OutputBatch::create(&selected, "results").unwrap();
        let mut write = batch
            .begin(
                "synthetic.xlsx",
                (WRITE_CHUNK_BYTES + 3) as u64,
                &fixture.area,
            )
            .unwrap();
        let chunk = vec![255; WRITE_CHUNK_BYTES];
        assert_eq!(write.append(0, &chunk).unwrap(), WRITE_CHUNK_BYTES as u64);
        assert_eq!(write.append(0, &chunk).unwrap(), WRITE_CHUNK_BYTES as u64);
        assert_eq!(
            write.append(0, &[0]).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            write.append(1, &[0]).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            write.append(WRITE_CHUNK_BYTES as u64, b"end").unwrap(),
            (WRITE_CHUNK_BYTES + 3) as u64
        );
        assert_eq!(
            write.append(0, &chunk).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert!(!batch.folder_path().join("synthetic.xlsx").exists());
        let final_path = write.commit().unwrap();
        let mut expected = chunk;
        expected.extend_from_slice(b"end");
        assert_eq!(fs::read(&final_path).unwrap(), expected);
        assert_eq!(write.commit().unwrap(), final_path);
        write.abort().unwrap();
        assert!(final_path.exists());
        assert_eq!(
            write
                .append((WRITE_CHUNK_BYTES + 3) as u64, b"x")
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
        assert_eq!(
            deck_core::util::sha256_hex(&fs::read(&original).unwrap()),
            before
        );
        assert_eq!(fs::read_dir(batch.folder_path()).unwrap().count(), 1);
        assert!(!write.temp_path.exists());
        drop(write);
        assert_eq!(fs::read(&final_path).unwrap(), expected);
        drop(batch);
        fs::remove_file(final_path).unwrap();
        fs::remove_dir(selected.join("results")).unwrap();
        fs::remove_file(original).unwrap();
        fs::remove_dir(selected).unwrap();
    }

    #[test]
    fn does_not_overwrite_case_collisions_and_numbers_new_folders() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.root.join("RESULTS")).unwrap();
        let batch = OutputBatch::create(&fixture.root, "results").unwrap();
        assert_eq!(batch.folder_path().file_name().unwrap(), "results (2)");
        let existing = batch.folder_path().join("SYNTHETIC.txt");
        fs::write(&existing, b"existing").unwrap();
        let mut write = batch.begin("synthetic.txt", 3, &fixture.area).unwrap();
        write.append(0, b"new").unwrap();
        let path = write.commit().unwrap();
        assert_eq!(path.file_name().unwrap(), "synthetic (2).txt");
        assert_eq!(fs::read(&existing).unwrap(), b"existing");
        assert_eq!(fs::read(&path).unwrap(), b"new");
        drop(write);
        drop(batch);
        fs::remove_file(existing).unwrap();
        fs::remove_file(path).unwrap();
        fs::remove_dir(fixture.root.join("results (2)")).unwrap();
        fs::remove_dir(fixture.root.join("RESULTS")).unwrap();
    }

    #[test]
    fn validates_lengths_and_incomplete_commit_without_publishing() {
        let fixture = Fixture::new();
        let batch = OutputBatch::create(&fixture.root, "results").unwrap();
        assert_eq!(
            batch
                .begin("synthetic", MAX_FILE_BYTES + 1, &fixture.area)
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgs
        );
        let mut write = batch.begin("synthetic.txt", 3, &fixture.area).unwrap();
        assert_eq!(
            write
                .append(0, &vec![0; WRITE_CHUNK_BYTES + 1])
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            write.append(0, b"").unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            write.append(u64::MAX, b"x").unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            write.append(0, b"toolong").unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        write.append(0, b"a").unwrap();
        assert_eq!(write.commit().unwrap_err().code, ErrorCode::InvalidArgs);
        assert_eq!(fs::read_dir(batch.folder_path()).unwrap().count(), 0);
        write.abort().unwrap();
        write.abort().unwrap();
        assert_eq!(
            write.append(1, b"bc").unwrap_err().code,
            ErrorCode::Cancelled
        );
        drop(write);
        drop(batch);
        fs::remove_dir(fixture.root.join("results")).unwrap();
    }

    #[test]
    fn commits_empty_files_and_drop_removes_only_own_unfinished_files() {
        let fixture = Fixture::new();
        let batch = OutputBatch::create(&fixture.root, "results").unwrap();
        let mut empty = batch
            .begin("synthetic-empty.txt", 0, &fixture.area)
            .unwrap();
        let path = empty.commit().unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"");
        let mut write = batch
            .begin("synthetic-unfinished.txt", 3, &fixture.area)
            .unwrap();
        write.append(0, b"a").unwrap();
        let temp_path = write.temp_path.clone();
        drop(write);
        assert!(!temp_path.exists());
        let mut write = batch
            .begin("synthetic-added.txt", 3, &fixture.area)
            .unwrap();
        let added = write.temp_path.join("synthetic-user-added.txt");
        fs::write(&added, b"preserve").unwrap();
        let preserved_dir = write.temp_path.clone();
        assert!(write.abort().is_err());
        drop(write);
        assert_eq!(fs::read(&added).unwrap(), b"preserve");
        fs::remove_file(added).unwrap();
        fs::remove_dir(preserved_dir).unwrap();
        drop(empty);
        drop(batch);
        fs::remove_file(path).unwrap();
        fs::remove_dir(fixture.root.join("results")).unwrap();
    }

    #[test]
    fn commit_abort_race_has_one_winner_and_preserves_published_result() {
        let fixture = Fixture::new();
        let batch = OutputBatch::create(&fixture.root, "results").unwrap();
        let mut write = batch.begin("synthetic-race.txt", 3, &fixture.area).unwrap();
        write.append(0, b"abc").unwrap();
        let shared = Arc::new(Mutex::new(write));
        let committed = std::thread::scope(|scope| {
            let first = Arc::clone(&shared);
            let second = Arc::clone(&shared);
            let commit = scope.spawn(move || first.lock().unwrap().commit());
            let abort = scope.spawn(move || second.lock().unwrap().abort());
            let result = commit.join().unwrap();
            assert!(abort.join().unwrap().is_ok());
            result
        });
        match committed {
            Ok(ref path) => assert_eq!(fs::read(path).unwrap(), b"abc"),
            Err(ref error) => {
                assert_eq!(error.code, ErrorCode::Cancelled);
                assert_eq!(fs::read_dir(batch.folder_path()).unwrap().count(), 0);
            }
        }
        drop(shared);
        drop(batch);
        if let Ok(path) = committed {
            fs::remove_file(path).unwrap();
        }
        fs::remove_dir(fixture.root.join("results")).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_batch_and_temp_reject_parent_rename_and_user_mutation_is_preserved() {
        let fixture = Fixture::new();
        let batch = OutputBatch::create(&fixture.root, "results").unwrap();
        let mut write = batch
            .begin("synthetic-user-modified.txt", 3, &fixture.area)
            .unwrap();
        write.append(0, b"abc").unwrap();
        assert!(fs::rename(batch.folder_path(), fixture.root.join("moved")).is_err());
        let source = write.source.as_ref().unwrap().path.clone();
        let original_permissions = fs::metadata(&source).unwrap().permissions();
        let mut altered = original_permissions.clone();
        altered.set_readonly(true);
        fs::set_permissions(&source, altered).unwrap();
        assert_eq!(write.commit().unwrap_err().code, ErrorCode::Internal);
        assert!(write.abort().is_err());
        let temp_path = write.temp_path.clone();
        drop(write);
        assert!(source.exists());
        assert!(temp_path.join("output-journal.json").exists());
        fs::set_permissions(&source, original_permissions).unwrap();
        fs::remove_file(source).unwrap();
        fs::remove_file(temp_path.join("output-journal.json")).unwrap();
        fs::remove_dir(temp_path).unwrap();
        drop(batch);
        fs::remove_dir(fixture.root.join("results")).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn hard_link_publishes_while_original_stage_writer_stays_locked() {
        let fixture = Fixture::new();
        let batch = OutputBatch::create(&fixture.root, "합성 잠금 결과").unwrap();
        let stage_path = batch.folder_path().join("합성-stage.part");
        let mut stage = OwnedFile::create(
            stage_path.clone(),
            Arc::new(DirectoryGuard::open(batch.folder_path()).unwrap()),
        )
        .unwrap();
        stage.write_all(b"synthetic held handle").unwrap();
        stage.flush().unwrap();
        let final_path = batch.folder_path().join("합성-final.bin");
        fs::hard_link(&stage_path, &final_path).unwrap();
        stage.refresh().unwrap();
        stage.validate().unwrap();
        assert_eq!(
            fs::write(&stage_path, b"foreign mutation")
                .unwrap_err()
                .raw_os_error(),
            Some(32)
        );
        assert_eq!(
            fs::remove_file(&stage_path).unwrap_err().raw_os_error(),
            Some(32)
        );
        assert_eq!(
            fs::write(&final_path, b"foreign mutation")
                .unwrap_err()
                .raw_os_error(),
            Some(32)
        );
        assert_eq!(
            fs::hard_link(&stage_path, &final_path).unwrap_err().kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&final_path).unwrap(), b"synthetic held handle");
        stage.remove_if_owned().unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"synthetic held handle");
        drop(stage);
        fs::remove_file(final_path).unwrap();
        let folder = batch.folder_path().to_path_buf();
        drop(batch);
        fs::remove_dir(folder).unwrap();
    }
}
