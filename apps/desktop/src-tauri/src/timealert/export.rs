// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Patches known fields without rebuilding private Room tables or cascading record identity.
use super::{invalid, projection};
use deck_core::DeckError;
use deck_core::caps::school_data::*;
use rusqlite::{Connection, Transaction, params};
use std::collections::HashMap;

fn run(db: &Transaction<'_>, sql: &str, args: impl rusqlite::Params) -> Result<(), DeckError> {
    db.execute(sql, args).map(|_| ()).map_err(|_| invalid())
}
fn insert(db: &Transaction<'_>, sql: &str, args: impl rusqlite::Params) -> Result<i64, DeckError> {
    run(db, sql, args)?;
    Ok(db.last_insert_rowid())
}
fn id(map: &HashMap<String, i64>, key: &str) -> Result<i64, DeckError> {
    map.get(key).copied().ok_or_else(invalid)
}
fn hhmm(value: u16) -> String {
    format!("{:02}:{:02}", value / 60, value % 60)
}
fn status(value: SchoolEnrollmentStatus) -> &'static str {
    match value {
        SchoolEnrollmentStatus::Active => "ACTIVE",
        SchoolEnrollmentStatus::Transferred => "TRANSFERRED_OUT",
        SchoolEnrollmentStatus::Hidden => "HIDDEN",
    }
}
pub fn patch(
    db: &mut Connection,
    document: &SchoolDataDocument,
    baseline: Option<&SchoolDataDocument>,
    namespace: Option<&str>,
    aliases: &HashMap<String, i64>,
    photo_names: &HashMap<String, String>,
) -> Result<(), DeckError> {
    document.validate()?;
    // DB7 has no date-specific weekly-table selector. Refuse rather than silently lose it.
    if document
        .timetable
        .day_overrides
        .iter()
        .any(|day| day.weekly_table_id.is_some())
    {
        return Err(invalid());
    }
    if let Some(before) = baseline {
        // These rows have private children. Removing them must not cascade attendance or notes.
        if before
            .students
            .iter()
            .any(|v| !document.students.iter().any(|n| n.id == v.id))
            || before
                .semesters
                .iter()
                .any(|v| !document.semesters.iter().any(|n| n.id == v.id))
            || before
                .enrollments
                .iter()
                .any(|v| !document.enrollments.iter().any(|n| n.id == v.id))
            || before
                .contexts
                .iter()
                .any(|v| !document.contexts.iter().any(|n| n.id == v.id))
            || before.timetable.day_templates.iter().any(|v| {
                !document
                    .timetable
                    .day_templates
                    .iter()
                    .any(|n| n.id == v.id)
            })
            || before.timetable.weekly_tables.iter().any(|v| {
                !document
                    .timetable
                    .weekly_tables
                    .iter()
                    .any(|n| n.id == v.id)
            })
            || before.timetable.day_overrides.iter().any(|v| {
                !document
                    .timetable
                    .day_overrides
                    .iter()
                    .any(|n| n.id == v.id)
            })
            || before
                .timetable
                .date_changes
                .iter()
                .any(|v| !document.timetable.date_changes.iter().any(|n| n.id == v.id))
        {
            return Err(invalid());
        }
    }
    if let Some(before) = baseline {
        // Removing an original membership cannot silently retain it or erase historical attendance.
        if before.contexts.iter().any(|context| {
            document
                .contexts
                .iter()
                .find(|next| next.id == context.id)
                .is_some_and(|next| {
                    context
                        .enrollment_ids
                        .iter()
                        .any(|id| !next.enrollment_ids.contains(id))
                })
        }) {
            return Err(invalid());
        }
    }
    let transaction = db.transaction().map_err(|_| invalid())?;
    let original =
        |table: &str, key: &str| namespace.and_then(|n| projection::number(n, table, key));
    let school: i64 = transaction.query_row("SELECT id FROM school ORDER BY isDefault DESC,id LIMIT 1", [], |r| r.get(0)).or_else(|error| {
        if error != rusqlite::Error::QueryReturnedNoRows { return Err(error); }
        transaction.execute("INSERT INTO school(name,isDefault,displayOrder,active) VALUES('TeacherDeck',1,0,1)", [])?;
        Ok(transaction.last_insert_rowid())
    }).map_err(|_| invalid())?;
    let mut semesters = HashMap::new();
    let mut students = HashMap::new();
    let mut enrollments = HashMap::new();
    let mut contexts = HashMap::new();
    let mut templates = HashMap::new();
    let mut weeklies = HashMap::new();
    for semester in &document.semesters {
        let kind = if semester.term == 1 {
            "FIRST"
        } else {
            "SECOND"
        };
        let value = if let Some(value) = original("semester", &semester.id) {
            run(
                &transaction,
                "UPDATE semester SET type=?1,startDate=?2,endDate=?3,archived=?4,readOnly=?5 WHERE id=?6",
                params![
                    kind,
                    semester.start_date,
                    semester.end_date,
                    semester.archived,
                    semester.read_only,
                    value
                ],
            )?;
            // Preserve school ownership while allowing year corrections via an existing/new year row.
            run(
                &transaction,
                "INSERT OR IGNORE INTO academic_year(year) VALUES(?1)",
                [semester.academic_year],
            )?;
            run(
                &transaction,
                "UPDATE semester SET academicYearId=(SELECT id FROM academic_year WHERE year=?1) WHERE id=?2",
                params![semester.academic_year, value],
            )?;
            value
        } else {
            run(
                &transaction,
                "INSERT OR IGNORE INTO academic_year(year) VALUES(?1)",
                [semester.academic_year],
            )?;
            insert(
                &transaction,
                "INSERT INTO semester(academicYearId,schoolId,type,startDate,endDate,archived,readOnly) SELECT id,?1,?2,?3,?4,?5,?6 FROM academic_year WHERE year=?7",
                params![
                    school,
                    kind,
                    semester.start_date,
                    semester.end_date,
                    semester.archived,
                    semester.read_only,
                    semester.academic_year
                ],
            )?
        };
        semesters.insert(semester.id.clone(), value);
    }
    for student in &document.students {
        let value = if let Some(value) = aliases
            .get(&student.id)
            .copied()
            .or_else(|| original("student", &student.id))
        {
            run(
                &transaction,
                "UPDATE student SET name=?1 WHERE id=?2",
                params![student.name, value],
            )?;
            value
        } else {
            insert(
                &transaction,
                "INSERT INTO student(name,createdAt,archived) VALUES(?1,0,0)",
                [&student.name],
            )?
        };
        students.insert(student.id.clone(), value);
        let previous = baseline.and_then(|b| b.students.iter().find(|s| s.id == student.id));
        if aliases.contains_key(&student.id)
            || previous.is_none_or(|before| before.photo_id != student.photo_id)
        {
            if let Some(photo) = &student.photo_id {
                let name = photo_names.get(photo).ok_or_else(invalid)?;
                // Android uses its fixed photos directory; a basename remains portable and is rebased on restore.
                let existing: Option<i64> = transaction
                    .query_row(
                        "SELECT id FROM student_photo WHERE studentId=?1 ORDER BY id LIMIT 1",
                        [value],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|_| invalid())?;
                if let Some(existing) = existing {
                    run(
                        &transaction,
                        "UPDATE student_photo SET originalFilePath=?1,thumbnailVersion=thumbnailVersion+1 WHERE id=?2",
                        params![name, existing],
                    )?;
                } else {
                    run(
                        &transaction,
                        "INSERT INTO student_photo(studentId,originalFilePath,thumbnailVersion,source) VALUES(?1,?2,1,'TeacherDeck')",
                        params![value, name],
                    )?;
                }
            } else {
                run(
                    &transaction,
                    "DELETE FROM student_photo WHERE studentId=?1",
                    [value],
                )?;
            }
        }
    }
    for enrollment in &document.enrollments {
        let student = id(&students, &enrollment.student_id)?;
        let semester = id(&semesters, &enrollment.semester_id)?;
        let previous = baseline.and_then(|b| b.enrollments.iter().find(|e| e.id == enrollment.id));
        let status_changed = previous.is_none_or(|b| b.status != enrollment.status);
        let code = format!(
            "{}{:02}{:02}",
            enrollment.grade, enrollment.class_number, enrollment.student_number
        );
        let value = if let Some(value) = original("enrollment", &enrollment.id) {
            run(
                &transaction,
                "UPDATE student_enrollment SET studentId=?1,semesterId=?2,grade=?3,classNumber=?4,studentNumber=?5 WHERE id=?6",
                params![
                    student,
                    semester,
                    enrollment.grade,
                    enrollment.class_number,
                    enrollment.student_number,
                    value
                ],
            )?;
            if previous.is_none_or(|before| {
                before.grade != enrollment.grade
                    || before.class_number != enrollment.class_number
                    || before.student_number != enrollment.student_number
            }) {
                run(
                    &transaction,
                    "UPDATE student_enrollment SET displayStudentCode=?1 WHERE id=?2",
                    params![code, value],
                )?;
            }
            if status_changed {
                run(
                    &transaction,
                    "UPDATE student_enrollment SET status=?1 WHERE id=?2",
                    params![status(enrollment.status), value],
                )?;
            }
            value
        } else {
            let start = document
                .semesters
                .iter()
                .find(|s| s.id == enrollment.semester_id)
                .ok_or_else(invalid)?
                .start_date
                .as_str();
            insert(
                &transaction,
                "INSERT INTO student_enrollment(studentId,semesterId,grade,classNumber,studentNumber,displayStudentCode,status,validFrom,muteAbsenceStreakAlert) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,0)",
                params![
                    student,
                    semester,
                    enrollment.grade,
                    enrollment.class_number,
                    enrollment.student_number,
                    code,
                    status(enrollment.status),
                    start
                ],
            )?
        };
        enrollments.insert(enrollment.id.clone(), value);
    }
    for context in &document.contexts {
        let semester = id(&semesters, &context.semester_id)?;
        if context.kind == SchoolContextKind::Homeroom {
            let members: Vec<_> = document
                .enrollments
                .iter()
                .filter(|e| context.enrollment_ids.contains(&e.id))
                .collect();
            let Some(first) = members.first() else {
                if original("homeroom", &context.id).is_some() {
                    continue;
                }
                return Err(invalid());
            };
            if members
                .iter()
                .any(|e| e.grade != first.grade || e.class_number != first.class_number)
            {
                return Err(invalid());
            }
            if let Some(value) = original("homeroom", &context.id) {
                run(
                    &transaction,
                    "UPDATE homeroom_class SET semesterId=?1,grade=?2,classNumber=?3 WHERE id=?4",
                    params![semester, first.grade, first.class_number, value],
                )?;
            } else {
                run(
                    &transaction,
                    "INSERT INTO homeroom_class(semesterId,grade,classNumber) VALUES(?1,?2,?3)",
                    params![semester, first.grade, first.class_number],
                )?;
            }
            continue;
        }
        let value = if let Some(value) = original("division", &context.id) {
            run(
                &transaction,
                "UPDATE division SET semesterId=?1,subjectName=?2,divisionName=?3,classroom=?4 WHERE id=?5",
                params![
                    semester,
                    context.subject.as_deref().unwrap_or(&context.label),
                    context.label,
                    context.room,
                    value
                ],
            )?;
            value
        } else {
            insert(
                &transaction,
                "INSERT INTO division(semesterId,subjectName,divisionName,classroom,attendanceEnabled,temporary,reminderEnabled,kind) VALUES(?1,?2,?3,?4,1,0,1,'REGULAR')",
                params![
                    semester,
                    context.subject.as_deref().unwrap_or(&context.label),
                    context.label,
                    context.room
                ],
            )?
        };
        contexts.insert(context.id.clone(), value);
        let desired = context
            .enrollment_ids
            .iter()
            .map(|e| id(&enrollments, e))
            .collect::<Result<Vec<_>, _>>()?;
        let mut statement = transaction
            .prepare("SELECT id,studentEnrollmentId FROM division_enrollment WHERE divisionId=?1")
            .map_err(|_| invalid())?;
        let existing = statement
            .query_map([value], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?;
        for (row, enrollment) in &existing {
            if !desired.contains(enrollment) {
                run(
                    &transaction,
                    "UPDATE division_enrollment SET validTo=(SELECT endDate FROM semester WHERE id=?1) WHERE id=?2",
                    params![semester, row],
                )?;
            }
        }
        let start = document
            .semesters
            .iter()
            .find(|s| s.id == context.semester_id)
            .ok_or_else(invalid)?
            .start_date
            .as_str();
        for enrollment in desired {
            if !existing.iter().any(|(_, e)| *e == enrollment) {
                run(
                    &transaction,
                    "INSERT INTO division_enrollment(divisionId,studentEnrollmentId,validFrom) VALUES(?1,?2,?3)",
                    params![value, enrollment, start],
                )?;
            }
        }
    }
    for template in &document.timetable.day_templates {
        let semester = id(&semesters, &template.semester_id)?;
        let value = if let Some(value) = original("template", &template.id) {
            run(
                &transaction,
                "UPDATE day_schedule_template SET semesterId=?1,name=?2 WHERE id=?3",
                params![semester, template.label, value],
            )?;
            value
        } else {
            insert(
                &transaction,
                "INSERT INTO day_schedule_template(semesterId,name,type) VALUES(?1,?2,'NORMAL')",
                params![semester, template.label],
            )?
        };
        templates.insert(template.id.clone(), value);
        let mut statement = transaction
            .prepare("SELECT id,periodNumber FROM period_slot WHERE templateId=?1 AND type='CLASS'")
            .map_err(|_| invalid())?;
        let existing = statement
            .query_map([value], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, u8>(1)?)))
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?;
        for (row, period) in &existing {
            if !template.slots.iter().any(|s| s.period == *period) {
                run(&transaction, "DELETE FROM period_slot WHERE id=?1", [row])?;
            }
        }
        for slot in &template.slots {
            if let Some((row, _)) = existing.iter().find(|(_, p)| *p == slot.period) {
                run(
                    &transaction,
                    "UPDATE period_slot SET startTime=?1,endTime=?2 WHERE id=?3",
                    params![hhmm(slot.start_minute), hhmm(slot.end_minute), row],
                )?;
            } else {
                run(
                    &transaction,
                    "INSERT INTO period_slot(templateId,periodNumber,label,startTime,endTime,type) VALUES(?1,?2,?3,?4,?5,'CLASS')",
                    params![
                        value,
                        slot.period,
                        format!("{}교시", slot.period),
                        hhmm(slot.start_minute),
                        hhmm(slot.end_minute)
                    ],
                )?;
            }
        }
    }
    for table in &document.timetable.weekly_tables {
        let semester = id(&semesters, &table.semester_id)?;
        let kind = if table.start_date.is_some() {
            "RANGED"
        } else {
            "BASE"
        };
        let value = if let Some(value) = original("weekly", &table.id) {
            run(
                &transaction,
                "UPDATE weekly_table SET semesterId=?1,kind=?2,validFrom=?3,validTo=?4 WHERE id=?5",
                params![semester, kind, table.start_date, table.end_date, value],
            )?;
            value
        } else {
            insert(
                &transaction,
                "INSERT INTO weekly_table(semesterId,kind,validFrom,validTo) VALUES(?1,?2,?3,?4)",
                params![semester, kind, table.start_date, table.end_date],
            )?
        };
        weeklies.insert(table.id.clone(), value);
        let mut statement = transaction
            .prepare("SELECT id,weekday,period,divisionId FROM weekly_entry WHERE tableId=?1")
            .map_err(|_| invalid())?;
        let existing = statement
            .query_map([value], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, u8>(1)?,
                    r.get::<_, u8>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?;
        let mut used = std::collections::HashSet::new();
        for entry in &table.entries {
            let division = id(&contexts, &entry.context_id)?;
            let exact = existing.iter().find(|(row, w, p, _)| {
                !used.contains(row) && *w == entry.weekday && *p == entry.period
            });
            let movable: Vec<_> = existing
                .iter()
                .filter(|(row, w, p, d)| {
                    !used.contains(row)
                        && *d == division
                        && !table
                            .entries
                            .iter()
                            .any(|e| e.weekday == *w && e.period == *p)
                })
                .collect();
            let matched = exact.or_else(|| {
                if movable.len() == 1 {
                    movable.first().copied()
                } else {
                    None
                }
            });
            if let Some((row, _, _, _)) = matched {
                used.insert(*row);
                run(
                    &transaction,
                    "UPDATE weekly_entry SET weekday=?1,period=?2,divisionId=?3 WHERE id=?4",
                    params![entry.weekday, entry.period, division, row],
                )?;
            } else {
                run(
                    &transaction,
                    "INSERT INTO weekly_entry(tableId,weekday,period,divisionId) VALUES(?1,?2,?3,?4)",
                    params![value, entry.weekday, entry.period, division],
                )?;
            }
        }
        for (row, _, _, _) in &existing {
            if !used.contains(row) {
                run(&transaction, "DELETE FROM weekly_entry WHERE id=?1", [row])?;
            }
        }
    }
    // A day override has two independent original rows; keep each row's private memo.
    for day in &document.timetable.day_overrides {
        let semester = id(&semesters, &day.semester_id)?;
        let owner: i64 = transaction
            .query_row(
                "SELECT schoolId FROM semester WHERE id=?1",
                [semester],
                |r| r.get(0),
            )
            .map_err(|_| invalid())?;
        for (kind, weekday, template, from) in [
            ("WEEKDAY_SUBSTITUTION", day.substitute_weekday, None, None),
            (
                "TEMP_TIMETABLE",
                None,
                day.day_template_id
                    .as_ref()
                    .map(|key| id(&templates, key))
                    .transpose()?,
                day.from_period,
            ),
        ] {
            if weekday.is_none() && template.is_none() {
                // Cancellation applies to this known leaf only; unrelated override kinds remain intact.
                run(
                    &transaction,
                    "DELETE FROM day_override WHERE schoolId=?1 AND date=?2 AND kind=?3",
                    params![owner, day.date, kind],
                )?;
                continue;
            }
            run(
                &transaction,
                "INSERT INTO day_override(schoolId,date,kind,sourceWeekday,templateId,fromPeriod) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(schoolId,date,kind) DO UPDATE SET sourceWeekday=excluded.sourceWeekday,templateId=excluded.templateId,fromPeriod=excluded.fromPeriod",
                params![owner, day.date, kind, weekday, template, from],
            )?;
        }
    }
    for change in &document.timetable.date_changes {
        let semester = id(&semesters, &change.semester_id)?;
        let division = id(&contexts, &change.context_id)?;
        let action = match change.kind {
            SchoolDateChangeKind::Move => "MOVE",
            SchoolDateChangeKind::Cancel => "CANCEL",
            SchoolDateChangeKind::Add => "ADD",
        };
        let period = change
            .from_period
            .or(change.to_period)
            .ok_or_else(invalid)?;
        let group = change
            .change_group_id
            .as_ref()
            .map(|v| {
                original("group", v)
                    .or_else(|| {
                        // New opaque group ids are mapped deterministically within this export, below the i64 bound.
                        let digest = sha2_compat::Sha256::digest(v.as_bytes());
                        let array: [u8; 8] = digest.get(..8)?.try_into().ok()?;
                        Some((i64::from_le_bytes(array) & i64::MAX).max(1))
                    })
                    .ok_or_else(invalid)
            })
            .transpose()?;
        let target_date = if change.kind == SchoolDateChangeKind::Move {
            Some(change.target_date.as_deref().unwrap_or(&change.date))
        } else {
            None
        };
        let target_period = if change.kind == SchoolDateChangeKind::Move {
            change.to_period
        } else {
            None
        };
        if let Some(value) = original("change", &change.id) {
            run(
                &transaction,
                "UPDATE date_override SET semesterId=?1,action=?2,date=?3,period=?4,divisionId=?5,targetDate=?6,targetPeriod=?7,changeGroupId=?8 WHERE id=?9",
                params![
                    semester,
                    action,
                    change.date,
                    period,
                    division,
                    target_date,
                    target_period,
                    group,
                    value
                ],
            )?;
        } else {
            run(
                &transaction,
                "INSERT INTO date_override(semesterId,action,date,period,divisionId,targetDate,targetPeriod,changeGroupId) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    semester,
                    action,
                    change.date,
                    period,
                    division,
                    target_date,
                    target_period,
                    group
                ],
            )?;
        }
    }
    transaction.commit().map_err(|_| invalid())?;
    super::database::validate(db)?;
    Ok(())
}
use rusqlite::OptionalExtension;
use sha2_compat::Digest;

/// Rebase only photos actually included in the output; never resolve an original OS path.
pub fn rebase_photos(
    db: &mut Connection,
    photos: &std::collections::BTreeMap<String, Vec<u8>>,
) -> Result<(), DeckError> {
    let rows = projection::rows(
        db,
        "SELECT id,originalFilePath FROM student_photo ORDER BY id",
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    )?;
    let transaction = db.transaction().map_err(|_| invalid())?;
    for (id, path) in rows {
        let basename = path.rsplit(['/', '\\']).next().ok_or_else(invalid)?;
        if photos.contains_key(basename) && basename != path {
            // The row identity, thumbnail version and source remain untouched.
            run(
                &transaction,
                "UPDATE student_photo SET originalFilePath=?1 WHERE id=?2",
                params![basename, id],
            )?;
        }
    }
    transaction.commit().map_err(|_| invalid())
}
