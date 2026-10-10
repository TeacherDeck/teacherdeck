// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
use super::*;
use crate::platform::TempDir;

struct Fixture {
    area: TempArea,
    guard: Option<TempDir>,
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("deck-destination-test-{}", token()));
        let area = TempArea::init(root.clone()).unwrap();
        let guard = Some(area.create_dir(&mut OsRng).unwrap());
        Self { area, guard, root }
    }
    fn path(&self) -> &Path {
        self.guard.as_ref().unwrap().path()
    }
    fn service(&self) -> DestinationService {
        DestinationService::open(self.path().join("grants")).unwrap()
    }
    fn destination(&self) -> PathBuf {
        let path = self.path().join("photos");
        fs::create_dir(&path).unwrap();
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
fn persistent_restore_is_owner_isolated_and_revoke_preserves_user_files() {
    let f = Fixture::new();
    let dest = f.destination();
    let mut service = f.service();
    let grant = service.pick("sample-tool", &dest, true).unwrap();
    assert!(grant.available && grant.persistent);
    assert_eq!(grant.label, "선택한 저장 폴더");
    let first = service
        .append(
            "sample-tool",
            &grant.grant_handle,
            "capture.png",
            b"first",
            &f.area,
        )
        .unwrap();
    let second = service
        .append(
            "sample-tool",
            &grant.grant_handle,
            "capture.png",
            b"second",
            &f.area,
        )
        .unwrap();
    assert_ne!(first, second);
    assert_eq!(second.file_name().unwrap(), "capture (1).png");
    assert_eq!(fs::read(&first).unwrap(), b"first");
    assert_eq!(fs::read(&second).unwrap(), b"second");
    drop(service);
    let mut restored = f.service();
    assert_eq!(
        restored.status("sample-tool", None).unwrap(),
        Some(grant.clone())
    );
    assert!(restored.status("other-tool", None).unwrap().is_none());
    assert!(
        restored
            .validate("other-tool", &grant.grant_handle)
            .is_err()
    );
    restored.revoke("sample-tool", &grant.grant_handle).unwrap();
    assert!(
        restored
            .validate("sample-tool", &grant.grant_handle)
            .is_err()
    );
    assert_eq!(fs::read(first).unwrap(), b"first");
    assert_eq!(fs::read(second).unwrap(), b"second");
    drop(restored);
    assert!(f.service().status("sample-tool", None).unwrap().is_none());
}
#[test]
fn transient_grant_and_reselection_never_restore_old_authority() {
    let f = Fixture::new();
    let dest = f.destination();
    let mut service = f.service();
    let old = service.pick("sample-tool", &dest, true).unwrap();
    let new = service.pick("sample-tool", &dest, false).unwrap();
    assert!(!new.persistent);
    assert!(service.validate("sample-tool", &old.grant_handle).is_err());
    assert!(service.validate("sample-tool", &new.grant_handle).is_ok());
    drop(service);
    assert!(f.service().status("sample-tool", None).unwrap().is_none());
}
#[test]
fn removed_or_replaced_destination_is_unavailable_without_recreation() {
    let f = Fixture::new();
    let dest = f.destination();
    let mut service = f.service();
    let grant = service.pick("sample-tool", &dest, true).unwrap();
    fs::rename(&dest, f.path().join("old-photos")).unwrap();
    assert!(
        !service
            .status("sample-tool", None)
            .unwrap()
            .unwrap()
            .available
    );
    assert!(
        service
            .append(
                "sample-tool",
                &grant.grant_handle,
                "capture.png",
                b"bytes",
                &f.area
            )
            .is_err()
    );
    assert!(!dest.exists());
    fs::create_dir(&dest).unwrap();
    assert!(
        service
            .validate("sample-tool", &grant.grant_handle)
            .is_err()
    );
    assert_eq!(fs::read_dir(&dest).unwrap().count(), 0);
}
#[test]
fn invalid_names_or_sizes_and_corrupt_records_fail_without_outputs() {
    let f = Fixture::new();
    let dest = f.destination();
    let mut service = f.service();
    let grant = service.pick("sample-tool", &dest, true).unwrap();
    for name in ["../bad.png", "CON.png", "bad.png ", "x/y.png", ""] {
        assert!(
            service
                .append("sample-tool", &grant.grant_handle, name, b"bytes", &f.area)
                .is_err()
        );
    }
    assert!(
        service
            .append(
                "sample-tool",
                &grant.grant_handle,
                "capture.png",
                b"",
                &f.area
            )
            .is_err()
    );
    assert_eq!(fs::read_dir(&dest).unwrap().count(), 0);
    drop(service);
    fs::write(f.path().join("grants/sample-tool.json"), b"corrupt").unwrap();
    let mut fresh = f.service();
    assert!(fresh.status("sample-tool", None).is_err());
    // Explicit selection repairs damaged host metadata, without restoring the old token.
    let replacement = fresh.pick("sample-tool", &dest, true).unwrap();
    assert!(fresh.validate("sample-tool", &grant.grant_handle).is_err());
    assert!(replacement.available);
}
#[cfg(windows)]
#[test]
fn junction_destination_or_ancestor_is_rejected() {
    let f = Fixture::new();
    let dest = f.destination();
    let link = f.path().join("linked");
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&link)
        .arg(&dest)
        .output()
        .unwrap();
    assert!(status.status.success());
    let mut service = f.service();
    assert!(service.pick("sample-tool", &link, true).is_err());
    fs::remove_dir(link).unwrap();
}

#[test]
fn first_launch_creates_only_private_metadata_parents() {
    let f = Fixture::new();
    let root = f.path().join("new-app-data/destination-grants");
    let mut service = DestinationService::open(root.clone()).unwrap();
    assert!(root.is_dir());
    assert!(service.status("sample-tool", None).unwrap().is_none());
}
