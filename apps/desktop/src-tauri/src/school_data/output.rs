// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Validated trusted-shell outputs; append-new publication never touches source data.
use deck_core::caps::school_data::SchoolDataDocument;
use deck_core::{DeckError, ErrorCode};
use std::io::{Cursor, Write};
use std::path::Path;

const JSON_LIMIT: usize = 32 * 1024 * 1024;
const PNG_LIMIT: usize = 16 * 1024 * 1024;
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "출력 자료의 형식과 크기를 확인해 주세요.",
    )
}
/// Rejects growth before appending and caps geometric buffer reservations at the limit.
struct BoundedJson {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}
impl Write for BoundedJson {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            self.exceeded = true;
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "school JSON size limit exceeded",
            ));
        }
        let length = self.bytes.len() + bytes.len();
        if length > self.bytes.capacity() {
            let capacity = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(4096)
                .min(self.limit)
                .max(length);
            self.bytes
                .try_reserve_exact(capacity.saturating_sub(self.bytes.len()))
                .map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::OutOfMemory,
                        "school JSON buffer allocation failed",
                    )
                })?;
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
/// Serializes all validated school fields, including photo metadata but no photo files.
pub fn backup(document: &SchoolDataDocument) -> Result<Vec<u8>, DeckError> {
    document.validate()?;
    let mut output = BoundedJson {
        bytes: Vec::new(),
        limit: JSON_LIMIT,
        exceeded: false,
    };
    // Recovery JSON uses the same compact encoding and 32 MiB limit as persistence.
    serde_json::to_writer(&mut output, document).map_err(|_| {
        if output.exceeded {
            invalid()
        } else {
            super::internal()
        }
    })?;
    Ok(output.bytes)
}
/// Shared with the existing recovery picker to prove exported JSON is recoverable.
pub fn read_backup(bytes: &[u8]) -> Result<SchoolDataDocument, DeckError> {
    if bytes.len() > JSON_LIMIT {
        return Err(invalid());
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let document: SchoolDataDocument =
        serde_json::from_value(value.get("document").cloned().unwrap_or(value))
            .map_err(|_| invalid())?;
    document.validate()?;
    Ok(document)
}
fn digit(byte: u8) -> Result<u8, DeckError> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err(invalid()),
    }
}
/// Rejects oversized/noncanonical base64 before allocation, then fully decodes bounded PNG.
pub fn png(encoded: &str) -> Result<Vec<u8>, DeckError> {
    if encoded.is_empty()
        || encoded.len() > PNG_LIMIT.div_ceil(3) * 4
        || !encoded.len().is_multiple_of(4)
    {
        return Err(invalid());
    }
    let mut bytes = Vec::with_capacity((encoded.len() / 4 * 3).min(PNG_LIMIT));
    let count = encoded.len() / 4;
    for (index, &[first, second, third, fourth]) in
        encoded.as_bytes().as_chunks::<4>().0.iter().enumerate()
    {
        let a = digit(first)?;
        let b = digit(second)?;
        let last = index + 1 == count;
        bytes.push((a << 2) | (b >> 4));
        if third == b'=' {
            if !last || fourth != b'=' || b & 15 != 0 {
                return Err(invalid());
            }
        } else {
            let c = digit(third)?;
            bytes.push((b << 4) | (c >> 2));
            if fourth == b'=' {
                if !last || c & 3 != 0 {
                    return Err(invalid());
                }
            } else {
                bytes.push((c << 6) | digit(fourth)?);
            }
        }
    }
    if bytes.len() > PNG_LIMIT
        || (!bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            || !bytes.ends_with(b"\x00\x00\x00\x00IEND\xae\x42\x60\x82"))
    {
        return Err(invalid());
    }
    let dimensions = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png)
        .into_dimensions()
        .map_err(|_| invalid())?;
    let (width, height) = dimensions;
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 16_000_000
    {
        return Err(invalid());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(|_| invalid())?;
    Ok(bytes)
}
/// Fixed caller-owned basename, host temporary writes, and atomic append-new publication.
pub fn publish(
    path: &Path,
    name: &str,
    bytes: &[u8],
    temp: &crate::platform::TempArea,
) -> Result<(), DeckError> {
    let batch = crate::file_output::OutputBatch::append_destination(path)?;
    let mut file = batch.begin(name, bytes.len() as u64, temp)?;
    let mut offset = 0;
    for chunk in bytes.chunks(crate::file_output::WRITE_CHUNK_BYTES) {
        offset = file.append(offset, chunk)?;
    }
    file.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;
    fn encode(bytes: &[u8]) -> String {
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut result = String::new();
        for chunk in bytes.chunks(3) {
            let a = chunk[0];
            let b = *chunk.get(1).unwrap_or(&0);
            let c = *chunk.get(2).unwrap_or(&0);
            for index in [
                a >> 2,
                ((a & 3) << 4) | (b >> 4),
                ((b & 15) << 2) | (c >> 6),
                c & 63,
            ] {
                result.push(alphabet[index as usize] as char);
            }
            if chunk.len() < 3 {
                result.pop();
                result.push('=');
            }
            if chunk.len() < 2 {
                let length = result.len();
                result.replace_range(length - 2..length - 1, "=");
            }
        }
        result
    }
    fn image(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![];
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(
                &vec![0; width as usize * height as usize * 4],
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .unwrap();
        bytes
    }
    #[test]
    fn json_roundtrip_preserves_the_validated_document_and_rejects_invalid_source() {
        let mut document = SchoolDataDocument {
            revision: 17,
            ..SchoolDataDocument::default()
        };
        let mut value = serde_json::to_value(&document).unwrap();
        value["semesters"] = serde_json::json!([{ "id":"sem", "academicYear":2026,"term":1,"startDate":"2026-03-01","endDate":"2026-07-31","archived":false,"readOnly":false }]);
        value["photos"] = serde_json::json!([{ "id":"0123456789abcdef0123456789abcdef", "size":8, "mimeType":"image/png" }]);
        value["students"] = serde_json::json!([{ "id":"student", "name":"합성가", "photoId":"0123456789abcdef0123456789abcdef" }]);
        value["enrollments"] = serde_json::json!([{ "id":"enrollment","semesterId":"sem","studentId":"student","grade":1,"classNumber":1,"studentNumber":1,"status":"active" }]);
        value["contexts"] = serde_json::json!([{ "id":"context","semesterId":"sem","kind":"homeroom","label":"합성반","subject":null,"room":null,"enrollmentIds":["enrollment"] }]);
        value["timetable"]["dayTemplates"] = serde_json::json!([{ "id":"day","semesterId":"sem","label":"합성일과","slots":[{"period":1,"startMinute":540,"endMinute":580}] }]);
        value["timetable"]["weeklyTables"] = serde_json::json!([{ "id":"week","semesterId":"sem","label":"합성표","startDate":null,"endDate":null,"entries":[{"weekday":1,"period":1,"contextId":"context"}] }]);
        value["timetable"]["dateChanges"] = serde_json::json!([{ "id":"change","semesterId":"sem","date":"2026-04-01","kind":"CANCEL","contextId":"context","fromPeriod":1,"toPeriod":null,"changeGroupId":null }]);
        value["timetable"]["dayOverrides"] = serde_json::json!([{ "id":"override","semesterId":"sem","date":"2026-04-02","substituteWeekday":1,"dayTemplateId":"day","weeklyTableId":"week" }]);
        document = serde_json::from_value(value).unwrap();
        let bytes = backup(&document).unwrap();
        assert_eq!(read_backup(&bytes).unwrap(), document);
        document.version = 2;
        assert!(backup(&document).is_err());
        assert!(read_backup(b"{invalid}").is_err());
    }
    #[test]
    fn saved_large_document_roundtrips_when_pretty_json_exceeds_the_backup_limit() {
        use deck_core::caps::school_data::{
            SchoolContext, SchoolContextKind, SchoolEnrollment, SchoolEnrollmentStatus,
            SchoolSemester, SchoolStudent,
        };
        struct Count(usize);
        impl Write for Count {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0 += bytes.len();
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut document = SchoolDataDocument::default();
        document.semesters.push(SchoolSemester {
            id: "synthetic-semester".into(),
            academic_year: 2026,
            term: 1,
            start_date: "2026-03-01".into(),
            end_date: "2026-07-31".into(),
            archived: false,
            read_only: false,
        });
        for index in 0..1000u16 {
            let student_id = format!("synthetic-student-{index:04}");
            document.students.push(SchoolStudent {
                id: student_id.clone(),
                name: "합성학생".into(),
                photo_id: None,
            });
            document.enrollments.push(SchoolEnrollment {
                id: format!("synthetic-enrollment-{index:04}"),
                student_id,
                semester_id: "synthetic-semester".into(),
                grade: 1,
                class_number: index / 999 + 1,
                student_number: index % 999 + 1,
                status: SchoolEnrollmentStatus::Active,
            });
        }
        let membership: Vec<_> = document.enrollments.iter().map(|e| e.id.clone()).collect();
        assert_eq!(membership[0].len(), 25);
        for index in 0..1000 {
            document.contexts.push(SchoolContext {
                id: format!("synthetic-context-{index:04}"),
                semester_id: "synthetic-semester".into(),
                kind: SchoolContextKind::Homeroom,
                label: "합성반".into(),
                subject: None,
                room: None,
                enrollment_ids: membership.clone(),
                weekly_table_id: None,
            });
        }
        document.validate().unwrap();
        let disk = super::super::Disk {
            version: 1,
            document,
            grants: vec![],
        };
        let mut saved_size = Count(0);
        serde_json::to_writer(&mut saved_size, &disk).unwrap();
        assert!(saved_size.0 <= JSON_LIMIT);
        let mut previous_size = Count(0);
        serde_json::to_writer_pretty(&mut previous_size, &disk.document).unwrap();
        assert!(previous_size.0 > JSON_LIMIT);
        let bytes = backup(&disk.document).unwrap();
        assert!(bytes.len() <= JSON_LIMIT);
        assert_eq!(read_backup(&bytes).unwrap(), disk.document);
    }
    #[test]
    fn bounded_json_writer_accepts_the_limit_and_rejects_growth_before_append() {
        let mut output = BoundedJson {
            bytes: vec![],
            limit: 8,
            exceeded: false,
        };
        output.write_all(b"12345678").unwrap();
        assert_eq!(output.bytes, b"12345678");
        assert!(output.bytes.capacity() <= 8);
        assert!(output.write_all(b"9").is_err());
        assert!(output.exceeded);
        assert_eq!(output.bytes, b"12345678");
        assert!(output.bytes.capacity() <= 8);
        // No partial output or large reservation when serialization first exceeds the cap.
        let mut output = BoundedJson {
            bytes: vec![],
            limit: 8,
            exceeded: false,
        };
        assert!(serde_json::to_writer(&mut output, &"123456789").is_err());
        assert!(output.exceeded);
        assert!(output.bytes.len() <= 8);
        assert!(output.bytes.capacity() <= 8);
    }
    #[test]
    fn png_checks_base64_format_decode_dimensions_and_pixel_budget() {
        let bytes = image(3, 2);
        assert_eq!(png(&encode(&bytes)).unwrap(), bytes);
        for encoded in [
            "",
            "a===",
            "AB==",
            "AAAA=AAA",
            "SGVsbG8=",
            "data:image/png;base64,AAAA",
        ] {
            assert!(png(encoded).is_err());
        }
        assert!(png(&encode(&bytes[..bytes.len() - 12])).is_err());
        assert!(png(&"A".repeat(PNG_LIMIT.div_ceil(3) * 4 + 4)).is_err());
        assert!(png(&encode(&image(4097, 1))).is_err());
        assert!(png(&encode(&image(4096, 4096))).is_err());
    }
    #[test]
    fn publication_adds_new_name_and_failed_destination_keeps_original() {
        let root = std::env::temp_dir().join(format!("deck-school-output-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let folder = root.join("destination");
        std::fs::create_dir_all(&folder).unwrap();
        let temp = crate::platform::TempArea::init_preserving(root.join("temporary")).unwrap();
        let name = "synthetic-school.json";
        std::fs::write(folder.join(name), b"original").unwrap();
        publish(&folder, name, b"new", &temp).unwrap();
        assert_eq!(std::fs::read(folder.join(name)).unwrap(), b"original");
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 2);
        assert!(publish(&folder.join("missing"), name, b"failed", &temp).is_err());
        assert_eq!(std::fs::read(folder.join(name)).unwrap(), b"original");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
