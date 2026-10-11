// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Synthetic-only transport, preservation, photo authority and lifecycle regressions.
use super::*;
use std::io::{Cursor, Write};
fn area() -> TempArea {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
        .join("target/adversarial-review/timealert-tests");
    TempArea::init_preserving(root).unwrap()
}
fn temp(area: &TempArea) -> TempDir {
    area.create_dir(&mut crate::platform::OsRng).unwrap()
}
fn fixture(root: &Path) -> std::path::PathBuf {
    let path = root.join("original.db");
    let db = database::create(&path).unwrap();
    db.execute_batch("INSERT INTO school VALUES(1,'합성학교',NULL,NULL,1,0,1); INSERT INTO academic_year VALUES(1,2026); INSERT INTO semester VALUES(1,1,1,'FIRST','2026-03-01','2026-07-31',0,0); INSERT INTO student VALUES(1,'합성학생','2000-01-01',123,0); INSERT INTO student_enrollment VALUES(1,1,1,1,2,3,'original-code','TRANSFERRED_IN','2026-03-01',NULL,1); INSERT INTO division VALUES(1,1,'합성과학','합성수업','합성실','original-token',1,0,0,'REGULAR',1); INSERT INTO division_enrollment VALUES(1,1,1,'2026-03-01',NULL); INSERT INTO homeroom_class VALUES(1,1,1,2,'08:30','16:30'); INSERT INTO day_schedule_template VALUES(1,1,'합성일과','NORMAL'); INSERT INTO period_slot VALUES(1,1,1,'original-label','09:00','09:50','CLASS'); INSERT INTO period_slot VALUES(2,1,NULL,'쉬는 시간','09:50','10:00','BREAK'); INSERT INTO weekly_table VALUES(1,1,'BASE',NULL,NULL); INSERT INTO weekly_entry VALUES(1,1,1,1,1,'별도 교실'); INSERT INTO day_override VALUES(1,1,'2026-04-01','TEMP_TIMETABLE',NULL,1,4,'비공개 일과 메모'); INSERT INTO date_override VALUES(1,1,'MOVE','2026-04-02',1,1,'2026-04-03',1,88,'비공개 변경 메모'); INSERT INTO contact VALUES(1,1,'GUARDIAN','합성관계','합성보호자','SYNTHETIC-NON-PHONE',1); INSERT INTO calendar_memo VALUES(1,'2026-04-01','합성 비공개 달력'); INSERT INTO student_memo VALUES(1,1,NULL,1,'합성 비공개 메모',123,456);").unwrap();
    database::validate(&db).unwrap();
    drop(db);
    path
}
fn zipped(files: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, bytes) in files {
        zip.start_file(
            *name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}
fn encrypted(root: &Path) -> std::path::PathBuf {
    let db = fixture(root);
    let zip = archive::pack(&db, &BTreeMap::new()).unwrap();
    let path = root.join("synthetic.teacherbackup");
    std::fs::write(
        &path,
        archive::encrypt(zip, "합성 암호 🔑", "2026-10-11").unwrap(),
    )
    .unwrap();
    path
}
#[test]
fn utf8_password_authentication_and_fresh_nonces_preserve_plaintext() {
    let plaintext = zipped(&[("database/timealert.db", b"synthetic".to_vec())]);
    let first = archive::encrypt(plaintext.clone(), "합성 암호 🔑", "2026-10-11").unwrap();
    let second = archive::encrypt(plaintext.clone(), "합성 암호 🔑", "2026-10-11").unwrap();
    assert_ne!(first, second);
    assert_eq!(
        archive::decrypt(first.clone(), "합성 암호 🔑").unwrap(),
        plaintext
    );
    assert!(archive::decrypt(first.clone(), "다른 암호").is_err());
    let mut tampered = first;
    *tampered.last_mut().unwrap() ^= 1;
    assert!(archive::decrypt(tampered, "합성 암호 🔑").is_err());
    assert!(archive::password(&"가".repeat(342)).is_err());
}
#[test]
fn original_java_utf8_cipher_vector_matches_rust_and_optional_reverse_oracle() {
    // Generated with JDK17 PBEKeySpec + PBKDF2WithHmacSHA256 + AES/GCM/NoPadding,
    // the exact APIs used in TimeAlert's BackupManager.kt (synthetic data only).
    let vector = "54494d45414c4552547c317c377c323032362d31302d31317c3132303030300a000102030405060708090a0b0c0d0e0f101112131415161718191a1baea8ddbe095c4e935a83984edd6f563ea182fdd898d33029790351ac2fe7";
    let bytes = vector
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect();
    assert_eq!(
        archive::decrypt(bytes, "합성 암호 🔑").unwrap(),
        b"SYNTHETIC-UTF8"
    );
    let reverse =
        archive::encrypt(b"SYNTHETIC-UTF8".to_vec(), "합성 암호 🔑", "2026-10-11").unwrap();
    if std::env::var("TEACHERDECK_TIMEALERT_ORACLE").as_deref() == Ok("1") {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .canonicalize()
            .unwrap()
            .join("target/adversarial-review/timealert-oracle");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("rust-java.teacherbackup"), reverse).unwrap();
    }
}
#[test]
fn authenticated_zip_paths_duplicates_and_photo_bombs_are_rejected() {
    let area = area();
    for files in [
        vec![
            ("database/timealert.db", vec![1]),
            ("photos/../escaped", vec![2]),
        ],
        vec![
            ("database/timealert.db", vec![1]),
            ("photos/A.png", vec![2]),
            ("photos/a.png", vec![3]),
        ],
        vec![
            ("database/timealert.db", vec![1]),
            ("photos/CON.png", vec![2]),
        ],
        vec![
            ("database/timealert.db", vec![1]),
            ("photos/large.png", vec![0; archive::PHOTO_LIMIT + 1]),
        ],
    ] {
        let root = temp(&area);
        assert!(archive::extract(zipped(&files), root.path()).is_err());
        assert!(!root.path().parent().unwrap().join("escaped").exists());
    }
    let root = temp(&area);
    let valid = zipped(&[
        ("database/timealert.db", vec![1]),
        ("photos/합성.png", vec![2]),
    ]);
    let files = archive::extract(valid, root.path()).unwrap();
    assert_eq!(files.len(), 1);
    assert!(!root.path().join("합성.png").exists());
}
#[test]
fn schema_room_identity_and_corrupt_wal_are_rejected_before_projection() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let db = database::open(&path).unwrap();
    db.execute_batch("PRAGMA user_version=8").unwrap();
    assert!(database::validate(&db).is_err());
    db.execute_batch(
        "PRAGMA user_version=7;ALTER TABLE student ADD COLUMN unknownFutureColumn TEXT",
    )
    .unwrap();
    assert!(database::validate(&db).is_err());
    let wal = root.path().join("bad-wal");
    std::fs::write(&wal, b"not a WAL").unwrap();
    assert!(database::validate_wal(&wal).is_err());
    let another = temp(&area);
    let path = fixture(another.path());
    let db = database::open(&path).unwrap();
    db.execute("UPDATE room_master_table SET identity_hash='unknown'", [])
        .unwrap();
    assert!(database::validate(&db).is_err());
}
#[test]
fn wal_snapshot_includes_committed_private_changes_and_rejects_bad_checksum() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let db = database::open(&path).unwrap();
    db.execute_batch("PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;UPDATE student_memo SET content='합성 WAL 기록' WHERE id=1;").unwrap();
    let wal = root.path().join("original.db-wal");
    database::validate_wal(&wal).unwrap();
    let snapshot = root.path().join("snapshot.db");
    database::snapshot(&path, &snapshot).unwrap();
    let snap = database::open(&snapshot).unwrap();
    assert_eq!(
        snap.query_row("SELECT content FROM student_memo WHERE id=1", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap(),
        "합성 WAL 기록"
    );
    let mut changed = std::fs::read(&wal).unwrap();
    *changed.last_mut().unwrap() ^= 1;
    let bad = root.path().join("synthetic-corrupt-wal");
    std::fs::write(&bad, changed).unwrap();
    assert!(database::validate_wal(&bad).is_err());
}
#[test]
fn reviewed_apply_is_single_revision_guarded_and_close_removes_private_session() {
    let area = area();
    let root = temp(&area);
    let path = encrypted(root.path());
    let service = TimeAlertService::default();
    let school = SchoolDataService::open(root.path().join("school")).unwrap();
    let preview = service
        .open(
            &path,
            TimeAlertOpenArgs {
                password: "합성 암호 🔑".into(),
            },
            &area,
        )
        .unwrap();
    assert_eq!(
        preview.document.timetable.day_overrides[0].from_period,
        Some(4)
    );
    assert_eq!(
        preview.document.timetable.date_changes[0]
            .target_date
            .as_deref(),
        Some("2026-04-03")
    );
    assert!(
        service
            .open(
                &path,
                TimeAlertOpenArgs {
                    password: "합성 암호 🔑".into()
                },
                &area
            )
            .is_err()
    );
    let args = TimeAlertApplyArgs {
        session_handle: preview.session_handle.clone(),
        expected_revision: 9,
        student_links: vec![],
    };
    assert!(service.apply(args, &school).is_err());
    assert_eq!(school.load().unwrap().revision, 0);
    let args = TimeAlertApplyArgs {
        session_handle: preview.session_handle.clone(),
        expected_revision: 0,
        student_links: vec![],
    };
    let applied = service.apply(args.clone(), &school).unwrap();
    assert_eq!(applied.students.len(), 1);
    assert!(service.apply(args, &school).is_err());
    assert_eq!(school.load().unwrap().revision, 1);
    let private = service
        .session
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .temp
        .path()
        .to_path_buf();
    service
        .close(TimeAlertCloseArgs {
            session_handle: preview.session_handle,
        })
        .unwrap();
    assert!(!private.exists());
    assert!(path.exists());
    assert_eq!(school.load().unwrap().students.len(), 1);
}
#[test]
fn known_edits_keep_room_identity_and_private_tables_and_columns() {
    let area = area();
    let root = temp(&area);
    let path = encrypted(root.path());
    let service = TimeAlertService::default();
    let school = SchoolDataService::open(root.path().join("school")).unwrap();
    let preview = service
        .open(
            &path,
            TimeAlertOpenArgs {
                password: "합성 암호 🔑".into(),
            },
            &area,
        )
        .unwrap();
    let mut applied = service
        .apply(
            TimeAlertApplyArgs {
                session_handle: preview.session_handle.clone(),
                expected_revision: 0,
                student_links: vec![],
            },
            &school,
        )
        .unwrap();
    applied.students[0].name = "합성수정".into();
    applied.timetable.weekly_tables[0].entries[0].weekday = 2;
    school
        .save(SaveSchoolDataArgs {
            expected_revision: 1,
            document: applied,
        })
        .unwrap();
    let output = service
        .export(
            &TimeAlertExportArgs {
                session_handle: Some(preview.session_handle.clone()),
                expected_revision: 2,
                password: "새 합성 암호".into(),
            },
            &school,
            &area,
        )
        .unwrap();
    let stage = temp(&area);
    archive::extract(
        archive::decrypt(output, "새 합성 암호").unwrap(),
        stage.path(),
    )
    .unwrap();
    let db = database::open(&stage.path().join("timealert.db")).unwrap();
    database::validate(&db).unwrap();
    assert_eq!(
        db.query_row("SELECT name FROM student WHERE id=1", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "합성수정"
    );
    for (sql, expected) in [
        ("SELECT birthday FROM student WHERE id=1", "2000-01-01"),
        (
            "SELECT displayStudentCode FROM student_enrollment WHERE id=1",
            "original-code",
        ),
        (
            "SELECT status FROM student_enrollment WHERE id=1",
            "TRANSFERRED_IN",
        ),
        (
            "SELECT content FROM student_memo WHERE id=1",
            "합성 비공개 메모",
        ),
        (
            "SELECT colorToken FROM division WHERE id=1",
            "original-token",
        ),
        ("SELECT label FROM period_slot WHERE id=1", "original-label"),
        (
            "SELECT memo FROM date_override WHERE id=1",
            "비공개 변경 메모",
        ),
        ("SELECT classroom FROM weekly_entry WHERE id=1", "별도 교실"),
    ] {
        assert_eq!(
            db.query_row(sql, [], |r| r.get::<_, String>(0)).unwrap(),
            expected
        );
    }
    assert_eq!(
        db.query_row("SELECT count(*) FROM contact", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    service
        .close(TimeAlertCloseArgs {
            session_handle: preview.session_handle,
        })
        .unwrap();
}

#[test]
fn room_hash_does_not_authorize_changed_foreign_keys_indexes_or_generated_columns() {
    let area = area();
    for sql in [
        "DROP INDEX index_student_photo_studentId;CREATE UNIQUE INDEX index_student_photo_studentId ON student_photo(studentId)",
        "DROP INDEX index_student_photo_studentId;CREATE INDEX index_student_photo_studentId ON student_photo(originalFilePath)",
        "DROP INDEX index_student_photo_studentId;CREATE INDEX index_student_photo_studentId ON student_photo(studentId) WHERE source IS NOT NULL",
        "ALTER TABLE student ADD COLUMN concealed TEXT GENERATED ALWAYS AS (name) VIRTUAL",
    ] {
        let root = temp(&area);
        let path = fixture(root.path());
        let db = database::open(&path).unwrap();
        db.execute_batch(sql).unwrap();
        assert!(database::validate(&db).is_err());
    }
    for (before, after) in [
        ("REFERENCES `student`(`id`)", "REFERENCES `school`(`id`)"),
        ("ON DELETE CASCADE", "ON DELETE SET NULL"),
    ] {
        let root = temp(&area);
        let path = fixture(root.path());
        let db = database::open(&path).unwrap();
        db.execute_batch("PRAGMA writable_schema=ON").unwrap();
        db.execute(
            "UPDATE sqlite_master SET sql=replace(sql,?1,?2) WHERE name='student_photo'",
            rusqlite::params![before, after],
        )
        .unwrap();
        db.execute_batch("PRAGMA writable_schema=OFF;PRAGMA schema_version=999")
            .unwrap();
        drop(db);
        let db = database::open(&path).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT identity_hash FROM room_master_table WHERE id=42",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            schema::ROOM_HASH
        );
        assert!(database::validate(&db).is_err());
    }
}
#[test]
fn date_override_cancellation_is_applied_and_unrepresentable_weekly_selection_is_rejected() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let mut db = database::open(&path).unwrap();
    db.execute("INSERT INTO day_override VALUES(2,1,'2026-04-01','WEEKDAY_SUBSTITUTION',2,NULL,NULL,'합성 요일 메모')",[]).unwrap();
    let original =
        projection::read(&db, "synthetic".into(), &BTreeMap::new(), root.path()).unwrap();
    let mut changed = original.document.clone();
    changed.timetable.day_overrides[0].substitute_weekday = None;
    export::patch(
        &mut db,
        &changed,
        Some(&original.document),
        Some("synthetic"),
        &HashMap::new(),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM day_override WHERE kind='WEEKDAY_SUBSTITUTION'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT memo FROM day_override WHERE kind='TEMP_TIMETABLE'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "비공개 일과 메모"
    );
    changed.timetable.day_overrides[0].weekly_table_id =
        Some(changed.timetable.weekly_tables[0].id.clone());
    assert!(
        export::patch(
            &mut db,
            &changed,
            Some(&original.document),
            Some("synthetic"),
            &HashMap::new(),
            &HashMap::new()
        )
        .is_err()
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM day_override WHERE kind='TEMP_TIMETABLE'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        1
    );
    changed.timetable.day_overrides[0].weekly_table_id = None;
    changed.timetable.day_overrides[0].substitute_weekday = Some(3);
    changed.timetable.day_overrides[0].day_template_id = None;
    changed.timetable.day_overrides[0].from_period = None;
    export::patch(
        &mut db,
        &changed,
        Some(&original.document),
        Some("synthetic"),
        &HashMap::new(),
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM day_override WHERE kind='TEMP_TIMETABLE'",
            [],
            |r| r.get::<_, u32>(0)
        )
        .unwrap(),
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT sourceWeekday FROM day_override WHERE kind='WEEKDAY_SUBSTITUTION'",
            [],
            |r| r.get::<_, u8>(0)
        )
        .unwrap(),
        3
    );
}

fn png() -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    output.into_inner()
}
#[test]
fn referenced_and_unedited_photos_roundtrip_without_original_path_access() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let db = database::open(&path).unwrap();
    db.execute(
        "INSERT INTO student_photo VALUES(1,1,'/unavailable/original/synthetic.png',2,'synthetic')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO student_photo VALUES(2,1,'/unavailable/missing.png',5,'synthetic-missing')",
        [],
    )
    .unwrap();
    drop(db);
    let photo = png();
    let archive_photos = BTreeMap::from([
        ("synthetic.png".to_string(), photo.clone()),
        ("unused.png".to_string(), photo.clone()),
    ]);
    let backup = root.path().join("photos.teacherbackup");
    std::fs::write(
        &backup,
        archive::encrypt(
            archive::pack(&path, &archive_photos).unwrap(),
            "합성 암호",
            "2026-10-11",
        )
        .unwrap(),
    )
    .unwrap();
    let source = std::fs::read(&backup).unwrap();
    let service = TimeAlertService::default();
    let school = SchoolDataService::open(root.path().join("school")).unwrap();
    let preview = service
        .open(
            &backup,
            TimeAlertOpenArgs {
                password: "합성 암호".into(),
            },
            &area,
        )
        .unwrap();
    assert_eq!(preview.photo_count, 2);
    let saved = service
        .apply(
            TimeAlertApplyArgs {
                session_handle: preview.session_handle.clone(),
                expected_revision: 0,
                student_links: vec![],
            },
            &school,
        )
        .unwrap();
    assert!(saved.students[0].photo_id.is_some());
    assert_eq!(saved.photos.len(), 1);
    let exported = service
        .export(
            &TimeAlertExportArgs {
                session_handle: Some(preview.session_handle.clone()),
                expected_revision: 1,
                password: "다른 합성 암호".into(),
            },
            &school,
            &area,
        )
        .unwrap();
    let destination = temp(&area);
    let photos = archive::extract(
        archive::decrypt(exported, "다른 합성 암호").unwrap(),
        destination.path(),
    )
    .unwrap();
    assert_eq!(photos.len(), 2);
    for file in photos.values() {
        assert_eq!(std::fs::read(destination.path().join(file)).unwrap(), photo);
    }
    let db = database::open(&destination.path().join("timealert.db")).unwrap();
    assert_eq!(
        db.query_row(
            "SELECT originalFilePath FROM student_photo WHERE id=1",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "synthetic.png"
    );
    assert_eq!(
        db.query_row(
            "SELECT thumbnailVersion FROM student_photo WHERE id=1",
            [],
            |row| row.get::<_, u32>(0)
        )
        .unwrap(),
        2
    );
    assert_eq!(
        db.query_row("SELECT source FROM student_photo WHERE id=1", [], |row| row
            .get::<_, String>(0))
            .unwrap(),
        "synthetic"
    );
    assert_eq!(
        db.query_row(
            "SELECT originalFilePath FROM student_photo WHERE id=2",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        "/unavailable/missing.png"
    );
    assert_eq!(std::fs::read(&backup).unwrap(), source);
    service
        .close(TimeAlertCloseArgs {
            session_handle: preview.session_handle,
        })
        .unwrap();
}
#[test]
fn explicit_next_semester_link_reuses_master_and_failed_revision_keeps_session() {
    let area = area();
    let root = temp(&area);
    let backup = encrypted(root.path());
    let school = SchoolDataService::open(root.path().join("school")).unwrap();
    let mut current = SchoolDataDocument::default();
    current.students.push(SchoolStudent {
        id: "existing".into(),
        name: "합성 기존 이름".into(),
        photo_id: None,
    });
    school
        .save(SaveSchoolDataArgs {
            expected_revision: 0,
            document: current,
        })
        .unwrap();
    let service = TimeAlertService::default();
    let preview = service
        .open(
            &backup,
            TimeAlertOpenArgs {
                password: "합성 암호 🔑".into(),
            },
            &area,
        )
        .unwrap();
    let link = TimeAlertStudentLink {
        imported_student_id: preview.document.students[0].id.clone(),
        existing_student_id: "existing".into(),
    };
    assert!(
        service
            .apply(
                TimeAlertApplyArgs {
                    session_handle: preview.session_handle.clone(),
                    expected_revision: 0,
                    student_links: vec![link.clone()]
                },
                &school
            )
            .is_err()
    );
    let saved = service
        .apply(
            TimeAlertApplyArgs {
                session_handle: preview.session_handle.clone(),
                expected_revision: 1,
                student_links: vec![link],
            },
            &school,
        )
        .unwrap();
    assert_eq!(saved.students.len(), 1);
    assert_eq!(saved.students[0].name, "합성 기존 이름");
    assert_eq!(saved.enrollments[0].student_id, "existing");
    let output = service
        .export(
            &TimeAlertExportArgs {
                session_handle: Some(preview.session_handle.clone()),
                expected_revision: 2,
                password: "합성 출력 암호".into(),
            },
            &school,
            &area,
        )
        .unwrap();
    let destination = temp(&area);
    archive::extract(
        archive::decrypt(output, "합성 출력 암호").unwrap(),
        destination.path(),
    )
    .unwrap();
    let db = database::open(&destination.path().join("timealert.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM student", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT content FROM student_memo WHERE studentId=1",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "합성 비공개 메모"
    );
    service
        .close(TimeAlertCloseArgs {
            session_handle: preview.session_handle,
        })
        .unwrap();
}
#[test]
fn roster_photos_validate_authority_revision_and_single_apply() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let db = database::open(&path).unwrap();
    let document = projection::read(&db, "synthetic".into(), &BTreeMap::new(), root.path())
        .unwrap()
        .document;
    let school = SchoolDataService::open(root.path().join("school")).unwrap();
    let saved = school
        .save(SaveSchoolDataArgs {
            expected_revision: 0,
            document,
        })
        .unwrap();
    let semester = saved.semesters[0].id.clone();
    let student = saved.students[0].id.clone();
    let args = TimeAlertRosterPhotosArgs {
        session_handle: None,
        semester_id: semester.clone(),
        expected_revision: 1,
        matches: vec![],
        document: None,
    };
    let bytes = zipped(&[
        ("xl/workbook.xml", b"<workbook/>".to_vec()),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>".to_vec()),
        ("xl/media/photo.png", png()),
    ]);
    let service = TimeAlertService::default();
    let preview = service.open_roster(bytes, &args, &school).unwrap();
    assert!(preview.photo_keys[0].thumbnail_base64.is_some());
    let photo = preview.photo_keys[0].photo_key.clone();
    let matching = TimeAlertRosterPhotosArgs {
        session_handle: Some(preview.session_handle.clone()),
        semester_id: semester,
        expected_revision: 1,
        matches: vec![TimeAlertRosterPhotoMatch {
            row_key: "row".into(),
            student_id: student,
            photo_key: photo,
        }],
        document: Some(saved.clone()),
    };
    let mut unknown = matching.clone();
    unknown.matches[0].photo_key = "foreign-private-key".into();
    assert!(service.apply_roster(unknown, &school).is_err());
    assert_eq!(school.load().unwrap().revision, 1);
    school
        .save(SaveSchoolDataArgs {
            expected_revision: 1,
            document: saved.clone(),
        })
        .unwrap();
    assert!(service.apply_roster(matching.clone(), &school).is_err());
    assert_eq!(school.load().unwrap().revision, 2);
    // A failed stale session cannot retarget itself to a later revision.
    let mut retarget = matching;
    retarget.expected_revision = 2;
    retarget.document = Some(school.load().unwrap());
    assert!(service.apply_roster(retarget, &school).is_err());
    service
        .close(TimeAlertCloseArgs {
            session_handle: preview.session_handle,
        })
        .unwrap();
    let bytes = zipped(&[
        ("xl/workbook.xml", b"<workbook/>".to_vec()),
        ("xl/worksheets/sheet1.xml", b"<worksheet/>".to_vec()),
        ("xl/media/photo.png", png()),
    ]);
    let mut args = args;
    args.expected_revision = 2;
    let preview = service.open_roster(bytes, &args, &school).unwrap();
    let matching = TimeAlertRosterPhotosArgs {
        session_handle: Some(preview.session_handle.clone()),
        semester_id: args.semester_id,
        expected_revision: 2,
        matches: vec![TimeAlertRosterPhotoMatch {
            row_key: "row".into(),
            student_id: saved.students[0].id.clone(),
            photo_key: preview.photo_keys[0].photo_key.clone(),
        }],
        document: Some(school.load().unwrap()),
    };
    let result = service.apply_roster(matching.clone(), &school).unwrap();
    let saved = result.document.unwrap();
    assert_eq!(saved.revision, 3);
    assert_eq!(saved.photos.len(), 1);
    assert!(saved.students[0].photo_id.is_some());
    assert!(service.apply_roster(matching, &school).is_err());
    assert!(
        service
            .close(TimeAlertCloseArgs {
                session_handle: preview.session_handle
            })
            .is_err()
    );
}

#[test]
fn original_membership_removal_is_refused_without_changing_historical_relations() {
    let area = area();
    let root = temp(&area);
    let path = fixture(root.path());
    let mut db = database::open(&path).unwrap();
    let original =
        projection::read(&db, "synthetic".into(), &BTreeMap::new(), root.path()).unwrap();
    let mut changed = original.document.clone();
    changed
        .contexts
        .iter_mut()
        .find(|c| c.kind == SchoolContextKind::Division)
        .unwrap()
        .enrollment_ids
        .clear();
    assert!(
        export::patch(
            &mut db,
            &changed,
            Some(&original.document),
            Some("synthetic"),
            &HashMap::new(),
            &HashMap::new()
        )
        .is_err()
    );
    assert_eq!(
        db.query_row(
            "SELECT validTo FROM division_enrollment WHERE id=1",
            [],
            |r| r.get::<_, Option<String>>(0)
        )
        .unwrap(),
        None
    );
}
