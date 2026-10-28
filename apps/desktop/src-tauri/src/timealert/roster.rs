// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Native XLSX media retention; the trusted shell reviews the existing OOXML matching rules.
use super::*;
use std::io::{Cursor, Read};

pub(super) struct RosterSession {
    pub handle: String,
    semester: String,
    preview: TimeAlertRosterPhotosPreview,
    photos: HashMap<String, Vec<u8>>,
}
impl TimeAlertService {
    /// Reads only a selected, bounded workbook and retains binary media under opaque keys.
    pub fn open_roster(
        &self,
        bytes: Vec<u8>,
        args: &TimeAlertRosterPhotosArgs,
        school: &SchoolDataService,
    ) -> Result<TimeAlertRosterPhotosPreview, DeckError> {
        let mut session = self.roster.lock().map_err(|_| internal())?;
        if session.is_some()
            || args.session_handle.is_some()
            || !args.matches.is_empty()
            || args.document.is_some()
        {
            return Err(busy());
        }
        let document = school.load()?;
        if document.revision != args.expected_revision {
            return Err(busy());
        }
        if !document
            .semesters
            .iter()
            .any(|s| s.id == args.semester_id && !s.read_only && !s.archived)
        {
            return Err(crate::school_data::denied());
        }
        let workbook = crate::school_data::workbook::read(bytes.clone())?;
        if workbook.photo_count > 1000 {
            return Err(invalid());
        }
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
        let mut photos = HashMap::new();
        let mut photo_keys = vec![];
        for index in 0..zip.len() {
            let mut file = zip.by_index(index).map_err(|_| invalid())?;
            let name = file.name().map_err(|_| invalid())?.into_owned();
            if !name.starts_with("xl/media/") || file.is_dir() {
                continue;
            }
            if file.size() == 0 || file.size() > archive::PHOTO_LIMIT as u64 {
                return Err(invalid());
            }
            let mut bytes = Vec::new();
            file.by_ref()
                .take(archive::PHOTO_LIMIT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| invalid())?;
            if bytes.len() > archive::PHOTO_LIMIT {
                return Err(invalid());
            }
            projection::photo_mime(&bytes)?;
            let key = token();
            photo_keys.push(TimeAlertRosterPhotoKey {
                part_key: name,
                photo_key: key.clone(),
                thumbnail_base64: thumbnail(&bytes),
            });
            photos.insert(key, bytes);
        }
        let handle = token();
        let preview = TimeAlertRosterPhotosPreview {
            session_handle: handle.clone(),
            expected_revision: document.revision,
            workbook,
            photo_keys,
            document: None,
        };
        *session = Some(RosterSession {
            handle,
            semester: args.semester_id.clone(),
            preview: preview.clone(),
            photos,
        });
        Ok(preview)
    }
    /// Publishes the reviewed roster and selected photos in one revision-protected transaction.
    pub fn apply_roster(
        &self,
        args: TimeAlertRosterPhotosArgs,
        school: &SchoolDataService,
    ) -> Result<TimeAlertRosterPhotosPreview, DeckError> {
        let mut holder = self.roster.lock().map_err(|_| internal())?;
        let session = holder
            .as_ref()
            .filter(|s| {
                Some(&s.handle) == args.session_handle.as_ref() && s.semester == args.semester_id
            })
            .ok_or_else(crate::school_data::denied)?;
        if args.expected_revision != session.preview.expected_revision {
            return Err(busy());
        }
        let mut document = args.document.ok_or_else(invalid)?;
        document.validate()?;
        if !document
            .semesters
            .iter()
            .any(|s| s.id == args.semester_id && !s.read_only && !s.archived)
        {
            return Err(crate::school_data::denied());
        }
        let mut students = HashSet::new();
        let mut keys = HashSet::new();
        let mut rows = HashSet::new();
        let mut photos = BTreeMap::new();
        for link in &args.matches {
            if !students.insert(&link.student_id)
                || !keys.insert(&link.photo_key)
                || !rows.insert(&link.row_key)
                || !document
                    .enrollments
                    .iter()
                    .any(|e| e.student_id == link.student_id && e.semester_id == args.semester_id)
                || document.enrollments.iter().any(|e| {
                    e.student_id == link.student_id
                        && document
                            .semesters
                            .iter()
                            .any(|s| s.id == e.semester_id && (s.read_only || s.archived))
                })
            {
                return Err(invalid());
            }
            let bytes = session.photos.get(&link.photo_key).ok_or_else(invalid)?;
            let photo = token();
            document
                .students
                .iter_mut()
                .find(|s| s.id == link.student_id)
                .ok_or_else(invalid)?
                .photo_id = Some(photo.clone());
            document.photos.push(SchoolPhotoInfo {
                id: photo.clone(),
                size: bytes.len() as u32,
                mime_type: projection::photo_mime(bytes)?.into(),
            });
            photos.insert(photo, bytes.clone());
        }
        let saved = school.apply_native_import(
            SaveSchoolDataArgs {
                expected_revision: args.expected_revision,
                document,
            },
            &photos,
        )?;
        let mut result = session.preview.clone();
        result.document = Some(saved);
        holder.take();
        Ok(result)
    }
}
fn thumbnail(bytes: &[u8]) -> Option<String> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    if u64::from(decoded.width()) * u64::from(decoded.height()) > 16 * 1024 * 1024 {
        return None;
    }
    for size in [96, 48, 24] {
        let thumb = decoded.thumbnail(size, size);
        let mut output = Cursor::new(Vec::new());
        thumb.write_to(&mut output, image::ImageFormat::Png).ok()?;
        let png = output.into_inner();
        if png.len() <= 8192 {
            return Some(base64(&png));
        }
    }
    None
}
fn base64(bytes: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let a = chunk.first().copied().unwrap_or_default();
        let b = chunk.get(1).copied().unwrap_or_default();
        let c = chunk.get(2).copied().unwrap_or_default();
        for index in [
            a >> 2,
            ((a & 3) << 4) | (b >> 4),
            if chunk.len() > 1 {
                ((b & 15) << 2) | (c >> 6)
            } else {
                64
            },
            if chunk.len() > 2 { c & 63 } else { 64 },
        ] {
            result.push(if index == 64 {
                '='
            } else {
                char::from(alphabet.get(index as usize).copied().unwrap_or(b'='))
            });
        }
    }
    result
}
