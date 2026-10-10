// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Private bounded recovery ledger. Unknown or inconsistent leftovers are preserved.

use super::*;
use serde::{Deserialize, Serialize};
use std::time::UNIX_EPOCH;

const JOURNAL_LIMIT: u64 = 1024 * 1024;
const JOURNAL_NAME: &str = "output-journal.json";
const CHECKPOINT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Stamp {
    created: u128,
    #[cfg(windows)]
    attributes: u32,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}
impl Stamp {
    fn capture(metadata: &Metadata) -> Result<Self, DeckError> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt;
        Ok(Self {
            created: metadata
                .created()
                .map_err(map_io)?
                .duration_since(UNIX_EPOCH)
                .map_err(|_| changed())?
                .as_nanos(),
            #[cfg(windows)]
            attributes: metadata.file_attributes(),
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
        })
    }
    fn matches(&self, metadata: &Metadata) -> bool {
        let Ok(current) = Self::capture(metadata) else {
            return false;
        };
        self.created == current.created && {
            #[cfg(windows)]
            {
                self.attributes == current.attributes
            }
            #[cfg(unix)]
            {
                self.device == current.device && self.inode == current.inode
            }
            #[cfg(not(any(windows, unix)))]
            {
                true
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StageRecord {
    path: PathBuf,
    stamp: Stamp,
    parent_stamp: Stamp,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    directory_stamp: Stamp,
    source_stamp: Stamp,
    length: u64,
    full_blocks: Vec<String>,
    tail_hash: String,
    stage: Option<StageRecord>,
}

pub(super) struct Journal {
    file: OwnedFile,
    record: Record,
    tail: Vec<u8>,
    checkpoint_length: u64,
}
impl Journal {
    pub(super) fn create(source: &OwnedFile) -> Result<Self, DeckError> {
        let parent = source.path.parent().ok_or_else(invalid)?;
        let record = Record {
            version: 1,
            directory_stamp: Stamp::capture(&fs::symlink_metadata(parent).map_err(map_io)?)?,
            source_stamp: Stamp::capture(&source.metadata)?,
            length: 0,
            full_blocks: Vec::new(),
            tail_hash: deck_core::util::sha256_hex(&[]),
            stage: None,
        };
        let mut file = OwnedFile::create(parent.join(JOURNAL_NAME), Arc::clone(&source.guard))?;
        // Uncertain source/stage cleanup retains its ledger for later conservative recovery.
        file.remove_on_drop = false;
        let mut journal = Self {
            file,
            record,
            tail: Vec::with_capacity(WRITE_CHUNK_BYTES),
            checkpoint_length: 0,
        };
        journal.persist()?;
        Ok(journal)
    }
    pub(super) fn append(&mut self, data: &[u8]) -> Result<(), DeckError> {
        let mut pending = data;
        while !pending.is_empty() {
            let count = (WRITE_CHUNK_BYTES - self.tail.len()).min(pending.len());
            self.tail
                .extend_from_slice(pending.get(..count).ok_or_else(invalid)?);
            pending = pending.get(count..).ok_or_else(invalid)?;
            if self.tail.len() == WRITE_CHUNK_BYTES {
                self.record
                    .full_blocks
                    .push(deck_core::util::sha256_hex(&self.tail));
                self.tail.clear();
            }
        }
        self.record.length += data.len() as u64;
        if self.record.length - self.checkpoint_length >= CHECKPOINT_BYTES {
            self.persist()
        } else {
            Ok(())
        }
    }
    pub(super) fn stage(&mut self, stage: &OwnedFile) -> Result<(), DeckError> {
        self.record.stage = Some(StageRecord {
            path: stage.path.clone(),
            stamp: Stamp::capture(&stage.metadata)?,
            parent_stamp: Stamp::capture(
                &fs::symlink_metadata(stage.path.parent().ok_or_else(invalid)?).map_err(map_io)?,
            )?,
        });
        self.persist()
    }
    fn persist(&mut self) -> Result<(), DeckError> {
        self.file.validate()?;
        self.record.tail_hash = deck_core::util::sha256_hex(&self.tail);
        let bytes = serde_json::to_vec(&self.record).map_err(|_| changed())?;
        if bytes.len() as u64 > JOURNAL_LIMIT {
            return Err(invalid());
        }
        self.file.seek_start()?;
        self.file
            .file
            .as_mut()
            .ok_or_else(cancelled)?
            .set_len(0)
            .map_err(map_io)?;
        self.file.refresh()?;
        self.file.write_all(&bytes)?;
        self.file.flush()?;
        self.checkpoint_length = self.record.length;
        Ok(())
    }
    pub(super) fn checkpoint(&mut self) -> Result<(), DeckError> {
        self.persist()
    }
    pub(super) fn remove(&mut self) -> Result<(), DeckError> {
        self.file.remove_if_owned()
    }
}

/// Recovers verified unfinished output files; unknown, corrupt, or changed entries remain.
/// No final output path is ever a cleanup target. Scanning is bounded to 10,000 entries.
pub(super) fn recover_area(temp: &TempArea) -> Result<(), DeckError> {
    let root_guard = DirectoryGuard::open(temp.root())?;
    for entry in fs::read_dir(temp.root())
        .map_err(map_io)?
        .take(NAME_ATTEMPTS)
    {
        root_guard.validate()?;
        let Ok(entry) = entry else {
            continue;
        };
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.len() != HANDLE_BYTES * 2 || !name.bytes().all(|value| value.is_ascii_hexdigit()) {
            continue;
        }
        let _ = recover_one(&entry.path());
    }
    Ok(())
}

fn recover_one(directory: &Path) -> Result<(), DeckError> {
    let guard = Arc::new(DirectoryGuard::open(directory)?);
    let journal_metadata = fs::symlink_metadata(directory.join(JOURNAL_NAME)).map_err(map_io)?;
    let mut ledger = crate::file_read::FileReadSession::open(&directory.join(JOURNAL_NAME))?;
    if ledger.size() > JOURNAL_LIMIT {
        return Err(invalid());
    }
    let mut bytes = Vec::with_capacity(ledger.size() as usize);
    while (bytes.len() as u64) < ledger.size() {
        let count = (ledger.size() - bytes.len() as u64)
            .min(crate::file_read::READ_CHUNK_BYTES as u64) as usize;
        bytes.extend(ledger.read_chunk(bytes.len() as u64, count)?);
    }
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| changed())?;
    if record.version != 1
        || record.length > MAX_FILE_BYTES
        || record.full_blocks.len() != (record.length / WRITE_CHUNK_BYTES as u64) as usize
        || !record
            .full_blocks
            .iter()
            .chain(std::iter::once(&record.tail_hash))
            .all(|hash| hash.len() == 64 && hash.bytes().all(|value| value.is_ascii_hexdigit()))
        || !record
            .directory_stamp
            .matches(&fs::symlink_metadata(directory).map_err(map_io)?)
    {
        return Err(changed());
    }
    let source_path = directory.join("input.part");
    let source_metadata = fs::symlink_metadata(&source_path).map_err(map_io)?;
    if source_metadata.len() != record.length || !record.source_stamp.matches(&source_metadata) {
        return Err(changed());
    }
    let mut source = crate::file_read::FileReadSession::open(&source_path)?;
    let mut offset = 0u64;
    for expected in &record.full_blocks {
        let block = source.read_chunk(offset, WRITE_CHUNK_BYTES)?;
        if block.len() != WRITE_CHUNK_BYTES || deck_core::util::sha256_hex(&block) != *expected {
            return Err(changed());
        }
        offset += WRITE_CHUNK_BYTES as u64;
    }
    let tail = source.read_chunk(offset, (record.length - offset) as usize)?;
    if deck_core::util::sha256_hex(&tail) != record.tail_hash {
        return Err(changed());
    }
    if let Some(stage) = &record.stage {
        let name = stage
            .path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(changed)?;
        let suffix = name
            .strip_prefix(".deck-stage-")
            .and_then(|value| value.strip_suffix(".part"))
            .ok_or_else(changed)?;
        if suffix.len() != HANDLE_BYTES * 2
            || !suffix.bytes().all(|value| value.is_ascii_hexdigit())
        {
            return Err(changed());
        }
        let parent = stage.path.parent().ok_or_else(changed)?;
        let stage_guard = DirectoryGuard::open(parent)?;
        if !stage
            .parent_stamp
            .matches(&fs::symlink_metadata(parent).map_err(map_io)?)
        {
            return Err(changed());
        }
        let metadata = match fs::symlink_metadata(&stage.path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(map_io(error)),
        };
        // The stage may already have been cleaned after publication. Its final
        // destination is deliberately absent from the recovery ledger and never deleted.
        if let Some(metadata) = metadata {
            if !stage.stamp.matches(&metadata) || metadata.len() > record.length {
                return Err(changed());
            }
            let mut reader = crate::file_read::FileReadSession::open(&stage.path)?;
            let mut position = 0u64;
            while position < reader.size() {
                let count = (reader.size() - position).min(WRITE_CHUNK_BYTES as u64) as usize;
                let block = reader.read_chunk(position, count)?;
                let input = source.read_chunk(position, block.len())?;
                if block != input {
                    return Err(changed());
                }
                position += block.len() as u64;
            }
            drop(reader);
            stage_guard.validate()?;
            remove_verified(&stage.path, &metadata)?;
        }
    }
    drop(source);
    guard.validate()?;
    remove_verified(&source_path, &source_metadata)?;
    drop(ledger);
    remove_verified(&directory.join(JOURNAL_NAME), &journal_metadata)?;
    drop(guard);
    // Foreign additions prevent removing the directory; there is no recursive deletion.
    let _ = fs::remove_dir(directory);
    Ok(())
}

fn remove_verified(path: &Path, metadata: &Metadata) -> Result<(), DeckError> {
    let current = fs::symlink_metadata(path).map_err(map_io)?;
    if !same_file_snapshot(metadata, &current)? {
        return Err(changed());
    }
    fs::remove_file(path).map_err(map_io)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        area: TempArea,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("deck-recovery-{}", random_suffix()));
            fs::create_dir(&root).unwrap();
            let area = TempArea::init_preserving(root.join("work")).unwrap();
            Self { root, area }
        }
        fn batch(&self) -> OutputBatch {
            OutputBatch::create(&self.root, "합성 결과").unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            // Test fixtures consist exclusively of synthetic files created by this test.
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    fn crash(mut session: FileWriteSession) -> PathBuf {
        let path = session.temp_path.clone();
        for mut file in [session.source.take(), session.staging.take()]
            .into_iter()
            .flatten()
        {
            file.remove_on_drop = false;
            drop(file.file.take());
        }
        if let Some(mut journal) = session.journal.take() {
            drop(journal.file.file.take());
        }
        session.temp_guard = None;
        session.temp_path = PathBuf::new();
        path
    }

    #[test]
    fn recovery_cleans_verified_input_and_partial_stage_but_preserves_final_link() {
        let fixture = Fixture::new();
        let batch = fixture.batch();
        let mut session = batch
            .begin("결과.bin", (WRITE_CHUNK_BYTES + 3) as u64, &fixture.area)
            .unwrap();
        session.append(0, &vec![7; WRITE_CHUNK_BYTES]).unwrap();
        session
            .append(WRITE_CHUNK_BYTES as u64, &[1, 2, 3])
            .unwrap();
        let stage_path = batch
            .folder_path()
            .join(format!(".deck-stage-{}.part", random_suffix()));
        let mut stage = OwnedFile::create(
            stage_path.clone(),
            Arc::new(DirectoryGuard::open(batch.folder_path()).unwrap()),
        )
        .unwrap();
        session.journal.as_mut().unwrap().stage(&stage).unwrap();
        stage.write_all(&vec![7; WRITE_CHUNK_BYTES]).unwrap();
        stage.flush().unwrap();
        stage.close_writer().unwrap();
        let final_path = batch.folder_path().join("게시된 결과.bin");
        fs::hard_link(&stage_path, &final_path).unwrap();
        stage.refresh().unwrap();
        session.staging = Some(stage);
        let temp = crash(session);
        fs::write(temp.join("사용자 추가.txt"), b"synthetic user addition").unwrap();
        recover_one(&temp).unwrap();
        recover_area(&fixture.area).unwrap();
        assert!(!temp.join("input.part").exists());
        assert!(!temp.join(JOURNAL_NAME).exists());
        assert!(!stage_path.exists());
        assert_eq!(fs::read(final_path).unwrap(), vec![7; WRITE_CHUNK_BYTES]);
        assert!(temp.join("사용자 추가.txt").exists());
    }

    #[test]
    fn recovery_preserves_modified_corrupt_oversized_and_unknown_leftovers() {
        let fixture = Fixture::new();
        let batch = fixture.batch();
        let mut session = batch.begin("합성.bin", 3, &fixture.area).unwrap();
        session.append(0, &[1, 2, 3]).unwrap();
        let modified = crash(session);
        fs::write(modified.join("input.part"), [9, 9, 9]).unwrap();
        let corrupt = crash(batch.begin("합성.bin", 0, &fixture.area).unwrap());
        fs::write(corrupt.join(JOURNAL_NAME), b"{broken synthetic ledger").unwrap();
        let oversized = crash(batch.begin("합성.bin", 0, &fixture.area).unwrap());
        OpenOptions::new()
            .write(true)
            .open(oversized.join(JOURNAL_NAME))
            .unwrap()
            .set_len(JOURNAL_LIMIT + 1)
            .unwrap();
        let unknown = fixture.area.root().join("unknown");
        fs::create_dir(&unknown).unwrap();
        fs::write(unknown.join("input.part"), b"unknown").unwrap();
        recover_area(&fixture.area).unwrap();
        assert_eq!(fs::read(modified.join("input.part")).unwrap(), [9, 9, 9]);
        assert!(modified.join(JOURNAL_NAME).exists());
        assert!(corrupt.join("input.part").exists());
        assert!(oversized.join("input.part").exists());
        assert_eq!(fs::read(unknown.join("input.part")).unwrap(), b"unknown");
    }

    #[test]
    fn ledger_uses_fixed_blocks_and_bounds_record_size() {
        let fixture = Fixture::new();
        let batch = fixture.batch();
        let mut session = batch.begin("합성.bin", 65539, &fixture.area).unwrap();
        session.append(0, &[1]).unwrap();
        session.append(1, &vec![2; 65536]).unwrap();
        session.append(65537, &[3, 4]).unwrap();
        let journal = session.journal.as_ref().unwrap();
        assert_eq!(journal.record.full_blocks.len(), 1);
        assert_eq!(journal.tail.len(), 3);
        assert!(serde_json::to_vec(&journal.record).unwrap().len() < 4096);
        session.abort().unwrap();
    }

    #[test]
    fn uncheckpointed_crash_is_preserved_and_published_missing_stage_is_safe() {
        let fixture = Fixture::new();
        let batch = fixture.batch();
        let mut partial = batch.begin("미완료.bin", 10, &fixture.area).unwrap();
        partial.append(0, &[1, 2, 3]).unwrap();
        let partial_path = crash(partial);
        let mut published = batch.begin("게시.bin", 3, &fixture.area).unwrap();
        published.append(0, &[4, 5, 6]).unwrap();
        let stage_path = batch
            .folder_path()
            .join(format!(".deck-stage-{}.part", random_suffix()));
        let mut stage = OwnedFile::create(
            stage_path.clone(),
            Arc::new(DirectoryGuard::open(batch.folder_path()).unwrap()),
        )
        .unwrap();
        published.journal.as_mut().unwrap().stage(&stage).unwrap();
        stage.write_all(&[4, 5, 6]).unwrap();
        stage.flush().unwrap();
        let final_path = batch.folder_path().join("최종.bin");
        stage.close_writer().unwrap();
        // Simulate missing stage after publication using only a fresh synthetic fixture.
        fs::rename(&stage_path, &final_path).unwrap();
        stage.remove_on_drop = false;
        drop(stage);
        let published_temp = crash(published);
        recover_area(&fixture.area).unwrap();
        assert_eq!(
            fs::read(partial_path.join("input.part")).unwrap(),
            [1, 2, 3]
        );
        assert!(partial_path.join(JOURNAL_NAME).exists());
        assert!(!published_temp.exists());
        assert_eq!(fs::read(final_path).unwrap(), [4, 5, 6]);
    }

    #[test]
    fn transfers_eight_mib_with_bounded_checkpoint_overhead() {
        let fixture = Fixture::new();
        let batch = fixture.batch();
        let start = std::time::Instant::now();
        let size = 8 * 1024 * 1024;
        let mut session = batch.begin("성능.bin", size, &fixture.area).unwrap();
        let chunk = vec![17; WRITE_CHUNK_BYTES];
        for offset in (0..size).step_by(WRITE_CHUNK_BYTES) {
            session.append(offset, &chunk).unwrap();
        }
        assert_eq!(
            session.journal.as_ref().unwrap().record.full_blocks.len(),
            128
        );
        assert!(session.journal.as_ref().unwrap().file.metadata.len() < 16384);
        let result = session.commit().unwrap();
        assert_eq!(fs::metadata(result).unwrap().len(), size);
        eprintln!("synthetic 8 MiB output elapsed: {:?}", start.elapsed());
    }
}
