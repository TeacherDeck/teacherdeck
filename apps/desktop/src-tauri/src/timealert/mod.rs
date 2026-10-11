// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Main-only, authenticated TimeAlert DB7 portability (ADR-0026).
pub mod archive;
mod database;
mod export;
pub mod projection;
mod roster;
mod schema;
#[cfg(test)]
mod tests;
use crate::platform::{TempArea, TempDir};
use crate::school_data::{SchoolDataService, token};
use deck_core::caps::school_data::*;
use deck_core::caps::timealert::*;
use deck_core::{DeckError, ErrorCode};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;

fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "백업 형식·암호·자료의 연결을 확인해 주세요. 원본은 유지돼요.",
    )
}
fn internal() -> DeckError {
    crate::school_data::internal()
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "열린 백업을 닫거나 최신 자료를 다시 확인해 주세요.",
    )
}
struct BackupSession {
    handle: String,
    projection: projection::Projection,
    applied: bool,
    baseline: Option<SchoolDataDocument>,
    aliases: HashMap<String, i64>,
    photo_files: BTreeMap<String, String>,
    reads: Vec<Mutex<crate::file_read::FileReadSession>>,
    directory: crate::file_read::DirectoryGuard,
    temp: TempDir,
}
/// Host-owned sessions with no module bridge entry points or persistent passwords.
#[derive(Default)]
pub struct TimeAlertService {
    session: Mutex<Option<BackupSession>>,
    roster: Mutex<Option<roster::RosterSession>>,
}
pub fn read_file(path: &Path, limit: usize) -> Result<Vec<u8>, DeckError> {
    let mut read = crate::file_read::FileReadSession::open(path)?;
    if read.size() == 0 || read.size() > limit as u64 {
        return Err(invalid());
    }
    let mut bytes = Vec::with_capacity(read.size() as usize);
    while bytes.len() < read.size() as usize {
        bytes.extend(read.read_chunk(
            bytes.len() as u64,
            (read.size() as usize - bytes.len()).min(crate::file_read::READ_CHUNK_BYTES),
        )?);
    }
    Ok(bytes)
}
impl BackupSession {
    fn validate(&self) -> Result<(), DeckError> {
        self.directory.validate()?;
        for read in &self.reads {
            read.lock().map_err(|_| internal())?.read_chunk(0, 0)?;
        }
        Ok(())
    }
}
impl TimeAlertService {
    /// Authenticates and validates one selected source before returning its narrow preview.
    pub fn open(
        &self,
        path: &Path,
        args: TimeAlertOpenArgs,
        area: &TempArea,
    ) -> Result<TimeAlertPreview, DeckError> {
        let mut session = self.session.lock().map_err(|_| internal())?;
        if session.is_some() {
            return Err(busy());
        }
        let zip = archive::decrypt(read_file(path, archive::BACKUP_LIMIT)?, &args.password)?;
        let temp = area
            .create_dir(&mut crate::platform::OsRng)
            .map_err(|_| internal())?;
        let photos = archive::extract(zip, temp.path())?;
        database::validate_wal(&temp.path().join("timealert.db-wal"))?;
        database::snapshot(
            &temp.path().join("timealert.db"),
            &temp.path().join("snapshot.db"),
        )?;
        let db = database::open(&temp.path().join("snapshot.db"))?;
        let projection = projection::read(&db, token(), &photos, temp.path())?;
        drop(db);
        let handle = token();
        let preview = TimeAlertPreview {
            session_handle: handle.clone(),
            schema_version: 7,
            document: projection.document.clone(),
            photo_count: photos.len() as u32,
            tables: projection.tables.clone(),
            warnings: projection.warnings.clone(),
        };
        let directory = crate::file_read::DirectoryGuard::open(temp.path())?;
        let mut pool = crate::file_read::FileReadPool::default();
        let mut reads = vec![Mutex::new(pool.open(&temp.path().join("snapshot.db"))?)];
        for file in photos.values() {
            reads.push(Mutex::new(pool.open(&temp.path().join(file))?));
        }
        *session = Some(BackupSession {
            handle,
            projection,
            applied: false,
            baseline: None,
            aliases: HashMap::new(),
            photo_files: photos,
            reads,
            directory,
            temp,
        });
        Ok(preview)
    }
    /// Closing releases file/directory guards before cleaning only this service's temporary area.
    pub fn close(&self, args: TimeAlertCloseArgs) -> Result<(), DeckError> {
        let mut session = self.session.lock().map_err(|_| internal())?;
        if session
            .as_ref()
            .is_some_and(|current| current.handle == args.session_handle)
        {
            let current = session.take().ok_or_else(internal)?;
            drop(current.reads);
            drop(current.directory);
            drop(current.temp);
            return Ok(());
        }
        let mut roster = self.roster.lock().map_err(|_| internal())?;
        if roster
            .as_ref()
            .is_some_and(|current| current.handle == args.session_handle)
        {
            roster.take();
            return Ok(());
        }
        Err(crate::school_data::denied())
    }
    /// One confirmed merge; duplicate applies and stale revisions never alter school data.
    pub fn apply(
        &self,
        args: TimeAlertApplyArgs,
        school: &SchoolDataService,
    ) -> Result<SchoolDataDocument, DeckError> {
        let mut session = self.session.lock().map_err(|_| internal())?;
        let session = session
            .as_mut()
            .filter(|s| s.handle == args.session_handle)
            .ok_or_else(crate::school_data::denied)?;
        if session.applied {
            return Err(busy());
        }
        session.validate()?;
        let mut current = school.load()?;
        if current.revision != args.expected_revision {
            return Err(busy());
        }
        let mut imported = session.projection.document.clone();
        let mut aliases = HashMap::new();
        let mut seen = HashSet::new();
        for link in &args.student_links {
            if !seen.insert(link.imported_student_id.clone())
                || aliases.contains_key(&link.existing_student_id)
                || !current
                    .students
                    .iter()
                    .any(|s| s.id == link.existing_student_id)
            {
                return Err(invalid());
            }
            let original = projection::number(
                &session.projection.namespace,
                "student",
                &link.imported_student_id,
            )
            .ok_or_else(invalid)?;
            let student = imported
                .students
                .iter_mut()
                .find(|s| s.id == link.imported_student_id)
                .ok_or_else(invalid)?;
            student.id = link.existing_student_id.clone();
            let existing = current
                .students
                .iter_mut()
                .find(|s| s.id == link.existing_student_id)
                .ok_or_else(invalid)?;
            // Explicit linking preserves the existing master name and photo; imported photo stays in original backup.
            student.name = existing.name.clone();
            student.photo_id = existing.photo_id.clone();
            for enrollment in &mut imported.enrollments {
                if enrollment.student_id == link.imported_student_id {
                    enrollment.student_id = link.existing_student_id.clone();
                }
            }
            aliases.insert(link.existing_student_id.clone(), original);
        }
        let referenced: HashSet<_> = imported
            .students
            .iter()
            .filter_map(|s| s.photo_id.as_ref())
            .collect();
        imported
            .photos
            .retain(|p| referenced.contains(&p.id) && !current.photos.contains(p));
        let photos: BTreeMap<_, _> = session
            .projection
            .photos
            .iter()
            .filter(|(id, _)| imported.photos.iter().any(|p| p.id == **id))
            .map(|(id, bytes)| (id.clone(), bytes.clone()))
            .collect();
        current.students.extend(
            imported
                .students
                .iter()
                .filter(|s| !aliases.contains_key(&s.id))
                .cloned(),
        );
        current.semesters.extend(imported.semesters.clone());
        current.enrollments.extend(imported.enrollments.clone());
        current.contexts.extend(imported.contexts.clone());
        current.photos.extend(imported.photos.clone());
        current
            .timetable
            .day_templates
            .extend(imported.timetable.day_templates.clone());
        current
            .timetable
            .weekly_tables
            .extend(imported.timetable.weekly_tables.clone());
        current
            .timetable
            .day_overrides
            .extend(imported.timetable.day_overrides.clone());
        current
            .timetable
            .date_changes
            .extend(imported.timetable.date_changes.clone());
        let result = school.apply_native_import(
            SaveSchoolDataArgs {
                expected_revision: args.expected_revision,
                document: current,
            },
            &photos,
        )?;
        session.baseline = Some(imported);
        session.aliases = aliases;
        session.applied = true;
        Ok(result)
    }
    /// Creates an authenticated backup containing saved data and all retained private original rows.
    pub fn export(
        &self,
        args: &TimeAlertExportArgs,
        school: &SchoolDataService,
        area: &TempArea,
    ) -> Result<Vec<u8>, DeckError> {
        archive::password(&args.password)?;
        let (document, saved_photos) = school.backup_photos(args.expected_revision)?;
        let session = self.session.lock().map_err(|_| internal())?;
        let original = args
            .session_handle
            .as_ref()
            .map(|handle| {
                session
                    .as_ref()
                    .filter(|s| s.handle == *handle)
                    .ok_or_else(crate::school_data::denied)
            })
            .transpose()?;
        let temp = area
            .create_dir(&mut crate::platform::OsRng)
            .map_err(|_| internal())?;
        let db_path = temp.path().join("export.db");
        let mut photo_bytes = BTreeMap::new();
        let mut photo_names = HashMap::new();
        let mut db = if let Some(session) = original {
            session.validate()?;
            database::snapshot(&session.temp.path().join("snapshot.db"), &db_path)?;
            for (name, file) in &session.photo_files {
                photo_bytes.insert(
                    name.clone(),
                    read_file(&session.temp.path().join(file), archive::PHOTO_LIMIT)?,
                );
            }
            database::open(&db_path)?
        } else {
            database::create(&db_path)?
        };
        for (id, bytes) in saved_photos {
            let extension = match projection::photo_mime(&bytes)? {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                _ => "webp",
            };
            let name = original
                .and_then(|s| s.projection.photo_names.get(&id))
                .cloned()
                .unwrap_or_else(|| format!("teacherdeck_{id}.{extension}"));
            if photo_bytes.get(&name).is_some_and(|old| old != &bytes) {
                return Err(invalid());
            }
            photo_names.insert(id, name.clone());
            photo_bytes.insert(name, bytes);
        }
        let aliases = original.map(|s| s.aliases.clone()).unwrap_or_default();
        export::patch(
            &mut db,
            &document,
            original.and_then(|s| s.baseline.as_ref()),
            original.map(|s| s.projection.namespace.as_str()),
            &aliases,
            &photo_names,
        )?;
        export::rebase_photos(&mut db, &photo_bytes)?;
        drop(db);
        let zip = archive::pack(&db_path, &photo_bytes)?;
        archive::encrypt(
            zip,
            &args.password,
            &chrono::Local::now().format("%Y-%m-%d").to_string(),
        )
    }
}
