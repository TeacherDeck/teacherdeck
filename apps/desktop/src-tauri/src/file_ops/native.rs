// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Approved by the user: docs/proposals/windows-ffi-boundary.md (2026-10-11).
#![allow(unsafe_code)]
//! Narrow safe boundary: stable file ID and opened-handle no-replace Windows rename.
use crate::file_read::DirectoryGuard;
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

/// Host-private filesystem identity and immutable content fingerprint.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fingerprint {
    /// Stable volume identifier.
    pub volume: u64,
    /// Stable 128-bit file identifier (not a pathname or creation-time approximation).
    pub id: [u8; 16],
    /// Original bytes.
    pub size: u64,
    /// Modification time; rename does not authorize content modification.
    pub modified: u128,
    /// SHA-256 of the entire file, streamed in bounded chunks.
    pub hash: String,
}
fn changed() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "파일이 변경되거나 다른 파일로 바뀌었어요. 원본을 보존했으니 다시 선택해 주세요.",
    )
}
fn io_error() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "파일을 안전하게 변경할 수 없어요. 다른 프로그램의 사용 여부와 권한을 확인해 주세요.",
    )
}
/// True for symlinks and every Windows reparse kind.
pub fn reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 || metadata.file_type().is_symlink()
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
/// Retains the exact file and all ordinary ancestors. No external write/delete sharing.
pub struct ProtectedFile {
    file: File,
    path: PathBuf,
    _parents: DirectoryGuard,
}
impl ProtectedFile {
    /// Acquires only an ordinary bounded file. Drop releases all native handles.
    pub fn open(path: &Path) -> Result<Self, DeckError> {
        let parent = path.parent().ok_or_else(changed)?;
        let parents = DirectoryGuard::open(parent)?;
        let before = fs::symlink_metadata(path).map_err(|_| io_error())?;
        if reparse(&before) || !before.is_file() || before.len() > 512 * 1024 * 1024 {
            return Err(changed());
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options
                .access_mode(0x8000_0000 | 0x0001_0000)
                .share_mode(1)
                .custom_flags(0x0020_0000);
        }
        let file = options.open(path).map_err(|_| io_error())?;
        let metadata = file.metadata().map_err(|_| io_error())?;
        if reparse(&metadata) || !metadata.is_file() {
            return Err(changed());
        }
        let locked = Self {
            file,
            path: path.into(),
            _parents: parents,
        };
        locked.validate_binding()?;
        Ok(locked)
    }
    fn validate_binding(&self) -> Result<(), DeckError> {
        self._parents.validate()?;
        let metadata = fs::symlink_metadata(&self.path).map_err(|_| changed())?;
        if reparse(&metadata) || !metadata.is_file() {
            return Err(changed());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Metadata-only access shares DELETE with our own DELETE handle without
            // requesting DELETE. The main handle still denies external replacement.
            let other = OpenOptions::new()
                .read(true)
                .access_mode(0)
                .share_mode(1 | 4)
                .custom_flags(0x0020_0000)
                .open(&self.path)
                .map_err(|_| changed())?;
            let ours = file_identity(&self.file)?;
            let actual = file_identity(&other)?;
            if ours != actual {
                return Err(changed());
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let opened = self.file.metadata().map_err(|_| changed())?;
            if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
                return Err(changed());
            }
        }
        Ok(())
    }
    /// Hashes the retained file and checks it did not change during the bounded read.
    pub fn fingerprint(&mut self) -> Result<Fingerprint, DeckError> {
        self.validate_binding()?;
        let before = self.file.metadata().map_err(|_| changed())?;
        let size = before.len();
        if size > 512 * 1024 * 1024 {
            return Err(changed());
        }
        let modified = before
            .modified()
            .map_err(|_| changed())?
            .duration_since(UNIX_EPOCH)
            .map_err(|_| changed())?
            .as_nanos();
        self.file.seek(SeekFrom::Start(0)).map_err(|_| io_error())?;
        let mut buffer = [0_u8; 65536];
        let mut digest = Sha256::new();
        let mut read = 0_u64;
        loop {
            let n = self.file.read(&mut buffer).map_err(|_| io_error())?;
            if n == 0 {
                break;
            }
            read += n as u64;
            if read > size {
                return Err(changed());
            }
            digest.update(buffer.get(..n).ok_or_else(changed)?);
        }
        let after = self.file.metadata().map_err(|_| changed())?;
        self.validate_binding()?;
        if read != size
            || after.len() != size
            || after.modified().map_err(|_| changed())?
                != before.modified().map_err(|_| changed())?
        {
            return Err(changed());
        }
        let (volume, id) = file_identity(&self.file)?;
        Ok(Fingerprint {
            volume,
            id,
            size,
            modified,
            hash: deck_core::util::to_hex(&digest.finalize()),
        })
    }
    /// Renames this exact open file within its existing parent, never replacing a target.
    pub fn rename_to(&mut self, destination: &Path) -> Result<(), DeckError> {
        if destination.parent() != self.path.parent()
            || !destination.file_name().is_some_and(|name| {
                name.to_str()
                    .is_some_and(deck_core::caps::file_ops::valid_target_name)
            })
        {
            return Err(changed());
        }
        self.validate_binding()?;
        #[cfg(windows)]
        {
            use std::{
                mem::{offset_of, size_of},
                os::windows::{ffi::OsStrExt, io::AsRawHandle},
            };
            use windows::Win32::{
                Foundation::HANDLE,
                Storage::FileSystem::{
                    FILE_RENAME_INFO, FILE_RENAME_INFO_0, FileRenameInfo,
                    SetFileInformationByHandle,
                },
            };
            let wide: Vec<u16> = destination.as_os_str().encode_wide().collect();
            if wide.is_empty() || wide.len() > 32760 || wide.contains(&0) {
                return Err(changed());
            }
            let offset = offset_of!(FILE_RENAME_INFO, FileName);
            let size = offset
                .checked_add((wide.len() + 1) * 2)
                .ok_or_else(changed)?
                .max(size_of::<FILE_RENAME_INFO>());
            // u64 storage provides at least FILE_RENAME_INFO's native 8-byte alignment,
            // including on 32-bit Windows, and a trailing initialized NUL WCHAR.
            // SetFileInformationByHandle converts full DOS paths before the NT call;
            // that conversion must never read past a length-aligned allocation.
            let mut storage = vec![0_u64; size.div_ceil(8)];
            let raw = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
            // SAFETY: storage is aligned, initialized and >= the fixed header + UTF-16
            // tail. The File owns a live DELETE-capable handle through the synchronous
            // call; ancestors remain locked. ReplaceIfExists=false guarantees that a
            // concurrent destination creation fails instead of replacing user data.
            unsafe {
                (*raw).Anonymous = FILE_RENAME_INFO_0 {
                    ReplaceIfExists: false,
                };
                (*raw).RootDirectory = HANDLE::default();
                (*raw).FileNameLength = u32::try_from(wide.len() * 2).map_err(|_| changed())?;
                std::ptr::copy_nonoverlapping(
                    wide.as_ptr(),
                    storage.as_mut_ptr().cast::<u8>().add(offset).cast::<u16>(),
                    wide.len(),
                );
                let renamed = SetFileInformationByHandle(
                    HANDLE(self.file.as_raw_handle()),
                    FileRenameInfo,
                    raw.cast(),
                    u32::try_from(size).map_err(|_| changed())?,
                );
                renamed.map_err(|_| io_error())?;
            }
            self.path = destination.into();
            self.validate_binding()?;
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Err(DeckError::new(
                ErrorCode::CapabilityUnavailable,
                "보호된 원본 이름 변경은 Windows에서 사용할 수 있어요.",
            ))
        }
    }
}
#[cfg(windows)]
fn file_identity(file: &File) -> Result<(u64, [u8; 16]), DeckError> {
    use std::{mem::size_of, os::windows::io::AsRawHandle};
    use windows::Win32::{
        Foundation::HANDLE,
        Storage::FileSystem::{FILE_ID_INFO, FileIdInfo, GetFileInformationByHandleEx},
    };
    let mut info = FILE_ID_INFO::default();
    // SAFETY: info is a properly aligned initialized FILE_ID_INFO with the exact
    // advertised size. The borrowed File owns the valid handle throughout the call.
    unsafe {
        GetFileInformationByHandleEx(
            HANDLE(file.as_raw_handle()),
            FileIdInfo,
            std::ptr::from_mut(&mut info).cast(),
            size_of::<FILE_ID_INFO>() as u32,
        )
        .map_err(|_| io_error())?;
    }
    Ok((info.VolumeSerialNumber, info.FileId.Identifier))
}
#[cfg(unix)]
fn file_identity(file: &File) -> Result<(u64, [u8; 16]), DeckError> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(|_| io_error())?;
    let mut id = [0; 16];
    id.get_mut(..8)
        .ok_or_else(changed)?
        .copy_from_slice(&metadata.ino().to_le_bytes());
    Ok((metadata.dev(), id))
}
#[cfg(not(any(windows, unix)))]
fn file_identity(_file: &File) -> Result<(u64, [u8; 16]), DeckError> {
    Err(changed())
}
