// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
use super::*;
use crate::platform::TempDir;
use std::fs;

struct Fixture {
    area: TempArea,
    root: PathBuf,
    guard: Option<TempDir>,
}
impl Fixture {
    fn new() -> Self {
        let mut bytes = [0; HANDLE_BYTES];
        OsRng.fill(&mut bytes);
        let root = std::env::temp_dir().join(format!(
            "deck-transfer-test-{}",
            deck_core::util::to_hex(&bytes)
        ));
        let area = TempArea::init(root.clone()).unwrap();
        let guard = Some(area.create_dir(&mut OsRng).unwrap());
        Self { area, root, guard }
    }
    fn path(&self) -> &Path {
        self.guard.as_ref().unwrap().path()
    }
    fn input(&self) -> PathBuf {
        let path = self.path().join("synthetic.bin");
        fs::write(&path, b"synthetic input bytes").unwrap();
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        drop(self.guard.take());
        let _ = fs::remove_dir(&self.root);
    }
}

#[test]
fn read_tokens_are_owner_bound_and_unload_invalidates_generation() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let input = fixture.input();
    let read = store.open_read("sample-tool", 0, &input).unwrap();
    assert_eq!(read.read_id.len(), 32);
    assert!(
        read.read_id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    );
    assert_eq!(
        store
            .read("other-tool", &read.read_id, 0, 1)
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        store
            .close_read("other-tool", 0, &read.read_id)
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        store.read("sample-tool", &read.read_id, 0, 9).unwrap(),
        b"synthetic"
    );
    store.unload("sample-tool");
    assert_eq!(store.generation("sample-tool"), 1);
    assert_eq!(
        store
            .read("sample-tool", &read.read_id, 0, 1)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(
        store.open_read("sample-tool", 0, &input).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
    let next = store.open_read("sample-tool", 1, &input).unwrap();
    assert_ne!(next.read_id, read.read_id);
    assert_eq!(
        store.read("sample-tool", &next.read_id, 10, 5).unwrap(),
        b"input"
    );
}

#[test]
fn idle_grants_expire_without_waiting_and_remove_unfinished_writes() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let read = store.open_read("sample-tool", 0, &fixture.input()).unwrap();
    let (batch, output) = store
        .create_output("sample-tool", 0, fixture.path(), "results")
        .unwrap();
    let write = store
        .begin_write("sample-tool", 0, &batch, "unfinished.bin", 3, &fixture.area)
        .unwrap();
    store
        .write("sample-tool", 0, &write.write_id, 0, b"a")
        .unwrap();
    let stale = Instant::now() - IDLE_LIMIT - Duration::from_secs(1);
    store.reads.get_mut(&read.read_id).unwrap().touched = stale;
    store.batches.get_mut(&batch).unwrap().touched = stale;
    store.expire();
    assert_eq!(
        store
            .read("sample-tool", &read.read_id, 0, 1)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(
        store
            .commit("sample-tool", 0, &write.write_id)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert!(store.batches.is_empty());
    assert!(store.writes.is_empty());
    assert_eq!(fs::read_dir(output).unwrap().count(), 0);
}

#[test]
fn read_limit_is_per_module_and_closing_restores_capacity() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let input = fixture.input();
    let first = store.open_read("sample-tool", 0, &input).unwrap();
    for _ in 0..3 {
        store.open_read("sample-tool", 0, &input).unwrap();
    }
    assert_eq!(
        store.open_read("sample-tool", 0, &input).unwrap_err().code,
        ErrorCode::Busy
    );
    for _ in 0..4 {
        store.open_read("other-tool", 0, &input).unwrap();
    }
    store.close_read("sample-tool", 0, &first.read_id).unwrap();
    store.open_read("sample-tool", 0, &input).unwrap();
    store.unload("sample-tool");
    assert_eq!(store.reads.len(), 4);
}

#[test]
fn writes_enforce_one_per_module_and_two_per_application() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let (a, _) = store
        .create_output("sample-tool", 0, fixture.path(), "results-a")
        .unwrap();
    let (b, _) = store
        .create_output("other-tool", 0, fixture.path(), "results-b")
        .unwrap();
    let (c, _) = store
        .create_output("third-tool", 0, fixture.path(), "results-c")
        .unwrap();
    let first = store
        .begin_write("sample-tool", 0, &a, "first.bin", 0, &fixture.area)
        .unwrap();
    assert_eq!(
        store
            .begin_write("sample-tool", 0, &a, "second.bin", 0, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::Busy
    );
    store
        .begin_write("other-tool", 0, &b, "first.bin", 0, &fixture.area)
        .unwrap();
    assert_eq!(
        store
            .begin_write("third-tool", 0, &c, "first.bin", 0, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::Busy
    );
    store.commit("sample-tool", 0, &first.write_id).unwrap();
    store
        .begin_write("third-tool", 0, &c, "first.bin", 0, &fixture.area)
        .unwrap();
}

#[test]
fn output_grants_are_owner_bound_and_expired_write_releases_capacity() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let (batch, _) = store
        .create_output("sample-tool", 0, fixture.path(), "results")
        .unwrap();
    assert_eq!(
        store
            .begin_write("other-tool", 0, &batch, "denied.bin", 0, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        store
            .close_output("other-tool", 0, &batch)
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    let write = store
        .begin_write("sample-tool", 0, &batch, "expired.bin", 1, &fixture.area)
        .unwrap();
    store.writes.get_mut(&write.write_id).unwrap().touched =
        Instant::now() - IDLE_LIMIT - Duration::from_secs(1);
    store.expire();
    assert!(store.batches.contains_key(&batch));
    assert_eq!(
        store
            .write("sample-tool", 0, &write.write_id, 0, b"x")
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    store
        .begin_write("sample-tool", 0, &batch, "new.bin", 0, &fixture.area)
        .unwrap();
}

#[test]
fn batch_reservations_enforce_file_and_byte_quotas_even_after_abort() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let (batch, _) = store
        .create_output("sample-tool", 0, fixture.path(), "results")
        .unwrap();
    store.batches.get_mut(&batch).unwrap().value.files = MAX_BATCH_FILES - 1;
    let last = store
        .begin_write("sample-tool", 0, &batch, "last.bin", 0, &fixture.area)
        .unwrap();
    store.abort("sample-tool", 0, &last.write_id).unwrap();
    assert_eq!(
        store
            .begin_write("sample-tool", 0, &batch, "over.bin", 0, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgs
    );
    store.batches.get_mut(&batch).unwrap().value.files = 0;
    store.batches.get_mut(&batch).unwrap().value.bytes = MAX_BATCH_BYTES;
    assert_eq!(
        store
            .begin_write("sample-tool", 0, &batch, "over.bin", 1, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgs
    );
    store.batches.get_mut(&batch).unwrap().value.bytes = 0;
    assert_eq!(
        store
            .begin_write(
                "sample-tool",
                0,
                &batch,
                "huge.bin",
                MAX_FILE_BYTES + 1,
                &fixture.area
            )
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgs
    );
    store.batches.get_mut(&batch).unwrap().value.bytes = u64::MAX;
    assert_eq!(
        store
            .begin_write("sample-tool", 0, &batch, "overflow.bin", 1, &fixture.area)
            .unwrap_err()
            .code,
        ErrorCode::InvalidArgs
    );
}

#[test]
fn sequential_copy_readback_and_commit_abort_preserve_completed_results() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let source = fixture.path().join("synthetic-source.bin");
    let bytes: Vec<u8> = (0..65543).map(|n| u8::try_from(n % 256).unwrap()).collect();
    fs::write(&source, &bytes).unwrap();
    let read = store.open_read("sample-tool", 0, &source).unwrap();
    let (batch, _) = store
        .create_output("sample-tool", 0, fixture.path(), "results")
        .unwrap();
    let write = store
        .begin_write(
            "sample-tool",
            0,
            &batch,
            "synthetic-copy.bin",
            bytes.len() as u64,
            &fixture.area,
        )
        .unwrap();
    let first = store.read("sample-tool", &read.read_id, 0, 65536).unwrap();
    assert_eq!(
        store
            .write("sample-tool", 0, &write.write_id, 0, &first)
            .unwrap(),
        65536
    );
    assert_eq!(
        store
            .write("sample-tool", 0, &write.write_id, 0, &first)
            .unwrap(),
        65536
    );
    assert_eq!(
        store
            .write("other-tool", 0, &write.write_id, 65536, b"x")
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    let last = store.read("sample-tool", &read.read_id, 65536, 7).unwrap();
    store
        .write("sample-tool", 0, &write.write_id, 65536, &last)
        .unwrap();
    let output = store.commit("sample-tool", 0, &write.write_id).unwrap();
    assert!(store.commit("sample-tool", 0, &write.write_id).unwrap() == output);
    store.abort("sample-tool", 0, &write.write_id).unwrap();
    store.close_output("sample-tool", 0, &batch).unwrap();
    store.unload("sample-tool");
    assert_eq!(fs::read(output).unwrap(), bytes);
    assert_eq!(fs::read(source).unwrap(), bytes);
}

#[test]
fn abort_before_commit_leaves_no_final_file_and_blocks_future_commit() {
    let fixture = Fixture::new();
    let mut store = FileTransfers::default();
    let (batch, output) = store
        .create_output("sample-tool", 0, fixture.path(), "results")
        .unwrap();
    let write = store
        .begin_write("sample-tool", 0, &batch, "cancelled.bin", 2, &fixture.area)
        .unwrap();
    store
        .write("sample-tool", 0, &write.write_id, 0, b"ok")
        .unwrap();
    store.abort("sample-tool", 0, &write.write_id).unwrap();
    assert_eq!(
        store
            .commit("sample-tool", 0, &write.write_id)
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
    assert_eq!(fs::read_dir(output).unwrap().count(), 0);
}
