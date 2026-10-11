// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! TimeAlert official Room schema 7 (AppDatabase/7.json), preserved without changing its SQL.
pub const ROOM_HASH: &str = "
83735f2c3432cbf663e03b2330a8e013
";
pub const TABLES: &[(&str, &str)] = &[
    (
        "school",
        r#"CREATE TABLE IF NOT EXISTS `school` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `educationOfficeCode` TEXT, `schoolCode` TEXT, `isDefault` INTEGER NOT NULL, `displayOrder` INTEGER NOT NULL, `active` INTEGER NOT NULL)"#,
    ),
    (
        "academic_year",
        r#"CREATE TABLE IF NOT EXISTS `academic_year` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `year` INTEGER NOT NULL)"#,
    ),
    (
        "semester",
        r#"CREATE TABLE IF NOT EXISTS `semester` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `academicYearId` INTEGER NOT NULL, `schoolId` INTEGER NOT NULL, `type` TEXT NOT NULL, `startDate` TEXT NOT NULL, `endDate` TEXT NOT NULL, `archived` INTEGER NOT NULL, `readOnly` INTEGER NOT NULL, FOREIGN KEY(`academicYearId`) REFERENCES `academic_year`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT , FOREIGN KEY(`schoolId`) REFERENCES `school`(`id`) ON UPDATE NO ACTION ON DELETE RESTRICT )"#,
    ),
    (
        "day_schedule_template",
        r#"CREATE TABLE IF NOT EXISTS `day_schedule_template` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `name` TEXT NOT NULL, `type` TEXT NOT NULL, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "period_slot",
        r#"CREATE TABLE IF NOT EXISTS `period_slot` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `templateId` INTEGER NOT NULL, `periodNumber` INTEGER, `label` TEXT NOT NULL, `startTime` TEXT NOT NULL, `endTime` TEXT NOT NULL, `type` TEXT NOT NULL, FOREIGN KEY(`templateId`) REFERENCES `day_schedule_template`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "division",
        r#"CREATE TABLE IF NOT EXISTS `division` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `subjectName` TEXT NOT NULL, `divisionName` TEXT NOT NULL, `classroom` TEXT, `colorToken` TEXT, `attendanceEnabled` INTEGER NOT NULL, `temporary` INTEGER NOT NULL DEFAULT 0, `reminderEnabled` INTEGER NOT NULL, `kind` TEXT NOT NULL DEFAULT 'REGULAR', `gradeLevel` INTEGER, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "weekly_table",
        r#"CREATE TABLE IF NOT EXISTS `weekly_table` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `kind` TEXT NOT NULL, `validFrom` TEXT, `validTo` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "weekly_entry",
        r#"CREATE TABLE IF NOT EXISTS `weekly_entry` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `tableId` INTEGER NOT NULL, `weekday` INTEGER NOT NULL, `period` INTEGER NOT NULL, `divisionId` INTEGER NOT NULL, `classroom` TEXT, FOREIGN KEY(`tableId`) REFERENCES `weekly_table`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`divisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "day_override",
        r#"CREATE TABLE IF NOT EXISTS `day_override` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `schoolId` INTEGER NOT NULL, `date` TEXT NOT NULL, `kind` TEXT NOT NULL, `sourceWeekday` INTEGER, `templateId` INTEGER, `fromPeriod` INTEGER, `memo` TEXT, FOREIGN KEY(`schoolId`) REFERENCES `school`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`templateId`) REFERENCES `day_schedule_template`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "date_override",
        r#"CREATE TABLE IF NOT EXISTS `date_override` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `action` TEXT NOT NULL, `date` TEXT NOT NULL, `period` INTEGER NOT NULL, `divisionId` INTEGER NOT NULL, `targetDate` TEXT, `targetPeriod` INTEGER, `changeGroupId` INTEGER, `memo` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`divisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "calendar_memo",
        r#"CREATE TABLE IF NOT EXISTS `calendar_memo` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `date` TEXT NOT NULL, `text` TEXT NOT NULL)"#,
    ),
    (
        "exam_period",
        r#"CREATE TABLE IF NOT EXISTS `exam_period` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `name` TEXT NOT NULL, `startDate` TEXT NOT NULL, `endDate` TEXT NOT NULL, `suppressClassReminders` INTEGER NOT NULL, `suppressAttendanceReminders` INTEGER NOT NULL, `templateId` INTEGER, `kind` TEXT NOT NULL DEFAULT 'OTHER', `suppressRegularClasses` INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "schedule_event",
        r#"CREATE TABLE IF NOT EXISTS `schedule_event` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `title` TEXT NOT NULL, `kind` TEXT NOT NULL, `startDate` TEXT NOT NULL, `endDate` TEXT NOT NULL, `allDay` INTEGER NOT NULL, `startPeriod` INTEGER, `endPeriod` INTEGER, `startTime` TEXT, `endTime` TEXT, `targetKind` TEXT NOT NULL, `targetGrade` INTEGER, `targetDivisionId` INTEGER, `suppressRegularClasses` INTEGER NOT NULL DEFAULT 1, `memo` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`targetDivisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL )"#,
    ),
    (
        "proctor_duty",
        r#"CREATE TABLE IF NOT EXISTS `proctor_duty` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `scheduleEventId` INTEGER, `title` TEXT NOT NULL, `sessionLabel` TEXT NOT NULL, `date` TEXT NOT NULL, `startTime` TEXT NOT NULL, `endTime` TEXT NOT NULL, `room` TEXT, `role` TEXT, `reminderMinutes` INTEGER NOT NULL DEFAULT 10, `memo` TEXT, `importBatchId` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`scheduleEventId`) REFERENCES `schedule_event`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL )"#,
    ),
    (
        "flexible_occurrence",
        r#"CREATE TABLE IF NOT EXISTS `flexible_occurrence` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `divisionId` INTEGER NOT NULL, `date` TEXT NOT NULL, `label` TEXT NOT NULL, `timeMode` TEXT NOT NULL, `startTime` TEXT, `endTime` TEXT, `anchorPeriod` INTEGER, `offsetMinutes` INTEGER NOT NULL DEFAULT 0, `durationMinutes` INTEGER, `reminderMinutes` INTEGER NOT NULL DEFAULT 5, `status` TEXT NOT NULL, `seriesKey` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`divisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "creative_activity",
        r#"CREATE TABLE IF NOT EXISTS `creative_activity` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `date` TEXT NOT NULL, `period` INTEGER NOT NULL, `kind` TEXT NOT NULL, `clubDivisionId` INTEGER, `memo` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`clubDivisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL )"#,
    ),
    (
        "student",
        r#"CREATE TABLE IF NOT EXISTS `student` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `name` TEXT NOT NULL, `birthday` TEXT, `createdAt` INTEGER NOT NULL, `archived` INTEGER NOT NULL)"#,
    ),
    (
        "student_enrollment",
        r#"CREATE TABLE IF NOT EXISTS `student_enrollment` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `studentId` INTEGER NOT NULL, `semesterId` INTEGER NOT NULL, `grade` INTEGER NOT NULL, `classNumber` INTEGER NOT NULL, `studentNumber` INTEGER NOT NULL, `displayStudentCode` TEXT NOT NULL, `status` TEXT NOT NULL, `validFrom` TEXT NOT NULL, `validTo` TEXT, `muteAbsenceStreakAlert` INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(`studentId`) REFERENCES `student`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "division_enrollment",
        r#"CREATE TABLE IF NOT EXISTS `division_enrollment` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `divisionId` INTEGER NOT NULL, `studentEnrollmentId` INTEGER NOT NULL, `validFrom` TEXT NOT NULL, `validTo` TEXT, FOREIGN KEY(`divisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`studentEnrollmentId`) REFERENCES `student_enrollment`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "student_photo",
        r#"CREATE TABLE IF NOT EXISTS `student_photo` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `studentId` INTEGER NOT NULL, `originalFilePath` TEXT NOT NULL, `thumbnailVersion` INTEGER NOT NULL, `source` TEXT, FOREIGN KEY(`studentId`) REFERENCES `student`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "contact",
        r#"CREATE TABLE IF NOT EXISTS `contact` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `studentId` INTEGER NOT NULL, `type` TEXT NOT NULL, `relationLabel` TEXT, `name` TEXT, `phoneNumber` TEXT NOT NULL, `isPrimary` INTEGER NOT NULL, FOREIGN KEY(`studentId`) REFERENCES `student`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "session",
        r#"CREATE TABLE IF NOT EXISTS `session` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `divisionId` INTEGER NOT NULL, `date` TEXT NOT NULL, `period` INTEGER NOT NULL, `startDateTime` TEXT, `endDateTime` TEXT, `status` TEXT NOT NULL, `frozen` INTEGER NOT NULL, `kind` TEXT NOT NULL DEFAULT 'REGULAR', `sourceOccurrenceId` INTEGER, `displayLabel` TEXT, FOREIGN KEY(`divisionId`) REFERENCES `division`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "attendance_completion",
        r#"CREATE TABLE IF NOT EXISTS `attendance_completion` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `sessionId` INTEGER NOT NULL, `completedAt` INTEGER NOT NULL, `modifiedAt` INTEGER NOT NULL, FOREIGN KEY(`sessionId`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "attendance_exception",
        r#"CREATE TABLE IF NOT EXISTS `attendance_exception` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `sessionId` INTEGER NOT NULL, `studentEnrollmentId` INTEGER NOT NULL, `status` TEXT NOT NULL, `reason` TEXT NOT NULL, `memo` TEXT, `modifiedAt` INTEGER NOT NULL, FOREIGN KEY(`sessionId`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`studentEnrollmentId`) REFERENCES `student_enrollment`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "homeroom_class",
        r#"CREATE TABLE IF NOT EXISTS `homeroom_class` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `semesterId` INTEGER NOT NULL, `grade` INTEGER NOT NULL, `classNumber` INTEGER NOT NULL, `morningHomeroomTime` TEXT, `afternoonHomeroomTime` TEXT, FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "homeroom_attendance_day",
        r#"CREATE TABLE IF NOT EXISTS `homeroom_attendance_day` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `homeroomClassId` INTEGER NOT NULL, `date` TEXT NOT NULL, `completedAt` INTEGER, `modifiedAt` INTEGER, FOREIGN KEY(`homeroomClassId`) REFERENCES `homeroom_class`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "homeroom_attendance_exception",
        r#"CREATE TABLE IF NOT EXISTS `homeroom_attendance_exception` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `dayId` INTEGER NOT NULL, `studentEnrollmentId` INTEGER NOT NULL, `status` TEXT NOT NULL, `reason` TEXT NOT NULL, `memo` TEXT, `fromPeriod` INTEGER, `toPeriod` INTEGER, `modifiedAt` INTEGER NOT NULL, FOREIGN KEY(`dayId`) REFERENCES `homeroom_attendance_day`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`studentEnrollmentId`) REFERENCES `student_enrollment`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "lesson_record",
        r#"CREATE TABLE IF NOT EXISTS `lesson_record` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `sessionId` INTEGER NOT NULL, `progressAndNext` TEXT, `lessonMemo` TEXT, `updatedAt` INTEGER NOT NULL, FOREIGN KEY(`sessionId`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "student_memo",
        r#"CREATE TABLE IF NOT EXISTS `student_memo` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `studentId` INTEGER NOT NULL, `sessionId` INTEGER, `semesterId` INTEGER NOT NULL, `content` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `updatedAt` INTEGER NOT NULL, FOREIGN KEY(`studentId`) REFERENCES `student`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE , FOREIGN KEY(`sessionId`) REFERENCES `session`(`id`) ON UPDATE NO ACTION ON DELETE SET NULL , FOREIGN KEY(`semesterId`) REFERENCES `semester`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
    (
        "counseling_schedule",
        r#"CREATE TABLE IF NOT EXISTS `counseling_schedule` (`id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, `studentId` INTEGER NOT NULL, `dateTime` TEXT NOT NULL, `memo` TEXT, `completed` INTEGER NOT NULL, `reminderEnabled` INTEGER NOT NULL, FOREIGN KEY(`studentId`) REFERENCES `student`(`id`) ON UPDATE NO ACTION ON DELETE CASCADE )"#,
    ),
];
pub const INDEXES: &[&str] = &[
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_academic_year_year` ON `academic_year` (`year`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_semester_academicYearId` ON `semester` (`academicYearId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_semester_schoolId` ON `semester` (`schoolId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_day_schedule_template_semesterId` ON `day_schedule_template` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_period_slot_templateId` ON `period_slot` (`templateId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_division_semesterId` ON `division` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_weekly_table_semesterId` ON `weekly_table` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_weekly_entry_tableId` ON `weekly_entry` (`tableId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_weekly_entry_divisionId` ON `weekly_entry` (`divisionId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_day_override_schoolId_date_kind` ON `day_override` (`schoolId`, `date`, `kind`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_day_override_templateId` ON `day_override` (`templateId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_date_override_semesterId` ON `date_override` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_date_override_divisionId` ON `date_override` (`divisionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_date_override_date` ON `date_override` (`date`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_date_override_targetDate` ON `date_override` (`targetDate`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_date_override_changeGroupId` ON `date_override` (`changeGroupId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_calendar_memo_date` ON `calendar_memo` (`date`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_exam_period_semesterId` ON `exam_period` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_schedule_event_semesterId` ON `schedule_event` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_schedule_event_startDate` ON `schedule_event` (`startDate`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_schedule_event_endDate` ON `schedule_event` (`endDate`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_schedule_event_targetDivisionId` ON `schedule_event` (`targetDivisionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_proctor_duty_semesterId` ON `proctor_duty` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_proctor_duty_date` ON `proctor_duty` (`date`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_proctor_duty_scheduleEventId` ON `proctor_duty` (`scheduleEventId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_flexible_occurrence_semesterId` ON `flexible_occurrence` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_flexible_occurrence_divisionId` ON `flexible_occurrence` (`divisionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_flexible_occurrence_date` ON `flexible_occurrence` (`date`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_flexible_occurrence_seriesKey` ON `flexible_occurrence` (`seriesKey`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_creative_activity_semesterId_date_period` ON `creative_activity` (`semesterId`, `date`, `period`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_creative_activity_clubDivisionId` ON `creative_activity` (`clubDivisionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_enrollment_studentId` ON `student_enrollment` (`studentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_enrollment_semesterId` ON `student_enrollment` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_enrollment_semesterId_displayStudentCode` ON `student_enrollment` (`semesterId`, `displayStudentCode`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_division_enrollment_divisionId_studentEnrollmentId` ON `division_enrollment` (`divisionId`, `studentEnrollmentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_division_enrollment_studentEnrollmentId` ON `division_enrollment` (`studentEnrollmentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_photo_studentId` ON `student_photo` (`studentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_contact_studentId` ON `contact` (`studentId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_session_divisionId_date_period` ON `session` (`divisionId`, `date`, `period`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_session_date` ON `session` (`date`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_session_sourceOccurrenceId` ON `session` (`sourceOccurrenceId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_attendance_completion_sessionId` ON `attendance_completion` (`sessionId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_attendance_exception_sessionId_studentEnrollmentId` ON `attendance_exception` (`sessionId`, `studentEnrollmentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_attendance_exception_studentEnrollmentId` ON `attendance_exception` (`studentEnrollmentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_homeroom_class_semesterId` ON `homeroom_class` (`semesterId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_homeroom_attendance_day_homeroomClassId_date` ON `homeroom_attendance_day` (`homeroomClassId`, `date`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_homeroom_attendance_exception_dayId_studentEnrollmentId` ON `homeroom_attendance_exception` (`dayId`, `studentEnrollmentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_homeroom_attendance_exception_studentEnrollmentId` ON `homeroom_attendance_exception` (`studentEnrollmentId`)"#,
    r#"CREATE UNIQUE INDEX IF NOT EXISTS `index_lesson_record_sessionId` ON `lesson_record` (`sessionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_memo_studentId` ON `student_memo` (`studentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_memo_sessionId` ON `student_memo` (`sessionId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_student_memo_semesterId` ON `student_memo` (`semesterId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_counseling_schedule_studentId` ON `counseling_schedule` (`studentId`)"#,
    r#"CREATE INDEX IF NOT EXISTS `index_counseling_schedule_dateTime` ON `counseling_schedule` (`dateTime`)"#,
];
