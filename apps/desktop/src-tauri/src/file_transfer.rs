// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Session-scoped file grants. No user paths or tokens are logged.

#[cfg(test)]
#[path = "file_transfer_tests.rs"]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use deck_core::caps::fs::{FileRead, FileWrite};
use deck_core::handles::{HANDLE_BYTES, RandomSource};
use deck_core::{DeckError, ErrorCode};

use crate::file_output::{FileWriteSession, OutputBatch};
use crate::file_read::{FileReadSession, MAX_FILE_BYTES, READ_CHUNK_BYTES};
use crate::origins::module_origin;
use crate::platform::{OsRng, TempArea};

const IDLE_LIMIT: Duration = Duration::from_secs(300);
const MAX_BATCH_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_BATCH_FILES: usize = 2000;

struct Grant<T> {
    owner: String,
    generation: u64,
    touched: Instant,
    value: T,
}

struct Batch {
    output: OutputBatch,
    files: usize,
    bytes: u64,
}

struct Write {
    session: FileWriteSession,
    batch: String,
    committed: Option<PathBuf>,
}

/// Host-only store; accessed under AppState's mutex. Each write/commit/abort is serialized.
#[derive(Default)]
pub struct FileTransfers {
    generations: HashMap<String, u64>,
    reads: HashMap<String, Grant<FileReadSession>>,
    batches: HashMap<String, Grant<Batch>>,
    writes: HashMap<String, Grant<Write>>,
}

impl FileTransfers {
    /// Generation used to reject work that finishes after its iframe was unloaded.
    pub fn generation(&self, owner: &str) -> u64 {
        self.generations.get(owner).copied().unwrap_or(0)
    }

    /// Removes only grants and their host-owned unfinished files; completed results remain.
    pub fn unload(&mut self, owner: &str) {
        let next = self.generation(owner).saturating_add(1);
        self.generations.insert(owner.to_owned(), next);
        self.writes.retain(|_, v| v.owner != owner);
        self.reads.retain(|_, v| v.owner != owner);
        self.batches.retain(|_, v| v.owner != owner);
    }

    /// Expires idle grants. Called on access and by the host's periodic cleanup.
    pub fn expire(&mut self) {
        let now = Instant::now();
        self.reads
            .retain(|_, v| now.duration_since(v.touched) < IDLE_LIMIT);
        self.writes
            .retain(|_, v| now.duration_since(v.touched) < IDLE_LIMIT);
        self.batches
            .retain(|_, v| now.duration_since(v.touched) < IDLE_LIMIT);
        self.writes
            .retain(|_, v| self.batches.contains_key(&v.value.batch));
    }

    fn ready(&mut self, owner: &str, generation: u64) -> Result<(), DeckError> {
        self.expire();
        if self.generation(owner) != generation {
            return Err(denied());
        }
        Ok(())
    }

    fn token(&self) -> String {
        loop {
            let mut bytes = [0u8; HANDLE_BYTES];
            OsRng.fill(&mut bytes);
            let id = deck_core::util::to_hex(&bytes);
            if !self.reads.contains_key(&id)
                && !self.writes.contains_key(&id)
                && !self.batches.contains_key(&id)
            {
                return id;
            }
        }
    }

    /// Opens a fixed read-only source under an already validated file handle.
    pub fn open_read(
        &mut self,
        owner: &str,
        generation: u64,
        path: &Path,
    ) -> Result<FileRead, DeckError> {
        self.ready(owner, generation)?;
        if self.reads.values().filter(|v| v.owner == owner).count() >= 4 {
            return Err(busy());
        }
        let session = FileReadSession::open(path)?;
        let read_id = self.token();
        let result = FileRead {
            read_id: read_id.clone(),
            size: session.size(),
            chunk_bytes: READ_CHUNK_BYTES,
            url: format!("{}/_resources/{read_id}", module_origin(owner)),
        };
        self.reads
            .insert(read_id, grant(owner, generation, session));
        Ok(result)
    }

    /// Reads one bounded chunk; request authority supplies owner, never a query field.
    pub fn read(
        &mut self,
        owner: &str,
        id: &str,
        offset: u64,
        length: usize,
    ) -> Result<Vec<u8>, DeckError> {
        self.expire();
        let generation = self.generation(owner);
        let slot = self.reads.get_mut(id).ok_or_else(missing)?;
        check(slot, owner, generation)?;
        slot.touched = Instant::now();
        slot.value.read_chunk(offset, length)
    }

    /// Closes only the caller's read grant. Unknown/expired ids are harmless.
    pub fn close_read(&mut self, owner: &str, generation: u64, id: &str) -> Result<(), DeckError> {
        self.ready(owner, generation)?;
        if let Some(slot) = self.reads.get(id) {
            check(slot, owner, generation)?;
        }
        self.reads.remove(id);
        Ok(())
    }

    /// Creates an output folder and returns its opaque batch and host-private path.
    pub fn create_output(
        &mut self,
        owner: &str,
        generation: u64,
        parent: &Path,
        name: &str,
    ) -> Result<(String, PathBuf), DeckError> {
        self.ready(owner, generation)?;
        if self.batches.values().filter(|v| v.owner == owner).count() >= 4 {
            return Err(busy());
        }
        let output = OutputBatch::create(parent, name)?;
        let path = output.folder_path().to_path_buf();
        let id = self.token();
        self.batches.insert(
            id.clone(),
            grant(
                owner,
                generation,
                Batch {
                    output,
                    files: 0,
                    bytes: 0,
                },
            ),
        );
        Ok((id, path))
    }

    /// Reserves one new output. Reservations count toward batch limits even when aborted.
    pub fn begin_write(
        &mut self,
        owner: &str,
        generation: u64,
        batch_id: &str,
        name: &str,
        size: u64,
        temp: &TempArea,
    ) -> Result<FileWrite, DeckError> {
        self.ready(owner, generation)?;
        if self
            .writes
            .values()
            .filter(|v| v.value.committed.is_none())
            .count()
            >= 2
            || self
                .writes
                .values()
                .any(|v| v.owner == owner && v.value.committed.is_none())
        {
            return Err(busy());
        }
        let batch = self.batches.get_mut(batch_id).ok_or_else(missing)?;
        check(batch, owner, generation)?;
        if size > MAX_FILE_BYTES
            || batch.value.files >= MAX_BATCH_FILES
            || batch
                .value
                .bytes
                .checked_add(size)
                .is_none_or(|v| v > MAX_BATCH_BYTES)
        {
            return Err(invalid());
        }
        let session = batch.value.output.begin(name, size, temp)?;
        batch.value.files += 1;
        batch.value.bytes += size;
        batch.touched = Instant::now();
        let write_id = self.token();
        self.writes.insert(
            write_id.clone(),
            grant(
                owner,
                generation,
                Write {
                    session,
                    batch: batch_id.to_owned(),
                    committed: None,
                },
            ),
        );
        Ok(FileWrite {
            write_id,
            chunk_bytes: 65536,
        })
    }

    /// Appends one sequential chunk, preserving the backend's identical retry contract.
    pub fn write(
        &mut self,
        owner: &str,
        generation: u64,
        id: &str,
        offset: u64,
        data: &[u8],
    ) -> Result<u64, DeckError> {
        self.ready(owner, generation)?;
        let slot = self.writes.get_mut(id).ok_or_else(missing)?;
        check(slot, owner, generation)?;
        if slot.value.committed.is_some() {
            return Err(invalid());
        }
        let next = slot.value.session.append(offset, data)?;
        slot.touched = Instant::now();
        if let Some(batch) = self.batches.get_mut(&slot.value.batch) {
            batch.touched = slot.touched;
        }
        Ok(next)
    }

    /// Publishes once; repeating a successful commit returns its same path.
    pub fn commit(&mut self, owner: &str, generation: u64, id: &str) -> Result<PathBuf, DeckError> {
        self.ready(owner, generation)?;
        let slot = self.writes.get_mut(id).ok_or_else(missing)?;
        check(slot, owner, generation)?;
        let path = match &slot.value.committed {
            Some(path) => path.clone(),
            None => slot.value.session.commit()?,
        };
        slot.value.committed = Some(path.clone());
        slot.touched = Instant::now();
        if let Some(batch) = self.batches.get_mut(&slot.value.batch) {
            batch.touched = slot.touched;
        }
        Ok(path)
    }

    /// Aborts pending bytes; successful publication is never undone.
    pub fn abort(&mut self, owner: &str, generation: u64, id: &str) -> Result<(), DeckError> {
        self.ready(owner, generation)?;
        if let Some(slot) = self.writes.get_mut(id) {
            check(slot, owner, generation)?;
            slot.value.session.abort()?;
        }
        self.writes.remove(id);
        Ok(())
    }

    /// Closes a batch and its unfinished writes, leaving every completed result intact.
    pub fn close_output(
        &mut self,
        owner: &str,
        generation: u64,
        id: &str,
    ) -> Result<(), DeckError> {
        self.ready(owner, generation)?;
        if let Some(batch) = self.batches.get(id) {
            check(batch, owner, generation)?;
        }
        self.writes.retain(|_, v| v.value.batch != id);
        self.batches.remove(id);
        Ok(())
    }
}

fn grant<T>(owner: &str, generation: u64, value: T) -> Grant<T> {
    Grant {
        owner: owner.to_owned(),
        generation,
        touched: Instant::now(),
        value,
    }
}

fn check<T>(slot: &Grant<T>, owner: &str, generation: u64) -> Result<(), DeckError> {
    if slot.owner != owner || slot.generation != generation {
        Err(denied())
    } else {
        Ok(())
    }
}

fn denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 도구가 사용할 수 있는 파일 작업이 아니에요.",
    )
}
fn missing() -> DeckError {
    DeckError::new(
        ErrorCode::NotFound,
        "파일 작업이 닫혔거나 만료됐어요. 다시 시작해 주세요.",
    )
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "진행 중인 파일 작업을 마친 뒤 다시 시도해 주세요.",
    )
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "파일 작업의 크기나 순서를 확인해 주세요.",
    )
}
