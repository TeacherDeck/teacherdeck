// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded, owner/session-bound directory snapshots (fs1.3 / ADR-0019).
use crate::{
    file_read::DirectoryGuard,
    platform::OsRng,
    state::{AppState, FileHandleKind},
};
use deck_core::{
    DeckError, ErrorCode,
    caps::fs::{FilesPage, ListFilesArgs},
    handles::{HANDLE_BYTES, RandomSource},
};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

struct Snapshot {
    owner: String,
    generation: u64,
    folder: String,
    recursive: bool,
    paths: Vec<PathBuf>,
    offset: usize,
    created: Instant,
}
/// Host-private cursors; neither path nor filename is a cursor.
#[derive(Default)]
pub struct FolderListings {
    snapshots: HashMap<String, Snapshot>,
}
impl FolderListings {
    /// Removes owner-private cursors without touching user files.
    pub fn unload(&mut self, owner: &str) {
        self.snapshots.retain(|_, snapshot| snapshot.owner != owner);
    }
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "폴더 목록 조건이나 한도를 확인해 주세요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "폴더가 바뀌었거나 연결 파일을 포함해요. 일반 폴더를 다시 선택해 주세요.",
    )
}
fn token() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    OsRng.fill(&mut bytes);
    deck_core::util::to_hex(&bytes)
}
fn link(path: &Path) -> Result<bool, DeckError> {
    let meta = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        Ok(meta.file_attributes() & 0x400 != 0 || meta.file_type().is_symlink())
    }
    #[cfg(not(windows))]
    {
        Ok(meta.file_type().is_symlink())
    }
}
fn enumerate(root: &Path, recursive: bool) -> Result<Vec<PathBuf>, DeckError> {
    let mut todo = vec![(root.to_path_buf(), 0)];
    let mut paths = Vec::new();
    let mut directories = 0;
    while let Some((folder, depth)) = todo.pop() {
        if depth > 32 || directories >= 4096 {
            return Err(invalid());
        }
        directories += 1;
        let guard = DirectoryGuard::open(&folder)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(&folder).map_err(|_| unavailable())? {
            if entries.len() >= 8192 {
                return Err(invalid());
            }
            entries.push(entry.map_err(|_| unavailable())?);
        }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            if link(&path)? {
                return Err(unavailable());
            }
            let kind = entry.file_type().map_err(|_| unavailable())?;
            if kind.is_file() {
                paths.push(path);
                if paths.len() > 2000 {
                    return Err(invalid());
                }
            } else if recursive && kind.is_dir() {
                if todo.len() + directories >= 4096 {
                    return Err(invalid());
                }
                todo.push((path, depth + 1));
            }
            guard.validate()?;
        }
    }
    paths.sort();
    Ok(paths)
}
/// Validates all handles outside this service and issues each page from a fixed snapshot.
pub fn list(
    state: &AppState,
    owner: &str,
    generation: u64,
    args: ListFilesArgs,
) -> Result<FilesPage, DeckError> {
    let limit = args.limit.unwrap_or(128);
    if limit == 0 || limit > 128 {
        return Err(invalid());
    }
    let root = crate::caps::fs::resolve(
        state,
        owner,
        &args.folder_handle,
        generation,
        Some(FileHandleKind::OutputParent),
    )?;
    let guard = DirectoryGuard::open(&root)?;
    let mut listings = state.folder_listings.lock().map_err(|_| unavailable())?;
    listings
        .snapshots
        .retain(|_, snapshot| snapshot.created.elapsed() < Duration::from_secs(300));
    let cursor = if let Some(cursor) = args.cursor {
        cursor
    } else {
        if listings
            .snapshots
            .values()
            .filter(|snapshot| snapshot.owner == owner)
            .count()
            >= 8
        {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "폴더 목록이 많아요. 잠시 후 다시 읽어 주세요.",
            ));
        }
        let paths = enumerate(&root, args.recursive)?;
        let cursor = token();
        listings.snapshots.insert(
            cursor.clone(),
            Snapshot {
                owner: owner.into(),
                generation,
                folder: args.folder_handle.clone(),
                recursive: args.recursive,
                paths,
                offset: 0,
                created: Instant::now(),
            },
        );
        cursor
    };
    let snapshot = listings.snapshots.get_mut(&cursor).ok_or_else(invalid)?;
    if snapshot.owner != owner
        || snapshot.generation != generation
        || snapshot.folder != args.folder_handle
        || snapshot.recursive != args.recursive
    {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "이 폴더 목록 권한을 사용할 수 없어요.",
        ));
    }
    let end = (snapshot.offset + limit as usize).min(snapshot.paths.len());
    let mut files = Vec::new();
    for path in snapshot
        .paths
        .get(snapshot.offset..end)
        .ok_or_else(invalid)?
    {
        guard.validate()?;
        if link(path)? || !path.starts_with(&root) {
            return Err(unavailable());
        }
        // A read session verifies ordinary descendants and every ancestor before issuing.
        let _read = crate::file_read::FileReadSession::open(path)?;
        let handle = crate::caps::fs::issue(
            state,
            owner,
            path.clone(),
            FileHandleKind::ReadFile,
            generation,
        )?;
        files.push(crate::caps::fs::file_info(handle, path).map_err(|_| unavailable())?);
    }
    snapshot.offset = end;
    let done = end == snapshot.paths.len();
    if done {
        listings.snapshots.remove(&cursor);
    }
    Ok(FilesPage {
        files,
        next_cursor: (!done).then_some(cursor),
    })
}

#[cfg(test)]
pub(crate) fn enumerate_for_tests(root: &Path, recursive: bool) -> Result<Vec<PathBuf>, DeckError> {
    enumerate(root, recursive)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn enumeration_is_bounded_and_top_level_by_default() {
        let root = std::env::temp_dir().join(format!("deck-list-test-{}", token()));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("one.txt"), b"one").unwrap();
        fs::write(root.join("sub/two.txt"), b"two").unwrap();
        assert_eq!(enumerate(&root, false).unwrap().len(), 1);
        assert_eq!(enumerate(&root, true).unwrap().len(), 2);
        for n in 0..2000 {
            fs::write(root.join(format!("synthetic-{n}.txt")), b"x").unwrap();
        }
        assert!(enumerate(&root, false).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_are_rejected() {
        let root = std::env::temp_dir().join(format!("deck-list-test-{}", token()));
        fs::create_dir(&root).unwrap();
        std::os::unix::fs::symlink("missing", root.join("link")).unwrap();
        assert!(enumerate(&root, false).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
