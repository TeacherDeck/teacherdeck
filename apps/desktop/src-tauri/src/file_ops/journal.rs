// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Append/sync operation journal. No original content is stored or logged.
use super::native::Fingerprint;
use crate::file_read::{DirectoryGuard, FileReadSession};
use deck_core::{
    DeckError, ErrorCode,
    caps::file_ops::{RenameHistoryState, RenameStatus},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

pub const MAX_JOURNAL: u64 = 16 * 1024 * 1024;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Place {
    Old,
    Temporary,
    New,
    Restored,
    Blocked,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub source: String,
    pub parent: PathBuf,
    pub old: String,
    pub new: String,
    pub temporary: String,
    pub stamp: Fingerprint,
    pub place: Place,
    pub status: RenameStatus,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub version: u8,
    pub owner: String,
    pub handle: String,
    pub created: u64,
    pub items: Vec<Item>,
    pub groups: Vec<Vec<usize>>,
    pub next: usize,
    pub undo_next: usize,
    pub state: RenameHistoryState,
    pub intent: Option<(usize, bool)>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Event {
    Start(Record),
    Intent {
        group: usize,
        undo: bool,
    },
    Moved {
        index: usize,
        place: Place,
    },
    GroupDone {
        group: usize,
        undo: bool,
        status: RenameStatus,
    },
    State(RenameHistoryState),
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    previous: String,
    payload: Event,
    sha256: String,
}
fn error() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "변경 이력을 안전하게 읽거나 기록할 수 없어요. 원본 파일을 보존했으니 이력 상태를 확인해 주세요.",
    )
}
pub fn path(root: &Path, handle: &str) -> Result<PathBuf, DeckError> {
    if handle.len() != 32 || !handle.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(error());
    }
    Ok(root.join(format!("{handle}.jsonl")))
}
fn digest(previous: &str, event: &Event) -> Result<String, DeckError> {
    let mut bytes = previous.as_bytes().to_vec();
    bytes.extend(serde_json::to_vec(event).map_err(|_| error())?);
    Ok(deck_core::util::sha256_hex(&bytes))
}
/// Persists one intent/result before returning control to the operation engine.
pub fn append(
    root: &Path,
    handle: &str,
    previous: &mut String,
    event: Event,
    first: bool,
) -> Result<(), DeckError> {
    let guard = DirectoryGuard::open(root)?;
    guard.validate()?;
    let pathname = path(root, handle)?;
    let sha256 = digest(previous, &event)?;
    let mut bytes = serde_json::to_vec(&Envelope {
        previous: previous.clone(),
        payload: event,
        sha256: sha256.clone(),
    })
    .map_err(|_| error())?;
    bytes.push(b'\n');
    let mut options = OpenOptions::new();
    options.append(true);
    if first {
        options.create_new(true);
    } else {
        let meta = fs::symlink_metadata(&pathname).map_err(|_| error())?;
        if super::native::reparse(&meta)
            || !meta.is_file()
            || meta.len() + bytes.len() as u64 > MAX_JOURNAL
        {
            return Err(error());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x0020_0000);
    }
    let mut file = options.open(pathname).map_err(|_| error())?;
    if file.metadata().map_err(|_| error())?.len() + bytes.len() as u64 > MAX_JOURNAL {
        return Err(error());
    }
    file.write_all(&bytes).map_err(|_| error())?;
    file.sync_all().map_err(|_| error())?;
    guard.validate()?;
    *previous = sha256;
    Ok(())
}
/// Loads only fully validated lines. Partial/tampered records lock operations.
pub fn load(root: &Path, handle: &str) -> Result<(Record, String), DeckError> {
    let pathname = path(root, handle)?;
    let mut file = FileReadSession::open(&pathname)?;
    if file.size() == 0 || file.size() > MAX_JOURNAL {
        return Err(error());
    }
    let mut bytes = Vec::new();
    let mut offset = 0;
    while offset < file.size() {
        let length = (file.size() - offset).min(256 * 1024) as usize;
        bytes.extend(file.read_chunk(offset, length)?);
        offset += length as u64;
    }
    if bytes.last() != Some(&b'\n') {
        return Err(error());
    }
    let mut previous = String::new();
    let mut record: Option<Record> = None;
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        let envelope: Envelope = serde_json::from_slice(line).map_err(|_| error())?;
        if envelope.previous != previous || envelope.sha256 != digest(&previous, &envelope.payload)?
        {
            return Err(error());
        }
        previous = envelope.sha256;
        match envelope.payload {
            Event::Start(start) => {
                if record.is_some()
                    || start.version != 1
                    || start.handle != handle
                    || !deck_core::util::is_valid_module_id(&start.owner)
                    || start.items.is_empty()
                    || start.items.len() > 2000
                    || start.next != 0
                    || start.undo_next != 0
                {
                    return Err(error());
                }
                validate_record(&start)?;
                record = Some(start);
            }
            event => apply(record.as_mut().ok_or_else(error)?, event)?,
        }
    }
    Ok((record.ok_or_else(error)?, previous))
}
fn validate_record(record: &Record) -> Result<(), DeckError> {
    let mut seen = std::collections::HashSet::new();
    for group in &record.groups {
        if group.is_empty() {
            return Err(error());
        }
        for index in group {
            if !seen.insert(*index) || *index >= record.items.len() {
                return Err(error());
            }
        }
    }
    for item in &record.items {
        if !item.parent.is_absolute()
            || !deck_core::caps::file_ops::valid_target_name(&item.old)
            || !deck_core::caps::file_ops::valid_target_name(&item.new)
            || !item.temporary.starts_with(".deck-rename-")
            || !deck_core::caps::file_ops::valid_target_name(&item.temporary)
            || !deck_core::util::is_sha256_hex(&item.stamp.hash)
        {
            return Err(error());
        }
    }
    Ok(())
}
pub fn apply(record: &mut Record, event: Event) -> Result<(), DeckError> {
    match event {
        Event::Start(_) => return Err(error()),
        Event::Intent { group, undo } => {
            if group >= record.groups.len() {
                return Err(error());
            }
            record.intent = Some((group, undo));
        }
        Event::Moved { index, place } => {
            record.items.get_mut(index).ok_or_else(error)?.place = place
        }
        Event::GroupDone {
            group,
            undo,
            status,
        } => {
            for index in record.groups.get(group).ok_or_else(error)? {
                let item = record.items.get_mut(*index).ok_or_else(error)?;
                if !undo {
                    item.status = status.clone();
                } else if status != RenameStatus::Success {
                    item.place = Place::Blocked;
                }
            }
            if undo {
                record.undo_next = group + 1;
            } else {
                record.next = group + 1;
            }
            record.intent = None;
        }
        Event::State(state) => record.state = state,
    }
    Ok(())
}
