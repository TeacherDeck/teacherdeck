// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
use super::*;
use crate::platform::{TempArea, TempDir};
struct Fixture {
    guard: TempDir,
    service: FileOpsService,
}
impl Fixture {
    fn new() -> Self {
        let area =
            TempArea::init(std::env::temp_dir().join(format!("deck-rename-tests-{}", token())))
                .unwrap();
        let guard = area.create_dir(&mut OsRng).unwrap();
        let service = FileOpsService::open(guard.path().join("history")).unwrap();
        Self { guard, service }
    }
    fn file(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.guard.path().join(name);
        fs::write(&path, bytes).unwrap();
        path
    }
    fn plan(&mut self, items: &[(&str, &str)]) -> RenamePlan {
        let inputs = items
            .iter()
            .enumerate()
            .map(|(index, (old, new))| {
                (
                    format!("opaque-{index}"),
                    self.guard.path().join(old),
                    new.to_string(),
                )
            })
            .collect();
        self.service.plan("sample-tool", 0, inputs).unwrap()
    }
    fn execute(&mut self, plan: &RenamePlan) -> RenameResult {
        self.service
            .confirm("sample-tool", 0, &plan.plan_handle)
            .unwrap();
        let mut result = self
            .service
            .execute("sample-tool", 0, &plan.plan_handle)
            .unwrap();
        while !result.done {
            result = self
                .service
                .execute("sample-tool", 0, &plan.plan_handle)
                .unwrap();
        }
        result
    }
    fn undo(&mut self, handle: &str) -> UndoRenameResult {
        self.service.confirm_undo("sample-tool", handle).unwrap();
        let mut result = self.service.undo("sample-tool", handle).unwrap();
        while !result.done {
            result = self.service.undo("sample-tool", handle).unwrap();
        }
        result
    }
}
#[test]
fn plans_validate_names_ownership_and_collisions_without_mutating() {
    let mut f = Fixture::new();
    let input = f.file("synthetic-a.txt", b"a");
    f.file("occupied.txt", b"other");
    let p = f.plan(&[("synthetic-a.txt", "occupied.txt")]);
    assert_eq!(p.items[0].status, RenameStatus::Conflict);
    assert!(f.service.execute("sample-tool", 0, &p.plan_handle).is_err());
    assert_eq!(fs::read(input).unwrap(), b"a");
    assert!(
        f.service
            .needs_confirmation("other-tool", 0, &p.plan_handle)
            .is_err()
    );
    assert!(
        f.service
            .needs_confirmation("sample-tool", 1, &p.plan_handle)
            .is_err()
    );
    let invalid = f.plan(&[("synthetic-a.txt", "../escape.txt")]);
    assert_eq!(invalid.items[0].status, RenameStatus::Invalid);
}
#[test]
fn input_and_byte_limits_are_checked_before_native_changes() {
    let mut f = Fixture::new();
    assert!(f.service.plan("sample-tool", 0, vec![]).is_err());
    let input = f.file("synthetic.bin", b"x");
    let inputs = (0..2001)
        .map(|i| {
            (
                format!("opaque{i}"),
                input.clone(),
                format!("target{i}.bin"),
            )
        })
        .collect();
    assert!(f.service.plan("sample-tool", 0, inputs).is_err());
    assert_eq!(fs::read(input).unwrap(), b"x");
    let sparse = f.file("large.bin", b"");
    let opened = fs::File::options().write(true).open(&sparse).unwrap();
    opened.set_len(512 * 1024 * 1024 + 1).unwrap();
    drop(opened);
    assert!(
        f.service
            .plan(
                "sample-tool",
                0,
                vec![("large".into(), sparse.clone(), "target.bin".into())]
            )
            .is_err()
    );
    let opened = fs::File::options().write(true).open(&sparse).unwrap();
    opened.set_len(512 * 1024 * 1024).unwrap();
    drop(opened);
    assert!(
        f.service
            .plan(
                "sample-tool",
                0,
                (0..5)
                    .map(|index| (
                        format!("large-{index}"),
                        sparse.clone(),
                        format!("target-{index}.bin")
                    ))
                    .collect()
            )
            .is_err()
    );
    assert_eq!(fs::metadata(sparse).unwrap().len(), 512 * 1024 * 1024);
}
#[test]
fn unchanged_rows_do_not_need_native_moves() {
    let mut f = Fixture::new();
    f.file("same.txt", b"same");
    let p = f.plan(&[("same.txt", "same.txt")]);
    let result = f.execute(&p);
    assert!(result.done);
    assert_eq!(result.success, 0);
    assert_eq!(result.items[0].status, RenameStatus::Unchanged);
}
#[cfg(windows)]
#[test]
fn every_utf16_tail_alignment_renames_exactly_without_appended_garbage() {
    let f = Fixture::new();
    for length in 1..=16 {
        let path = f.file("original.bin", b"exact");
        let target = f.guard.path().join(format!("{}.bin", "가".repeat(length)));
        let mut file = ProtectedFile::open(&path).unwrap();
        file.rename_to(&target).unwrap();
        drop(file);
        assert!(!path.exists());
        assert_eq!(fs::read(&target).unwrap(), b"exact");
        fs::remove_file(&target).unwrap();
    }
}
#[test]
fn unavailable_service_and_unloaded_plans_cannot_mutate() {
    let mut blocked = FileOpsService::unavailable();
    assert!(
        blocked
            .history("sample-tool", ListHistoryArgs::default())
            .is_err()
    );
    assert!(blocked.plan("sample-tool", 0, vec![]).is_err());
    let mut f = Fixture::new();
    let path = f.file("same.txt", b"same");
    let p = f.plan(&[("same.txt", "same.txt")]);
    assert!(f.service.execute("sample-tool", 0, &p.plan_handle).is_err());
    f.service.unload("sample-tool");
    assert!(f.service.confirm("sample-tool", 0, &p.plan_handle).is_err());
    assert_eq!(fs::read(path).unwrap(), b"same");
}
#[test]
fn history_pages_are_owner_bound_and_unload_releases_cursor_without_losing_history() {
    let mut f = Fixture::new();
    f.file("same.txt", b"same");
    for _ in 0..3 {
        let p = f.plan(&[("same.txt", "same.txt")]);
        f.execute(&p);
    }
    let page = f
        .service
        .history(
            "sample-tool",
            ListHistoryArgs {
                cursor: None,
                limit: Some(1),
            },
        )
        .unwrap();
    assert_eq!(page.entries.len(), 1);
    let cursor = page.next_cursor.unwrap();
    assert!(
        f.service
            .history(
                "other-tool",
                ListHistoryArgs {
                    cursor: Some(cursor.clone()),
                    limit: Some(1)
                }
            )
            .is_err()
    );
    let second = f
        .service
        .history(
            "sample-tool",
            ListHistoryArgs {
                cursor: Some(cursor.clone()),
                limit: Some(1),
            },
        )
        .unwrap();
    assert_ne!(
        page.entries[0].history_handle,
        second.entries[0].history_handle
    );
    f.service.unload("sample-tool");
    assert!(
        f.service
            .history(
                "sample-tool",
                ListHistoryArgs {
                    cursor: Some(cursor),
                    limit: Some(1)
                }
            )
            .is_err()
    );
    assert_eq!(
        f.service
            .history("sample-tool", ListHistoryArgs::default())
            .unwrap()
            .entries
            .len(),
        3
    );
}
#[cfg(windows)]
#[test]
fn junction_sources_are_rejected_by_file_ops_and_listing() {
    let f = Fixture::new();
    let real = f.guard.path().join("ordinary");
    fs::create_dir(&real).unwrap();
    fs::write(real.join("input.txt"), b"input").unwrap();
    let junction = f.guard.path().join("junction");
    let result = std::process::Command::new("cmd")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&real)
        .output()
        .unwrap();
    assert!(result.status.success());
    assert!(ProtectedFile::open(&junction.join("input.txt")).is_err());
    assert!(crate::file_listing::enumerate_for_tests(f.guard.path(), true).is_err());
    fs::remove_dir(junction).unwrap();
    assert_eq!(fs::read(real.join("input.txt")).unwrap(), b"input");
}
#[cfg(windows)]
#[test]
fn protected_handles_support_two_file_exchange() {
    let f = Fixture::new();
    let a = f.file("one.txt", b"one");
    let b = f.file("two.txt", b"two");
    let mut fa = ProtectedFile::open(&a).unwrap();
    let mut fb = ProtectedFile::open(&b).unwrap();
    fa.rename_to(&f.guard.path().join("stage-one.txt"))
        .expect("stage one");
    fb.rename_to(&f.guard.path().join("stage-two.txt"))
        .expect("stage two");
    fa.rename_to(&b).expect("finish one");
    fb.rename_to(&a).expect("finish two");
    drop(fa);
    drop(fb);
    assert_eq!(fs::read(a).unwrap(), b"two");
    assert_eq!(fs::read(b).unwrap(), b"one");
}
#[cfg(windows)]
#[test]
fn exchange_case_rename_and_restart_undo_preserve_exact_bytes() {
    let mut f = Fixture::new();
    f.file("a.txt", b"original-a");
    f.file("b.txt", b"original-b");
    f.file("case.txt", b"case");
    let p = f.plan(&[
        ("a.txt", "b.txt"),
        ("b.txt", "a.txt"),
        ("case.txt", "CASE.txt"),
    ]);
    assert!(p.items.iter().all(|i| i.status == RenameStatus::Ready));
    let result = f.execute(&p);
    assert_eq!(result.success, 3);
    assert_eq!(
        fs::read(f.guard.path().join("a.txt")).unwrap(),
        b"original-b"
    );
    assert_eq!(
        fs::read(f.guard.path().join("b.txt")).unwrap(),
        b"original-a"
    );
    let root = f.service.root.clone();
    drop(f.service);
    f.service = FileOpsService::open(root).unwrap();
    let result = f.undo(result.history_handle.as_deref().unwrap());
    assert_eq!(result.success, 3);
    assert_eq!(
        fs::read(f.guard.path().join("a.txt")).unwrap(),
        b"original-a"
    );
    assert_eq!(
        fs::read(f.guard.path().join("b.txt")).unwrap(),
        b"original-b"
    );
    assert!(fs::read_dir(f.guard.path()).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".deck-rename-")
    }));
}
#[cfg(windows)]
#[test]
fn edited_replaced_and_occupied_outputs_are_never_restored() {
    for mode in ["edited", "replaced", "occupied"] {
        let mut f = Fixture::new();
        f.file("original.txt", b"original");
        let p = f.plan(&[("original.txt", "new.txt")]);
        let result = f.execute(&p);
        let output = f.guard.path().join("new.txt");
        match mode {
            "edited" => fs::write(&output, b"edited").unwrap(),
            "replaced" => {
                let modified = fs::metadata(&output).unwrap().modified().unwrap();
                fs::remove_file(&output).unwrap();
                fs::write(&output, b"original").unwrap();
                fs::File::options()
                    .write(true)
                    .open(&output)
                    .unwrap()
                    .set_times(fs::FileTimes::new().set_modified(modified))
                    .unwrap();
            }
            _ => {
                f.file("original.txt", b"unrelated");
            }
        }
        let expected = fs::read(&output).unwrap();
        let restored = f.undo(result.history_handle.as_deref().unwrap());
        assert_eq!(restored.blocked, 1);
        assert_eq!(restored.success, 0);
        assert_eq!(fs::read(output).unwrap(), expected);
        if mode == "occupied" {
            assert_eq!(
                fs::read(f.guard.path().join("original.txt")).unwrap(),
                b"unrelated"
            );
        }
    }
}
#[cfg(windows)]
#[test]
fn opened_handle_prevents_concurrent_source_replacement_and_never_overwrites_target() {
    let f = Fixture::new();
    let path = f.file("input.txt", b"input");
    let destination = f.file("occupied.txt", b"occupied");
    let mut file = ProtectedFile::open(&path).unwrap();
    assert!(fs::remove_file(&path).is_err());
    assert!(fs::write(&path, b"changed").is_err());
    assert!(fs::rename(f.guard.path(), f.guard.path().with_extension("replaced")).is_err());
    assert!(file.rename_to(&destination).is_err());
    drop(file);
    assert_eq!(fs::read(path).unwrap(), b"input");
    assert_eq!(fs::read(destination).unwrap(), b"occupied");
}
#[cfg(windows)]
#[test]
fn crash_after_move_before_result_record_is_recovered_by_exact_identity() {
    let mut f = Fixture::new();
    f.file("old.txt", b"original");
    let p = f.plan(&[("old.txt", "new.txt")]);
    f.service.confirm("sample-tool", 0, &p.plan_handle).unwrap();
    let plan = f.service.plans.get(&p.plan_handle).unwrap();
    let history = token();
    let record = Record {
        version: 1,
        owner: "sample-tool".into(),
        handle: history.clone(),
        created: now(),
        items: plan.items.clone(),
        groups: plan.groups.clone(),
        next: 0,
        undo_next: 0,
        state: RenameHistoryState::Pending,
        intent: None,
    };
    let mut previous = String::new();
    journal::append(
        &f.service.root,
        &history,
        &mut previous,
        Event::Start(record.clone()),
        true,
    )
    .unwrap();
    journal::append(
        &f.service.root,
        &history,
        &mut previous,
        Event::Intent {
            group: 0,
            undo: false,
        },
        false,
    )
    .unwrap();
    let item = &record.items[0];
    let mut file = ProtectedFile::open(&item.parent.join(&item.old)).unwrap();
    file.rename_to(&item.parent.join(&item.temporary)).unwrap();
    drop(file);
    let root = f.service.root.clone();
    drop(f.service);
    f.service = FileOpsService::open(root).unwrap();
    let restored = f.undo(&history);
    assert_eq!(restored.success, 1);
    assert_eq!(
        fs::read(f.guard.path().join("old.txt")).unwrap(),
        b"original"
    );
    assert!(!f.guard.path().join(&item.temporary).exists());
}
#[test]
fn corrupted_history_is_not_silently_reset() {
    let mut f = Fixture::new();
    f.file("same.txt", b"same");
    let p = f.plan(&[("same.txt", "same.txt")]);
    let result = f.execute(&p);
    let handle = result.history_handle.unwrap();
    let path = journal::path(&f.service.root, &handle).unwrap();
    let old = fs::read(&path).unwrap();
    let mut corrupt = old.clone();
    corrupt[20] ^= 1;
    fs::write(&path, &corrupt).unwrap();
    assert!(
        f.service
            .history("sample-tool", ListHistoryArgs::default())
            .is_err()
    );
    assert!(FileOpsService::open(f.service.root.clone()).is_err());
    assert_eq!(fs::read(path).unwrap(), corrupt);
}
