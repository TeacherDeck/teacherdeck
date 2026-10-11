// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Narrow DB7 projection. Private tables, unrepresented fields and row identity stay in SQLite.
use super::{invalid, schema};
use deck_core::DeckError;
use deck_core::caps::school_data::*;
use deck_core::caps::timealert::TimeAlertTableSummary;
use rusqlite::{Connection, Row};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

pub struct Projection {
    pub document: SchoolDataDocument,
    pub tables: Vec<TimeAlertTableSummary>,
    pub warnings: Vec<String>,
    pub photos: BTreeMap<String, Vec<u8>>,
    pub photo_names: HashMap<String, String>,
    pub namespace: String,
}
pub fn rows<T>(
    db: &Connection,
    sql: &str,
    f: impl FnMut(&Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, DeckError> {
    let rows = db
        .prepare(sql)
        .map_err(|_| invalid())?
        .query_map([], f)
        .map_err(|_| invalid())?
        .take(20_001)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| invalid())?;
    if rows.len() > 20_000 {
        return Err(invalid());
    }
    Ok(rows)
}
pub fn key(namespace: &str, table: &str, id: i64) -> Result<String, DeckError> {
    if id <= 0 {
        return Err(invalid());
    }
    Ok(format!("ta:{namespace}:{table}:{id}"))
}
pub fn number(namespace: &str, table: &str, id: &str) -> Option<i64> {
    id.strip_prefix(&format!("ta:{namespace}:{table}:"))?
        .parse()
        .ok()
        .filter(|n| *n > 0)
}
pub fn photo_mime(bytes: &[u8]) -> Result<&'static str, DeckError> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok("image/webp")
    } else {
        Err(invalid())
    }
}
fn minute(value: &str) -> Result<u16, DeckError> {
    let parts: Vec<_> = value.split(':').collect();
    let [hour, minute, rest @ ..] = parts.as_slice() else {
        return Err(invalid());
    };
    let hour: u16 = hour.parse().map_err(|_| invalid())?;
    let minute: u16 = minute.parse().map_err(|_| invalid())?;
    if hour > 23 || minute > 59 || !rest.is_empty() && rest != ["00"] {
        return Err(invalid());
    }
    Ok(hour * 60 + minute)
}
pub fn read(
    db: &Connection,
    namespace: String,
    photo_files: &BTreeMap<String, String>,
    root: &Path,
) -> Result<Projection, DeckError> {
    let mut document = SchoolDataDocument::default();
    let mut warnings = vec!["연락처·생일·메모·출결·상담·알림과 기타 원작 표는 백업에 보존하며 공통 화면에서는 편집하지 않아요.".into()];
    let mut photos = BTreeMap::new();
    let mut photo_names = HashMap::new();
    let mut tables = vec![];
    for (table, _) in schema::TABLES {
        let count: u32 = db
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .map_err(|_| invalid())?;
        tables.push(TimeAlertTableSummary {
            table_key: (*table).into(),
            row_count: count,
        });
    }
    let semesters = rows(
        db,
        "SELECT s.id,y.year,s.type,s.startDate,s.endDate,s.archived,s.readOnly,s.schoolId FROM semester s JOIN academic_year y ON y.id=s.academicYearId ORDER BY s.id",
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, u16>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, i64>(7)?,
            ))
        },
    )?;
    let mut semester_schools = HashMap::new();
    for (id, year, kind, start, end, archived, read_only, school) in semesters {
        let id = key(&namespace, "semester", id)?;
        semester_schools.insert(id.clone(), school);
        document.semesters.push(SchoolSemester {
            id,
            academic_year: year,
            term: match kind.as_str() {
                "FIRST" => 1,
                "SECOND" => 2,
                _ => return Err(invalid()),
            },
            start_date: start,
            end_date: end,
            archived,
            read_only,
        });
    }
    for (id, name) in rows(db, "SELECT id,name FROM student ORDER BY id", |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
    })? {
        document.students.push(SchoolStudent {
            id: key(&namespace, "student", id)?,
            name,
            photo_id: None,
        });
    }
    for (id, student, semester, grade, class, number, status) in rows(
        db,
        "SELECT id,studentId,semesterId,grade,classNumber,studentNumber,status FROM student_enrollment ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, u8>(3)?,
                r.get::<_, u16>(4)?,
                r.get::<_, u16>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    )? {
        document.enrollments.push(SchoolEnrollment {
            id: key(&namespace, "enrollment", id)?,
            student_id: key(&namespace, "student", student)?,
            semester_id: key(&namespace, "semester", semester)?,
            grade,
            class_number: class,
            student_number: number,
            status: match status.as_str() {
                "ACTIVE" | "TRANSFERRED_IN" => SchoolEnrollmentStatus::Active,
                "TRANSFERRED_OUT" => SchoolEnrollmentStatus::Transferred,
                "HIDDEN" => SchoolEnrollmentStatus::Hidden,
                _ => return Err(invalid()),
            },
        });
    }
    for (id, semester, subject, name, room) in rows(
        db,
        "SELECT id,semesterId,subjectName,divisionName,classroom FROM division ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )? {
        document.contexts.push(SchoolContext {
            id: key(&namespace, "division", id)?,
            semester_id: key(&namespace, "semester", semester)?,
            kind: SchoolContextKind::Division,
            label: name,
            subject: if subject.is_empty() {
                None
            } else {
                Some(subject)
            },
            room: room.filter(|v| !v.is_empty()),
            enrollment_ids: vec![],
            weekly_table_id: None,
        });
    }
    for (division, enrollment) in rows(
        db,
        "SELECT divisionId,studentEnrollmentId FROM division_enrollment ORDER BY id",
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
    )? {
        let division = key(&namespace, "division", division)?;
        let enrollment = key(&namespace, "enrollment", enrollment)?;
        let context = document
            .contexts
            .iter_mut()
            .find(|c| c.id == division)
            .ok_or_else(invalid)?;
        if !context.enrollment_ids.contains(&enrollment) {
            context.enrollment_ids.push(enrollment);
        }
    }
    for (id, semester, grade, class) in rows(
        db,
        "SELECT id,semesterId,grade,classNumber FROM homeroom_class ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, u8>(2)?,
                r.get::<_, u16>(3)?,
            ))
        },
    )? {
        let semester = key(&namespace, "semester", semester)?;
        document.contexts.push(SchoolContext {
            id: key(&namespace, "homeroom", id)?,
            semester_id: semester.clone(),
            kind: SchoolContextKind::Homeroom,
            label: format!("{grade}학년 {class}반"),
            subject: None,
            room: None,
            enrollment_ids: document
                .enrollments
                .iter()
                .filter(|e| {
                    e.semester_id == semester && e.grade == grade && e.class_number == class
                })
                .map(|e| e.id.clone())
                .collect(),
            weekly_table_id: None,
        });
    }
    for (student, path) in rows(
        db,
        "SELECT studentId,originalFilePath FROM student_photo ORDER BY id",
        |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
    )? {
        let student = key(&namespace, "student", student)?;
        let basename = path.rsplit(['/', '\\']).next().ok_or_else(invalid)?;
        let Some(file) = photo_files.get(basename) else {
            warnings.push("원작이 참조한 사진 중 백업에 없는 사진은 연결하지 않았어요.".into());
            continue;
        };
        let bytes = std::fs::read(root.join(file)).map_err(|_| invalid())?;
        let mime = photo_mime(&bytes)?;
        let id = crate::school_data::token();
        document
            .students
            .iter_mut()
            .find(|s| s.id == student)
            .ok_or_else(invalid)?
            .photo_id = Some(id.clone());
        document.photos.push(SchoolPhotoInfo {
            id: id.clone(),
            size: bytes.len() as u32,
            mime_type: mime.into(),
        });
        photo_names.insert(id.clone(), basename.to_string());
        photos.insert(id, bytes);
    }
    for (id, semester, name) in rows(
        db,
        "SELECT id,semesterId,name FROM day_schedule_template ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        },
    )? {
        let mut statement = db.prepare("SELECT periodNumber,startTime,endTime FROM period_slot WHERE templateId=?1 AND type='CLASS' ORDER BY id").map_err(|_| invalid())?;
        let entries = statement
            .query_map([id], |r| {
                Ok((
                    r.get::<_, u8>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?;
        if entries.is_empty() {
            warnings.push(
                "수업 교시가 없는 일과표와 쉬는 시간·점심 슬롯은 원작 백업에만 보존해요.".into(),
            );
            continue;
        }
        let slots = entries
            .into_iter()
            .map(|(period, start, end)| {
                Ok(SchoolDaySlot {
                    period,
                    start_minute: minute(&start)?,
                    end_minute: minute(&end)?,
                })
            })
            .collect::<Result<Vec<_>, DeckError>>()?;
        document.timetable.day_templates.push(SchoolDayTemplate {
            id: key(&namespace, "template", id)?,
            semester_id: key(&namespace, "semester", semester)?,
            label: name,
            slots,
        });
    }
    for (id, semester, kind, start, end) in rows(
        db,
        "SELECT id,semesterId,kind,validFrom,validTo FROM weekly_table ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        },
    )? {
        if !["BASE", "RANGED"].contains(&kind.as_str()) {
            return Err(invalid());
        }
        let mut statement = db
            .prepare(
                "SELECT weekday,period,divisionId FROM weekly_entry WHERE tableId=?1 ORDER BY id",
            )
            .map_err(|_| invalid())?;
        let entries = statement
            .query_map([id], |r| {
                Ok((r.get::<_, u8>(0)?, r.get::<_, u8>(1)?, r.get::<_, i64>(2)?))
            })
            .map_err(|_| invalid())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| invalid())?
            .into_iter()
            .map(|(weekday, period, division)| {
                Ok(SchoolWeeklySlot {
                    weekday,
                    period,
                    context_id: key(&namespace, "division", division)?,
                })
            })
            .collect::<Result<Vec<_>, DeckError>>()?;
        document.timetable.weekly_tables.push(SchoolWeeklyTable {
            id: key(&namespace, "weekly", id)?,
            semester_id: key(&namespace, "semester", semester)?,
            label: if kind == "BASE" {
                "기본 시간표".into()
            } else {
                format!("기간 시간표 {id}")
            },
            start_date: start,
            end_date: end,
            entries,
        });
    }
    for (id, school, date, kind, weekday, template, from) in rows(
        db,
        "SELECT id,schoolId,date,kind,sourceWeekday,templateId,fromPeriod FROM day_override ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<u8>>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<u8>>(6)?,
            ))
        },
    )? {
        if !["WEEKDAY_SUBSTITUTION", "TEMP_TIMETABLE"].contains(&kind.as_str()) {
            return Err(invalid());
        }
        let template = template
            .map(|id| key(&namespace, "template", id))
            .transpose()?;
        if template
            .as_ref()
            .is_some_and(|id| !document.timetable.day_templates.iter().any(|d| d.id == *id))
        {
            warnings.push("수업 교시가 없는 임시 일과 지정은 원작 백업에만 보존해요.".into());
            continue;
        }
        for semester in document.semesters.iter().filter(|s| {
            semester_schools.get(&s.id) == Some(&school)
                && s.start_date <= date
                && s.end_date >= date
        }) {
            let existing = document
                .timetable
                .day_overrides
                .iter_mut()
                .find(|d| d.semester_id == semester.id && d.date == date);
            if let Some(existing) = existing {
                if kind == "WEEKDAY_SUBSTITUTION" {
                    existing.substitute_weekday = weekday;
                } else {
                    existing.day_template_id = template.clone();
                    existing.from_period = from;
                }
            } else {
                document.timetable.day_overrides.push(SchoolDayOverride {
                    id: key(&namespace, "override", id)?,
                    semester_id: semester.id.clone(),
                    date: date.clone(),
                    substitute_weekday: weekday,
                    day_template_id: template.clone(),
                    weekly_table_id: None,
                    from_period: from,
                });
            }
        }
    }
    for (id, semester, action, date, period, division, target_date, target_period, group) in rows(
        db,
        "SELECT id,semesterId,action,date,period,divisionId,targetDate,targetPeriod,changeGroupId FROM date_override ORDER BY id",
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, u8>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, Option<String>>(6)?,
                r.get::<_, Option<u8>>(7)?,
                r.get::<_, Option<i64>>(8)?,
            ))
        },
    )? {
        let kind = match action.as_str() {
            "MOVE" => SchoolDateChangeKind::Move,
            "CANCEL" => SchoolDateChangeKind::Cancel,
            "ADD" => SchoolDateChangeKind::Add,
            _ => return Err(invalid()),
        };
        document.timetable.date_changes.push(SchoolDateChange {
            id: key(&namespace, "change", id)?,
            semester_id: key(&namespace, "semester", semester)?,
            date,
            kind,
            context_id: key(&namespace, "division", division)?,
            from_period: if kind == SchoolDateChangeKind::Add {
                None
            } else {
                Some(period)
            },
            to_period: if kind == SchoolDateChangeKind::Cancel {
                None
            } else if kind == SchoolDateChangeKind::Add {
                Some(period)
            } else {
                target_period
            },
            change_group_id: group.map(|id| key(&namespace, "group", id)).transpose()?,
            target_date,
        });
    }
    document.validate()?;
    warnings.sort();
    warnings.dedup();
    Ok(Projection {
        document,
        tables,
        warnings,
        photos,
        photo_names,
        namespace,
    })
}
