// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
use super::*;
struct Fixture {
    root: PathBuf,
    service: SchoolDataService,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("deck-school-test-{}", token()));
        let service = SchoolDataService::open(root.clone()).unwrap();
        Self { root, service }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn document() -> SchoolDataDocument {
    let mut d = SchoolDataDocument::default();
    d.semesters.push(SchoolSemester {
        id: "sem".into(),
        academic_year: 2026,
        term: 1,
        start_date: "2026-03-01".into(),
        end_date: "2026-07-31".into(),
        archived: false,
        read_only: false,
    });
    for n in 1..=2 {
        d.students.push(SchoolStudent {
            id: format!("s{n}"),
            name: "합성학생".into(),
            photo_id: None,
        });
        d.enrollments.push(SchoolEnrollment {
            id: format!("e{n}"),
            student_id: format!("s{n}"),
            semester_id: "sem".into(),
            grade: 1,
            class_number: n,
            student_number: 1,
            status: SchoolEnrollmentStatus::Active,
        });
        d.contexts.push(SchoolContext {
            id: format!("c{n}"),
            semester_id: "sem".into(),
            kind: SchoolContextKind::Homeroom,
            label: format!("합성 {n}반"),
            subject: None,
            room: None,
            enrollment_ids: vec![format!("e{n}")],
            weekly_table_id: None,
        });
    }
    d.timetable.day_templates.push(SchoolDayTemplate {
        id: "day".into(),
        semester_id: "sem".into(),
        label: "합성 일과".into(),
        slots: vec![SchoolDaySlot {
            period: 1,
            start_minute: 540,
            end_minute: 590,
        }],
    });
    d.timetable.weekly_tables.push(SchoolWeeklyTable {
        id: "week".into(),
        semester_id: "sem".into(),
        label: "합성 시간표".into(),
        start_date: None,
        end_date: None,
        entries: vec![
            SchoolWeeklySlot {
                weekday: 1,
                period: 1,
                context_id: "c1".into(),
            },
            SchoolWeeklySlot {
                weekday: 1,
                period: 2,
                context_id: "c2".into(),
            },
        ],
    });
    d
}
fn populated() -> Fixture {
    let f = Fixture::new();
    f.service
        .save(SaveSchoolDataArgs {
            expected_revision: 0,
            document: document(),
        })
        .unwrap();
    f
}
fn grant(f: &Fixture, owner: &str, remember: bool) -> SchoolAccessGrant {
    let (id, rx) = f
        .service
        .request(
            owner,
            "합성 도구",
            SchoolRequestedAccess {
                kinds: vec![SchoolContextKind::Homeroom],
                scopes: vec![SchoolScope::RosterBasic, SchoolScope::Timetable],
                remember,
            },
        )
        .unwrap();
    f.service
        .resolve(SchoolAccessResolution {
            request_id: id,
            allow: true,
            context_ids: vec!["c1".into()],
            scopes: vec![SchoolScope::RosterBasic, SchoolScope::Timetable],
            remember,
        })
        .unwrap();
    rx.recv().unwrap().unwrap()
}
#[test]
fn only_teacher_confirmed_owner_context_and_scope_can_read() {
    let f = populated();
    assert_eq!(
        f.service
            .roster(
                "presenter-picker",
                SchoolReadRosterArgs {
                    grant_handle: "invented".into(),
                    context_id: "c1".into(),
                    expected_revision: None
                }
            )
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    let g = grant(&f, "presenter-picker", false);
    let args = SchoolReadRosterArgs {
        grant_handle: g.grant_handle.clone(),
        context_id: "c1".into(),
        expected_revision: Some(1),
    };
    let snap = f.service.roster("presenter-picker", args.clone()).unwrap();
    assert_eq!(snap.students.len(), 1);
    assert_eq!(snap.students.first().unwrap().enrollment_id, "e1");
    assert!(snap.students.first().unwrap().photo_handle.is_none());
    assert_eq!(
        f.service
            .roster("role-planner", args.clone())
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        f.service
            .roster(
                "presenter-picker",
                SchoolReadRosterArgs {
                    context_id: "c2".into(),
                    ..args.clone()
                }
            )
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(
        f.service
            .roster(
                "presenter-picker",
                SchoolReadRosterArgs {
                    expected_revision: Some(0),
                    ..args
                }
            )
            .unwrap_err()
            .code,
        ErrorCode::Busy
    );
    let timetable = f
        .service
        .timetable(
            "presenter-picker",
            SchoolReadTimetableArgs {
                grant_handle: g.grant_handle.clone(),
                semester_id: "sem".into(),
                expected_revision: Some(1),
            },
        )
        .unwrap();
    assert_eq!(
        timetable
            .timetable
            .weekly_tables
            .first()
            .unwrap()
            .entries
            .len(),
        1
    );
    assert_eq!(
        timetable
            .timetable
            .weekly_tables
            .first()
            .unwrap()
            .entries
            .first()
            .unwrap()
            .context_id,
        "c1"
    );
    f.service
        .revoke("presenter-picker", &g.grant_handle)
        .unwrap();
    assert!(!f.service.status("presenter-picker").unwrap().permitted);
}
#[test]
fn remembered_grants_survive_restart_transient_grants_do_not() {
    let f = populated();
    let remembered = grant(&f, "presenter-picker", true);
    grant(&f, "role-planner", false);
    let reopened = SchoolDataService::open(f.root.clone()).unwrap();
    assert_eq!(
        reopened
            .status("presenter-picker")
            .unwrap()
            .grants
            .first()
            .unwrap()
            .grant_handle,
        remembered.grant_handle
    );
    assert!(!reopened.status("role-planner").unwrap().permitted);
    f.service.unload("role-planner");
    assert!(!f.service.status("role-planner").unwrap().permitted);
    f.service
        .revoke("presenter-picker", &remembered.grant_handle)
        .unwrap();
    assert!(
        !SchoolDataService::open(f.root.clone())
            .unwrap()
            .status("presenter-picker")
            .unwrap()
            .permitted
    );
}
#[test]
fn confirmation_cannot_expand_requested_scope_or_rebound_context() {
    let f = populated();
    let (id, rx) = f
        .service
        .request(
            "presenter-picker",
            "합성",
            SchoolRequestedAccess {
                kinds: vec![SchoolContextKind::Homeroom],
                scopes: vec![SchoolScope::RosterBasic],
                remember: false,
            },
        )
        .unwrap();
    assert!(
        f.service
            .resolve(SchoolAccessResolution {
                request_id: id.clone(),
                allow: true,
                context_ids: vec!["c1".into()],
                scopes: vec![SchoolScope::Photos],
                remember: false
            })
            .is_err()
    );
    f.service
        .resolve(SchoolAccessResolution {
            request_id: id,
            allow: false,
            context_ids: vec![],
            scopes: vec![],
            remember: false,
        })
        .unwrap();
    assert!(rx.recv().unwrap().is_none());
    let g = grant(&f, "presenter-picker", false);
    let mut d = f.service.load().unwrap();
    d.contexts.first_mut().unwrap().kind = SchoolContextKind::Division;
    f.service
        .save(SaveSchoolDataArgs {
            expected_revision: 1,
            document: d,
        })
        .unwrap();
    assert!(
        f.service
            .list(
                "presenter-picker",
                SchoolGrantArgs {
                    grant_handle: g.grant_handle
                }
            )
            .unwrap()
            .is_empty()
    );
}
#[test]
fn stale_save_and_archived_changes_preserve_previous_document() {
    let f = populated();
    let mut d = f.service.load().unwrap();
    d.semesters.first_mut().unwrap().archived = true;
    d.semesters.first_mut().unwrap().read_only = true;
    f.service
        .save(SaveSchoolDataArgs {
            expected_revision: 1,
            document: d.clone(),
        })
        .unwrap();
    assert_eq!(
        f.service
            .save(SaveSchoolDataArgs {
                expected_revision: 1,
                document: d.clone()
            })
            .unwrap_err()
            .code,
        ErrorCode::Busy
    );
    d.revision = 2;
    d.students.first_mut().unwrap().name = "다른 합성학생".into();
    assert_eq!(
        f.service
            .save(SaveSchoolDataArgs {
                expected_revision: 2,
                document: d
            })
            .unwrap_err()
            .code,
        ErrorCode::PermissionDenied
    );
    assert_eq!(f.service.load().unwrap().revision, 2);
    assert_eq!(
        SchoolDataService::open(f.root.clone())
            .unwrap()
            .load()
            .unwrap()
            .students
            .first()
            .unwrap()
            .name,
        "합성학생"
    );
}

#[test]
fn corrupted_store_blocks_school_operations_and_explicit_recovery_preserves_original() {
    let f = populated();
    let path = f.root.join("school-data.json");
    let corrupted = b"{broken synthetic data";
    std::fs::write(&path, corrupted).unwrap();
    let service = SchoolDataService::open(f.root.clone()).unwrap();
    assert!(service.load().is_err());
    assert!(service.status("presenter-picker").is_err());
    assert!(
        service
            .save(SaveSchoolDataArgs {
                expected_revision: 0,
                document: SchoolDataDocument::default()
            })
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), corrupted);
    assert!(
        service
            .recover(SaveSchoolDataArgs {
                expected_revision: 4,
                document: document()
            })
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), corrupted);
    let recovered = service
        .recover(SaveSchoolDataArgs {
            expected_revision: 0,
            document: document(),
        })
        .unwrap();
    assert_eq!(recovered.students.len(), 2);
    assert!(!service.status("presenter-picker").unwrap().permitted);
    let preserved = std::fs::read_dir(&f.root)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("school-data-preserved-")
        })
        .unwrap();
    assert_eq!(std::fs::read(preserved).unwrap(), corrupted);
    assert_eq!(
        SchoolDataService::open(f.root.clone())
            .unwrap()
            .load()
            .unwrap(),
        recovered
    );
    assert!(
        service
            .recover(SaveSchoolDataArgs {
                expected_revision: 0,
                document: document()
            })
            .is_err()
    );
}
#[test]
fn photo_requires_matching_live_owner_scope_snapshot_and_closes_on_revocation() {
    let f = populated();
    let path = f.root.join("synthetic.png");
    std::fs::write(&path, b"\x89PNG\r\n\x1a\nsynthetic").unwrap();
    f.service
        .import_photo(
            SchoolImportPhotoArgs {
                student_id: "s1".into(),
                expected_revision: 1,
            },
            path,
        )
        .unwrap();
    let (id, rx) = f
        .service
        .request(
            "presenter-picker",
            "합성 도구",
            SchoolRequestedAccess {
                kinds: vec![SchoolContextKind::Homeroom],
                scopes: vec![SchoolScope::RosterBasic, SchoolScope::Photos],
                remember: false,
            },
        )
        .unwrap();
    f.service
        .resolve(SchoolAccessResolution {
            request_id: id,
            allow: true,
            context_ids: vec!["c1".into()],
            scopes: vec![SchoolScope::RosterBasic, SchoolScope::Photos],
            remember: false,
        })
        .unwrap();
    let grant = rx.recv().unwrap().unwrap();
    let snapshot = f
        .service
        .roster(
            "presenter-picker",
            SchoolReadRosterArgs {
                grant_handle: grant.grant_handle.clone(),
                context_id: "c1".into(),
                expected_revision: Some(2),
            },
        )
        .unwrap();
    let photo = snapshot
        .students
        .first()
        .unwrap()
        .photo_handle
        .clone()
        .unwrap();
    let args = SchoolOpenPhotoArgs {
        grant_handle: grant.grant_handle.clone(),
        snapshot_id: snapshot.snapshot_id.clone(),
        photo_handle: photo,
    };
    {
        let i = f.service.inner.lock().unwrap();
        assert!(f.service.photo_path(&i, "presenter-picker", &args).is_ok());
        assert!(f.service.photo_path(&i, "role-planner", &args).is_err());
        assert!(
            f.service
                .photo_path(
                    &i,
                    "presenter-picker",
                    &SchoolOpenPhotoArgs {
                        snapshot_id: "forged".into(),
                        ..args.clone()
                    }
                )
                .is_err()
        );
    }
    f.service.inner.lock().unwrap().resources.insert(
        "resource".into(),
        PhotoResource {
            owner: "presenter-picker".into(),
            grant: grant.grant_handle.clone(),
            live: true,
            snapshot: snapshot.snapshot_id,
        },
    );
    let close = f
        .service
        .revoke("presenter-picker", &grant.grant_handle)
        .unwrap();
    assert_eq!(close, vec!["resource"]);
    let i = f.service.inner.lock().unwrap();
    assert!(!i.resources.get("resource").unwrap().live);
    assert!(f.service.photo_path(&i, "presenter-picker", &args).is_err());
}
