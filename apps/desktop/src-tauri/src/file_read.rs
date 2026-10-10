// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Bounded, read-only user-file sessions. Paths never enter module responses or errors.
//! Windows sessions retain the opened file and directory handles with write/delete sharing
//! denied. Stable std does not expose Windows file IDs; metadata fingerprints supplement
//! those retained handles rather than claiming cryptographic file identity.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use deck_core::{DeckError, ErrorCode};

/// Maximum accepted input-file size: 512 MiB.
pub const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
/// Maximum bytes allocated and returned for a single read: 256 KiB.
pub const READ_CHUNK_BYTES: usize = 256 * 1024;

#[derive(Clone, PartialEq, Eq)]
struct FileStamp {
    size: u64,
    modified: SystemTime,
    created: Option<SystemTime>,
    #[cfg(windows)]
    attributes: u32,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    changed: (i64, i64),
}

impl FileStamp {
    fn new(metadata: &Metadata) -> Result<Self, DeckError> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt;
        Ok(Self {
            size: metadata.len(),
            modified: metadata.modified().map_err(map_io)?,
            created: metadata.created().ok(),
            #[cfg(windows)]
            attributes: metadata.file_attributes(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            #[cfg(unix)]
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }
}

struct ParentGuard {
    path: PathBuf,
    metadata: Metadata,
    // Keeping this handle alive prevents Windows ancestors from being renamed/replaced.
    file: File,
}

/// Retains validated directory handles from the filesystem root through one directory.
/// Paths are host-private; Windows write/delete sharing is denied for these directories.
pub struct DirectoryGuard {
    parents: Vec<ParentGuard>,
}

impl DirectoryGuard {
    /// Acquires an absolute ordinary directory and rejects every reparse ancestor.
    pub fn open(path: &Path) -> Result<Self, DeckError> {
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err(invalid());
        }
        let mut paths: Vec<&Path> = path.ancestors().collect();
        paths.reverse();
        let mut parents = Vec::with_capacity(paths.len());
        for ancestor in paths {
            if ancestor.as_os_str().is_empty() {
                continue;
            }
            let before = fs::symlink_metadata(ancestor).map_err(map_io)?;
            if is_link(&before) || !before.is_dir() {
                return Err(unsafe_target());
            }
            let file = open_parent(ancestor)?;
            let opened = file.metadata().map_err(map_io)?;
            let after = fs::symlink_metadata(ancestor).map_err(map_io)?;
            if is_link(&opened)
                || is_link(&after)
                || !opened.is_dir()
                || !after.is_dir()
                || !same_identity(&before, &opened)
                || !same_identity(&opened, &after)
            {
                return Err(changed());
            }
            parents.push(ParentGuard {
                path: ancestor.to_path_buf(),
                metadata: opened,
                file,
            });
        }
        let guard = Self { parents };
        guard.validate()?;
        Ok(guard)
    }

    /// Rechecks the retained handles and their original paths before an output operation.
    pub fn validate(&self) -> Result<(), DeckError> {
        for parent in &self.parents {
            let current = fs::symlink_metadata(&parent.path).map_err(map_io)?;
            let opened = parent.file.metadata().map_err(map_io)?;
            if is_link(&current)
                || is_link(&opened)
                || !current.is_dir()
                || !opened.is_dir()
                || !same_identity(&parent.metadata, &current)
                || !same_identity(&parent.metadata, &opened)
            {
                return Err(changed());
            }
        }
        Ok(())
    }
}

/// Compares regular-file metadata without exposing paths or file contents.
pub(crate) fn same_file_snapshot(left: &Metadata, right: &Metadata) -> Result<bool, DeckError> {
    Ok(!is_link(left)
        && !is_link(right)
        && left.is_file()
        && right.is_file()
        && FileStamp::new(left)? == FileStamp::new(right)?)
}

/// Conservative identity check used after closing our own writer updates its write time.
pub(crate) fn same_file_identity(left: &Metadata, right: &Metadata) -> bool {
    !is_link(left)
        && !is_link(right)
        && left.is_file()
        && right.is_file()
        && left.len() == right.len()
        && same_identity(left, right)
}

/// Host-owned read session. Drop it to release file and ancestor handles.
/// Do not derive Debug: this structure owns private paths and metadata.
pub struct FileReadSession {
    path: PathBuf,
    file: File,
    initial: FileStamp,
    parents: Vec<ParentGuard>,
}

impl FileReadSession {
    /// Opens a trusted, host-resolved absolute path without granting writes or following
    /// symlinks/reparse points. Lexical parent traversal and non-regular files are rejected.
    pub fn open(path: &Path) -> Result<Self, DeckError> {
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        {
            return Err(invalid());
        }
        let mut ancestors: Vec<&Path> = path.ancestors().skip(1).collect();
        ancestors.reverse();
        let mut parents = Vec::with_capacity(ancestors.len());
        for ancestor in ancestors {
            if ancestor.as_os_str().is_empty() {
                continue;
            }
            let before = fs::symlink_metadata(ancestor).map_err(map_io)?;
            if is_link(&before) || !before.is_dir() {
                return Err(unsafe_target());
            }
            let file = open_parent(ancestor)?;
            let opened = file.metadata().map_err(map_io)?;
            let after = fs::symlink_metadata(ancestor).map_err(map_io)?;
            if is_link(&opened)
                || is_link(&after)
                || !opened.is_dir()
                || !after.is_dir()
                || !same_identity(&before, &opened)
                || !same_identity(&opened, &after)
            {
                return Err(changed());
            }
            parents.push(ParentGuard {
                path: ancestor.to_path_buf(),
                metadata: opened,
                file,
            });
        }
        let before = fs::symlink_metadata(path).map_err(map_io)?;
        validate_regular(&before)?;
        let file = open_target(path)?;
        let opened = file.metadata().map_err(map_io)?;
        validate_regular(&opened)?;
        let after = fs::symlink_metadata(path).map_err(map_io)?;
        validate_regular(&after)?;
        let initial = FileStamp::new(&opened)?;
        if FileStamp::new(&before)? != initial || FileStamp::new(&after)? != initial {
            return Err(changed());
        }
        let session = Self {
            path: path.to_path_buf(),
            file,
            initial,
            parents,
        };
        session.validate()?;
        Ok(session)
    }

    /// Returns the immutable size captured when this session opened.
    pub fn size(&self) -> u64 {
        self.initial.size
    }

    /// Reads exactly the requested range with a bounded allocation. No partial result is
    /// returned if the file changes before or during a read. Empty reads at EOF are allowed.
    pub fn read_chunk(&mut self, offset: u64, length: usize) -> Result<Vec<u8>, DeckError> {
        if length > READ_CHUNK_BYTES || offset > self.initial.size {
            return Err(invalid());
        }
        let end = offset
            .checked_add(u64::try_from(length).map_err(|_| invalid())?)
            .ok_or_else(invalid)?;
        if end > self.initial.size {
            return Err(invalid());
        }
        self.validate()?;
        let mut bytes = vec![0; length];
        self.file.seek(SeekFrom::Start(offset)).map_err(map_io)?;
        self.file.read_exact(&mut bytes).map_err(map_io)?;
        self.validate()?;
        Ok(bytes)
    }

    fn validate(&self) -> Result<(), DeckError> {
        for parent in &self.parents {
            let current = fs::symlink_metadata(&parent.path).map_err(map_io)?;
            let opened = parent.file.metadata().map_err(map_io)?;
            if is_link(&current)
                || is_link(&opened)
                || !current.is_dir()
                || !opened.is_dir()
                || !same_identity(&parent.metadata, &current)
                || !same_identity(&parent.metadata, &opened)
            {
                return Err(changed());
            }
        }
        let current = fs::symlink_metadata(&self.path).map_err(map_io)?;
        let opened = self.file.metadata().map_err(map_io)?;
        if is_link(&current)
            || is_link(&opened)
            || !current.is_file()
            || !opened.is_file()
            || FileStamp::new(&current)? != self.initial
            || FileStamp::new(&opened)? != self.initial
        {
            return Err(changed());
        }
        Ok(())
    }
}

fn validate_regular(metadata: &Metadata) -> Result<(), DeckError> {
    if is_link(metadata) || !metadata.is_file() {
        return Err(unsafe_target());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(invalid());
    }
    Ok(())
}

fn is_link(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Covers symbolic links, junctions and every other reparse-point kind.
        metadata.file_attributes() & 0x0000_0400 != 0 || metadata.file_type().is_symlink()
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn same_identity(left: &Metadata, right: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        left.creation_time() == right.creation_time()
            && left.file_attributes() == right.file_attributes()
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        left.dev() == right.dev() && left.ino() == right.ino()
    }
    #[cfg(not(any(windows, unix)))]
    {
        left.created().ok() == right.created().ok() && left.is_dir() == right.is_dir()
    }
}

fn open_target(path: &Path) -> Result<File, DeckError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ only: denies writes, deletion and replacement for this session.
        options.share_mode(1).custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    options.open(path).map_err(map_io)
}

fn open_parent(path: &Path) -> Result<File, DeckError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // A read access request is required for Windows sharing checks: metadata-only
        // access_mode(0) does not reliably deny directory renames/replacement.
        // Directory writes must remain shareable for atomic child creation/hard links;
        // denying FILE_SHARE_DELETE still prevents renaming/replacing the directory.
        // FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT.
        options
            .share_mode(3)
            .custom_flags(0x0200_0000 | 0x0020_0000);
    }
    options.open(path).map_err(map_io)
}

fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "파일 크기나 읽기 범위를 확인해 주세요.",
    )
}
fn unsafe_target() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "연결 파일이나 폴더는 읽을 수 없어요. 일반 파일을 선택해 주세요.",
    )
}
fn changed() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "읽는 동안 파일 상태가 바뀌었어요. 파일을 다시 선택해 주세요.",
    )
}
fn map_io(error: io::Error) -> DeckError {
    #[cfg(windows)]
    if matches!(error.raw_os_error(), Some(32 | 33)) {
        return DeckError::new(
            ErrorCode::Busy,
            "파일을 다른 작업에서 사용 중이에요. 작업을 마친 뒤 다시 선택해 주세요.",
        );
    }
    match error.kind() {
        io::ErrorKind::NotFound => DeckError::new(
            ErrorCode::NotFound,
            "선택한 파일을 찾을 수 없어요. 파일을 다시 선택해 주세요.",
        ),
        io::ErrorKind::PermissionDenied => DeckError::new(
            ErrorCode::PermissionDenied,
            "파일을 읽을 권한이 없어요. 읽을 수 있는 파일을 선택해 주세요.",
        ),
        _ => DeckError::new(
            ErrorCode::Internal,
            "파일을 읽지 못했어요. 파일 상태를 확인하고 다시 선택해 주세요.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{OsRng, TempArea, TempDir};
    use deck_core::handles::{HANDLE_BYTES, RandomSource};

    fn fixture() -> TempDir {
        let mut nonce = [0u8; HANDLE_BYTES];
        OsRng.fill(&mut nonce);
        let suffix: String = nonce.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("deck-file-read-test-{suffix}"));
        let area = TempArea::init(root).unwrap();
        area.create_dir(&mut OsRng).unwrap()
    }

    #[test]
    fn reads_bounded_ranges_and_eof_from_one_open_file() {
        let temp = fixture();
        let path = temp.path().join("synthetic-input.bin");
        let bytes: Vec<u8> = (0..READ_CHUNK_BYTES + 17)
            .map(|n| (n % 251) as u8)
            .collect();
        fs::write(&path, &bytes).unwrap();
        let mut session = FileReadSession::open(&path).unwrap();
        assert_eq!(session.size(), bytes.len() as u64);
        assert_eq!(
            session.read_chunk(0, READ_CHUNK_BYTES).unwrap(),
            bytes[..READ_CHUNK_BYTES]
        );
        assert_eq!(
            session.read_chunk(READ_CHUNK_BYTES as u64, 17).unwrap(),
            bytes[READ_CHUNK_BYTES..]
        );
        assert!(session.read_chunk(session.size(), 0).unwrap().is_empty());
        assert_eq!(
            session
                .read_chunk(0, READ_CHUNK_BYTES + 1)
                .unwrap_err()
                .code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            session.read_chunk(u64::MAX, 1).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            session.read_chunk(session.size(), 1).unwrap_err().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }

    #[test]
    fn accepts_empty_file_and_rejects_missing_directory_and_relative_paths() {
        let temp = fixture();
        let path = temp.path().join("synthetic-empty.bin");
        fs::write(&path, []).unwrap();
        let mut session = FileReadSession::open(&path).unwrap();
        assert_eq!(session.size(), 0);
        assert!(session.read_chunk(0, 0).unwrap().is_empty());
        assert_eq!(
            FileReadSession::open(&temp.path().join("synthetic-missing.bin"))
                .err()
                .unwrap()
                .code,
            ErrorCode::NotFound
        );
        assert_eq!(
            FileReadSession::open(temp.path()).err().unwrap().code,
            ErrorCode::InvalidArgs
        );
        assert_eq!(
            FileReadSession::open(Path::new("synthetic-relative.bin"))
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgs
        );
    }

    #[test]
    fn rejects_oversized_file_without_allocating_it() {
        let temp = fixture();
        let path = temp.path().join("synthetic-large.bin");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_FILE_BYTES + 1).unwrap();
        drop(file);
        assert_eq!(
            FileReadSession::open(&path).err().unwrap().code,
            ErrorCode::InvalidArgs
        );
    }

    #[test]
    fn errors_do_not_expose_paths_or_names() {
        let temp = fixture();
        let path = temp.path().join("synthetic-secret-name.bin");
        let error = FileReadSession::open(&path).err().unwrap();
        assert!(!error.message.contains("synthetic-secret-name"));
        assert!(!error.message.contains(&path.display().to_string()));
        assert!(error.details.is_none());
    }

    #[cfg(windows)]
    #[test]
    fn windows_session_denies_writes_deletes_and_parent_replacement() {
        let temp = fixture();
        let path = temp.path().join("synthetic-locked.bin");
        fs::write(&path, b"abc").unwrap();
        let mut session = FileReadSession::open(&path).unwrap();
        assert!(OpenOptions::new().write(true).open(&path).is_err());
        assert!(fs::remove_file(&path).is_err());
        assert!(fs::rename(temp.path(), temp.path().with_extension("renamed")).is_err());
        assert_eq!(session.read_chunk(0, 3).unwrap(), b"abc");
        drop(session);
        assert!(OpenOptions::new().write(true).open(&path).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn windows_rejects_an_existing_writer_and_detects_attribute_changes() {
        let temp = fixture();
        let path = temp.path().join("synthetic-attributes.bin");
        fs::write(&path, b"abc").unwrap();
        let writer = OpenOptions::new().write(true).open(&path).unwrap();
        assert_eq!(
            FileReadSession::open(&path).err().unwrap().code,
            ErrorCode::Busy
        );
        drop(writer);
        let mut session = FileReadSession::open(&path).unwrap();
        let original = fs::metadata(&path).unwrap().permissions();
        let mut readonly = original.clone();
        readonly.set_readonly(true);
        // FILE_WRITE_ATTRIBUTES can remain available despite denied data-write sharing.
        fs::set_permissions(&path, readonly).unwrap();
        assert_eq!(
            session.read_chunk(0, 3).unwrap_err().code,
            ErrorCode::Internal
        );
        drop(session);
        fs::set_permissions(&path, original).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_rejects_junction_ancestors_without_administrator_privileges() {
        // Junction creation does not require the symlink privilege or Developer Mode.
        // All arguments are generated synthetic paths; no user input reaches the shell.
        let temp = fixture();
        let real = temp.path().join("synthetic-real");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("synthetic-file.bin"), b"abc").unwrap();
        let junction = temp.path().join("synthetic-junction");
        let status = std::process::Command::new("cmd")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&real)
            .output()
            .unwrap();
        assert!(status.status.success());
        assert!(is_link(&fs::symlink_metadata(&junction).unwrap()));
        assert_eq!(
            FileReadSession::open(&junction.join("synthetic-file.bin"))
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgs
        );
        // Remove only the test-owned junction; do not recursively traverse its target.
        fs::remove_dir(&junction).unwrap();
        assert_eq!(fs::read(real.join("synthetic-file.bin")).unwrap(), b"abc");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_target_and_ancestor_and_detects_changes() {
        use std::os::unix::fs::symlink;
        let temp = fixture();
        let real = temp.path().join("real");
        fs::create_dir(&real).unwrap();
        let path = real.join("synthetic-file.bin");
        fs::write(&path, b"abc").unwrap();
        let link = temp.path().join("link");
        symlink(&real, &link).unwrap();
        assert_eq!(
            FileReadSession::open(&link.join("synthetic-file.bin"))
                .err()
                .unwrap()
                .code,
            ErrorCode::InvalidArgs
        );
        let file_link = temp.path().join("synthetic-link.bin");
        symlink(&path, &file_link).unwrap();
        assert_eq!(
            FileReadSession::open(&file_link).err().unwrap().code,
            ErrorCode::InvalidArgs
        );
        let mut session = FileReadSession::open(&path).unwrap();
        fs::write(&path, b"xyz").unwrap();
        assert_eq!(
            session.read_chunk(0, 3).unwrap_err().code,
            ErrorCode::Internal
        );
        drop(session);
        let mut session = FileReadSession::open(&path).unwrap();
        fs::rename(&path, real.join("old.bin")).unwrap();
        fs::write(&path, b"xyz").unwrap();
        assert_eq!(
            session.read_chunk(0, 3).unwrap_err().code,
            ErrorCode::Internal
        );
    }
}
