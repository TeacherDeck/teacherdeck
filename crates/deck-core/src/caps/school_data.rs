// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Shell-owned school data and narrow module projections (ADR-0020).

use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use ts_rs::TS;

macro_rules! model {
    ($(#[$meta:meta])* $name:ident { $($(#[$field_meta:meta])* $field:ident : $ty:ty),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        pub struct $name { $($(#[$field_meta])* #[doc = concat!("Validated `", stringify!($field), "` value in this school-data contract.")] pub $field: $ty),* }
    };
}

/// A class or a teaching group; neither kind confers authority itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum SchoolContextKind {
    /// Academic class.
    Homeroom,
    /// Teaching group, with explicit enrollment membership.
    Division,
}
/// Explicit fields the teacher allows a module to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum SchoolScope {
    /// Names and academic enrollment identifiers.
    RosterBasic,
    /// Photo handles linked to a permitted roster snapshot.
    Photos,
    /// Timetable entries belonging to permitted contexts.
    Timetable,
}
/// Current enrollment status, without attendance or private notes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum SchoolEnrollmentStatus {
    /// Currently participating.
    Active,
    /// Retained enrollment after transfer.
    Transferred,
    /// Retained record hidden from normal participation.
    Hidden,
}
/// Original date-change meanings; changes may share a swap group.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "UPPERCASE")]
pub enum SchoolDateChangeKind {
    /// Moves the original period to another period.
    Move,
    /// Cancels the original period.
    Cancel,
    /// Adds a new period.
    Add,
}

model! { /// Academic semester. Archived semesters are protected from edits.
SchoolSemester { id:String, academic_year:u16, term:u8, start_date:String, end_date:String, archived:bool, read_only:bool } }
model! { /// Stable student master; enrollment identity lives separately.
SchoolStudent { id:String, name:String, photo_id:Option<String> } }
model! { /// Semester-specific academic identity.
SchoolEnrollment { id:String, student_id:String, semester_id:String, grade:u8, class_number:u16, student_number:u16, status:SchoolEnrollmentStatus } }
model! { /// A class or teaching context containing enrollment ids, never names as keys.
SchoolContext { id:String, semester_id:String, kind:SchoolContextKind, label:String, subject:Option<String>, room:Option<String>, enrollment_ids:Vec<String>, weekly_table_id:Option<String> } }
model! { /// Period-to-time slot; minutes from midnight, local school time.
SchoolDaySlot { period:u8, start_minute:u16, end_minute:u16 } }
model! { /// Named daily time grid. A date override may replace only specified periods.
SchoolDayTemplate { id:String, semester_id:String, label:String, slots:Vec<SchoolDaySlot> } }
model! { /// Weekday-to-teaching-context slot, with weekday 1 through 7.
SchoolWeeklySlot { weekday:u8, period:u8, context_id:String } }
model! { /// Full weekly table, optionally replacing the base table during a date range.
SchoolWeeklyTable { id:String, semester_id:String, label:String, start_date:Option<String>, end_date:Option<String>, entries:Vec<SchoolWeeklySlot> } }
model! { /// Independent date choices for weekday, daily times and weekly lessons.
SchoolDayOverride { id:String, semester_id:String, date:String, substitute_weekday:Option<u8>, day_template_id:Option<String>, weekly_table_id:Option<String> } }
model! { /// Date lesson change retaining move/cancel/add and swap grouping.
SchoolDateChange { id:String, semester_id:String, date:String, kind:SchoolDateChangeKind, context_id:String, from_period:Option<u8>, to_period:Option<u8>, change_group_id:Option<String> } }
model! { /// Timetable data has separate time and lesson axes; no alarm settings.
SchoolTimetable { day_templates:Vec<SchoolDayTemplate>, weekly_tables:Vec<SchoolWeeklyTable>, day_overrides:Vec<SchoolDayOverride>, date_changes:Vec<SchoolDateChange> } }
model! { /// Host-owned photo metadata. Original filenames and paths never appear.
SchoolPhotoInfo { id:String, size:u32, mime_type:String } }
model! { /// Versioned shell-owned data, excluding contact/birthday/attendance/private notes.
SchoolDataDocument { version:u8, revision:u32, semesters:Vec<SchoolSemester>, students:Vec<SchoolStudent>, enrollments:Vec<SchoolEnrollment>, contexts:Vec<SchoolContext>, timetable:SchoolTimetable, photos:Vec<SchoolPhotoInfo> } }
model! { /// Optimistic shell save; stale revisions cannot replace newer work.
SaveSchoolDataArgs { expected_revision:u32, document:SchoolDataDocument } }
model! { /// Non-identifying context list, scoped to one owner's authority.
SchoolContextSummary { context_id:String, semester_id:String, kind:SchoolContextKind, label:String, member_count:u16, revision:u32 } }
model! { /// Request made by a module, then narrowed and confirmed by the trusted shell.
SchoolRequestedAccess { kinds:Vec<SchoolContextKind>, scopes:Vec<SchoolScope>, remember:bool } }
model! { /// Opaque owner-isolated grant. Persistence never bypasses revalidation.
SchoolAccessGrant { grant_handle:String, scopes:Vec<SchoolScope>, contexts:Vec<SchoolContextSummary>, persistent:bool } }
model! { /// A module sees only its own permissions; no student information without a grant.
SchoolAccessStatus { permitted:bool, revision:u32, contexts:Vec<SchoolContextSummary>, scopes:Vec<SchoolScope>, grants:Vec<SchoolAccessGrant> } }
model! { /// Opaque grant argument shared by list/revoke operations.
SchoolGrantArgs { grant_handle:String } }
model! { /// Explicit context read, optionally protecting against a revision change.
SchoolReadRosterArgs { grant_handle:String, context_id:String, expected_revision:Option<u32> } }
model! { /// Explicit allowed-semester timetable read.
SchoolReadTimetableArgs { grant_handle:String, semester_id:String, expected_revision:Option<u32> } }
model! { /// Restricted student projection with optional photo handle only under photos scope.
SchoolStudentSummary { student_id:String, enrollment_id:String, grade:u8, class_number:u16, student_number:u16, display_student_code:String, name:String, status:SchoolEnrollmentStatus, #[serde(skip_serializing_if="Option::is_none")] #[ts(optional)] photo_handle:Option<String> } }
model! { /// Immutable roster projection for one explicit context and revision.
SchoolRosterSnapshot { snapshot_id:String, revision:u32, semester:SchoolSemester, context:SchoolContextSummary, students:Vec<SchoolStudentSummary> } }
model! { /// Timetable projection excludes ungranted teaching contexts and private data.
SchoolTimetableSnapshot { snapshot_id:String, revision:u32, semester:SchoolSemester, contexts:Vec<SchoolContextSummary>, timetable:SchoolTimetable } }
model! { /// A photo requires the matching live snapshot and owner grant.
SchoolOpenPhotoArgs { grant_handle:String, snapshot_id:String, photo_handle:String } }
model! { /// Authenticated bounded photo reading on the existing file-resource route.
SchoolPhotoResource { resource_handle:String, url:String, size:u32, mime_type:String, chunk_bytes:u32 } }
model! { /// Opaque photo resource close operation.
SchoolClosePhotoArgs { resource_handle:String } }
model! { /// Trusted-shell pending request; module id is supplied by the host bridge.
SchoolAccessRequest { request_id:String, module_id:String, module_name:String, requested:SchoolRequestedAccess, contexts:Vec<SchoolContextSummary> } }
model! { /// Trusted-shell response; cannot expand the module's requested kinds or scopes.
SchoolAccessResolution { request_id:String, allow:bool, context_ids:Vec<String>, scopes:Vec<SchoolScope>, remember:bool } }
model! { /// Trusted-shell display of an existing grant, never sent to other modules.
SchoolGrantRecord { module_id:String, grant:SchoolAccessGrant } }
model! { /// Native photo picker target. Student identity is validated before selection.
SchoolImportPhotoArgs { student_id:String, expected_revision:u32 } }
model! { /// Bounded XML parts from a trusted native XLSX picker; binary photos stay out of this projection.
SchoolWorkbookInput { parts:HashMap<String,String>, photo_count:u32 } }
model! { /// Trusted shell rows for an append-new XLSX output. Existing files are preserved.
SchoolWorkbookOutputArgs { sheet_name:String, rows:Vec<Vec<String>> } }

impl Default for SchoolDataDocument {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            semesters: vec![],
            students: vec![],
            enrollments: vec![],
            contexts: vec![],
            photos: vec![],
            timetable: SchoolTimetable {
                day_templates: vec![],
                weekly_tables: vec![],
                day_overrides: vec![],
                date_changes: vec![],
            },
        }
    }
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "학기·명부·시간표 자료의 형식과 연결을 확인해 주세요.",
    )
}
/// Identifier validation for shell data, never a path or authority token.
pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c))
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max && !value.chars().any(char::is_control)
}
/// Strict calendar date validation without an OS or time-library dependency.
pub fn valid_date(value: &str) -> bool {
    if value.len() != 10 {
        return false;
    }
    let parts: Vec<_> = value.split('-').collect();
    let [year, month, day] = parts.as_slice() else {
        return false;
    };
    if year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || !parts.iter().all(|p| p.bytes().all(|c| c.is_ascii_digit()))
    {
        return false;
    }
    let (Ok(y), Ok(m), Ok(d)) = (year.parse::<u16>(), month.parse::<u8>(), day.parse::<u8>())
    else {
        return false;
    };
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => return false,
    };
    (2000..=2200).contains(&y) && d > 0 && d <= days
}
fn unique<'a>(mut ids: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = HashSet::new();
    ids.all(|id| valid_id(id) && seen.insert(id))
}
impl SchoolDataDocument {
    /// Validates relationships and bounds before persistence or projection. No silent truncation.
    pub fn validate(&self) -> Result<(), DeckError> {
        if self.version != 1
            || self.semesters.len() > 32
            || self.students.len() > 10000
            || self.enrollments.len() > 20000
            || self.contexts.len() > 1000
            || self.photos.len() > 20000
        {
            return Err(invalid());
        }
        if !unique(self.semesters.iter().map(|s| s.id.as_str()))
            || !unique(self.students.iter().map(|s| s.id.as_str()))
            || !unique(self.enrollments.iter().map(|s| s.id.as_str()))
            || !unique(self.contexts.iter().map(|s| s.id.as_str()))
            || !unique(self.photos.iter().map(|s| s.id.as_str()))
        {
            return Err(invalid());
        }
        let semesters: HashSet<_> = self.semesters.iter().map(|s| s.id.as_str()).collect();
        let students: HashSet<_> = self.students.iter().map(|s| s.id.as_str()).collect();
        let photos: HashSet<_> = self.photos.iter().map(|s| s.id.as_str()).collect();
        for s in &self.semesters {
            if !(2000..=2200).contains(&s.academic_year)
                || !(1..=2).contains(&s.term)
                || !valid_date(&s.start_date)
                || !valid_date(&s.end_date)
                || s.start_date > s.end_date
                || (s.archived && !s.read_only)
            {
                return Err(invalid());
            }
        }
        for s in &self.students {
            if !text(&s.name, 40)
                || s.photo_id
                    .as_ref()
                    .is_some_and(|p| !photos.contains(p.as_str()))
            {
                return Err(invalid());
            }
        }
        let mut academic = HashSet::new();
        let mut by_student = HashSet::new();
        let enrollment: HashMap<_, _> = self
            .enrollments
            .iter()
            .map(|e| (e.id.as_str(), e))
            .collect();
        for e in &self.enrollments {
            if !students.contains(e.student_id.as_str())
                || !semesters.contains(e.semester_id.as_str())
                || !(1..=9).contains(&e.grade)
                || !(1..=99).contains(&e.class_number)
                || !(1..=999).contains(&e.student_number)
                || !academic.insert((&e.semester_id, e.grade, e.class_number, e.student_number))
                || !by_student.insert((&e.semester_id, &e.student_id))
            {
                return Err(invalid());
            }
        }
        for c in &self.contexts {
            if !semesters.contains(c.semester_id.as_str())
                || !text(&c.label, 80)
                || c.subject.as_ref().is_some_and(|s| !text(s, 80))
                || c.room.as_ref().is_some_and(|s| !text(s, 80))
                || c.enrollment_ids.len() > 1000
                || !unique(c.enrollment_ids.iter().map(String::as_str))
                || c.enrollment_ids.iter().any(|id| {
                    enrollment
                        .get(id.as_str())
                        .is_none_or(|e| e.semester_id != c.semester_id)
                })
            {
                return Err(invalid());
            }
        }
        for semester in &self.semesters {
            if self
                .contexts
                .iter()
                .filter(|c| c.semester_id == semester.id && c.kind == SchoolContextKind::Division)
                .count()
                > 100
            {
                return Err(invalid());
            }
        }
        let photo_bytes: u64 = self.photos.iter().map(|p| u64::from(p.size)).sum();
        if photo_bytes > 256 * 1024 * 1024
            || self.photos.iter().any(|p| {
                p.id.len() != 32
                    || !p
                        .id
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    || p.size == 0
                    || p.size > 16 * 1024 * 1024
                    || !["image/png", "image/jpeg", "image/webp"].contains(&p.mime_type.as_str())
            })
        {
            return Err(invalid());
        }
        self.validate_timetable(&semesters)?;
        Ok(())
    }
    fn validate_timetable(&self, semesters: &HashSet<&str>) -> Result<(), DeckError> {
        let t = &self.timetable;
        if t.day_templates.len() > 32
            || t.weekly_tables.len() > 32
            || t.day_overrides.len() > 2000
            || t.date_changes.len() > 2000
            || !unique(t.day_templates.iter().map(|s| s.id.as_str()))
            || !unique(t.weekly_tables.iter().map(|s| s.id.as_str()))
            || !unique(t.day_overrides.iter().map(|s| s.id.as_str()))
            || !unique(t.date_changes.iter().map(|s| s.id.as_str()))
        {
            return Err(invalid());
        }
        let contexts: HashMap<_, _> = self.contexts.iter().map(|c| (c.id.as_str(), c)).collect();
        for day in &t.day_templates {
            let mut periods = HashSet::new();
            if !semesters.contains(day.semester_id.as_str())
                || !text(&day.label, 80)
                || day.slots.is_empty()
                || day.slots.len() > 64
                || day.slots.iter().any(|s| {
                    s.period == 0
                        || s.period > 64
                        || s.start_minute >= s.end_minute
                        || s.end_minute > 1440
                        || !periods.insert(s.period)
                })
            {
                return Err(invalid());
            }
        }
        for table in &t.weekly_tables {
            let mut positions = HashSet::new();
            if !semesters.contains(table.semester_id.as_str())
                || !text(&table.label, 80)
                || table.entries.len() > 105
                || table.start_date.is_some() != table.end_date.is_some()
                || table.start_date.as_ref().is_some_and(|d| !valid_date(d))
                || table.end_date.as_ref().is_some_and(|d| !valid_date(d))
                || table
                    .start_date
                    .as_ref()
                    .zip(table.end_date.as_ref())
                    .is_some_and(|(a, b)| a > b)
                || table.entries.iter().any(|s| {
                    s.weekday == 0
                        || s.weekday > 7
                        || s.period == 0
                        || s.period > 64
                        || !positions.insert((s.weekday, s.period))
                        || contexts
                            .get(s.context_id.as_str())
                            .is_none_or(|c| c.semester_id != table.semester_id)
                })
            {
                return Err(invalid());
            }
        }
        for context in &self.contexts {
            if context.weekly_table_id.as_ref().is_some_and(|id| {
                !t.weekly_tables
                    .iter()
                    .any(|table| table.id == *id && table.semester_id == context.semester_id)
            }) {
                return Err(invalid());
            }
        }
        let mut dates = HashSet::new();
        for day in &t.day_overrides {
            if !semesters.contains(day.semester_id.as_str())
                || !valid_date(&day.date)
                || !dates.insert((&day.semester_id, &day.date))
                || day.substitute_weekday.is_some_and(|d| d == 0 || d > 7)
                || day.day_template_id.as_ref().is_some_and(|id| {
                    !t.day_templates
                        .iter()
                        .any(|d| d.id == *id && d.semester_id == day.semester_id)
                })
                || day.weekly_table_id.as_ref().is_some_and(|id| {
                    !t.weekly_tables
                        .iter()
                        .any(|d| d.id == *id && d.semester_id == day.semester_id)
                })
            {
                return Err(invalid());
            }
        }
        for change in &t.date_changes {
            if !semesters.contains(change.semester_id.as_str())
                || !valid_date(&change.date)
                || contexts
                    .get(change.context_id.as_str())
                    .is_none_or(|c| c.semester_id != change.semester_id)
                || change.from_period.is_some_and(|p| p == 0 || p > 64)
                || change.to_period.is_some_and(|p| p == 0 || p > 64)
                || change
                    .change_group_id
                    .as_ref()
                    .is_some_and(|id| !valid_id(id))
            {
                return Err(invalid());
            }
            let shape = match change.kind {
                SchoolDateChangeKind::Move => {
                    change.from_period.is_some()
                        && change.to_period.is_some()
                        && change.from_period != change.to_period
                }
                SchoolDateChangeKind::Cancel => {
                    change.from_period.is_some() && change.to_period.is_none()
                }
                SchoolDateChangeKind::Add => {
                    change.from_period.is_none() && change.to_period.is_some()
                }
            };
            if !shape {
                return Err(invalid());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dates_and_identifiers_are_bounded() {
        assert!(valid_date("2028-02-29"));
        assert!(!valid_date("2026-02-29"));
        assert!(!valid_date("2026-2-03"));
        assert!(valid_id("semester-1"));
        assert!(!valid_id("../photo"));
    }
    #[test]
    fn empty_document_and_unknown_fields() {
        assert!(SchoolDataDocument::default().validate().is_ok());
        let mut value = serde_json::to_value(SchoolDataDocument::default()).unwrap();
        value["contacts"] = serde_json::json!([]);
        assert!(serde_json::from_value::<SchoolDataDocument>(value).is_err());
    }
    #[test]
    fn enrollment_identity_and_links_are_not_names() {
        let mut d = SchoolDataDocument::default();
        d.semesters.push(SchoolSemester {
            id: "sem1".into(),
            academic_year: 2026,
            term: 1,
            start_date: "2026-03-01".into(),
            end_date: "2026-07-31".into(),
            archived: false,
            read_only: false,
        });
        for i in 1..=2 {
            d.students.push(SchoolStudent {
                id: format!("s{i}"),
                name: "합성학생".into(),
                photo_id: None,
            });
            d.enrollments.push(SchoolEnrollment {
                id: format!("e{i}"),
                student_id: format!("s{i}"),
                semester_id: "sem1".into(),
                grade: 1,
                class_number: i,
                student_number: 1,
                status: SchoolEnrollmentStatus::Active,
            });
        }
        assert!(d.validate().is_ok());
        d.enrollments[1].class_number = 1;
        assert!(d.validate().is_err());
        d.enrollments[1].class_number = 2;
        d.enrollments[1].student_id = "missing".into();
        assert!(d.validate().is_err());
    }
}
