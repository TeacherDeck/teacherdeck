// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Authenticated TIMEALERT v1 transport, based on the original BackupManager.kt byte contract.
use super::{internal, invalid};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::AeadInPlace};
use deck_core::DeckError;
use std::collections::{BTreeMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::path::Path;

pub const BACKUP_LIMIT: usize = 512 * 1024 * 1024;
pub const PHOTO_LIMIT: usize = 16 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 1024 * 1024 * 1024;
const PHOTO_TOTAL: u64 = 256 * 1024 * 1024;
const ITERATIONS: u32 = 120_000;

pub fn password(value: &str) -> Result<(), DeckError> {
    if value.is_empty() || value.len() > 1024 {
        return Err(invalid());
    }
    Ok(())
}
fn cipher(value: &str, salt: &[u8]) -> Result<Aes256Gcm, DeckError> {
    password(value)?;
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2_compat::Sha256>(value.as_bytes(), salt, ITERATIONS, &mut key);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| internal());
    key.fill(0);
    cipher
}
/// Authenticates before any filesystem extraction or database access.
pub fn decrypt(mut bytes: Vec<u8>, value: &str) -> Result<Vec<u8>, DeckError> {
    password(value)?;
    if bytes.len() > BACKUP_LIMIT {
        return Err(invalid());
    }
    let at = bytes
        .iter()
        .take(128)
        .position(|b| *b == b'\n')
        .ok_or_else(invalid)?;
    let header =
        std::str::from_utf8(bytes.get(..at).ok_or_else(invalid)?).map_err(|_| invalid())?;
    let fields: Vec<_> = header.split('|').collect();
    let [magic, format, schema, date, iterations] = fields.as_slice() else {
        return Err(invalid());
    };
    if *magic != "TIMEALERT"
        || *format != "1"
        || *schema != "7"
        || *iterations != "120000"
        || !deck_core::caps::school_data::valid_date(date)
    {
        return Err(invalid());
    }
    let start = at + 1;
    let salt: [u8; 16] = bytes
        .get(start..start + 16)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    let iv: [u8; 12] = bytes
        .get(start + 16..start + 28)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    if bytes.len() < start + 28 + 16 {
        return Err(invalid());
    }
    bytes.drain(..start + 28);
    cipher(value, &salt)?
        .decrypt_in_place(Nonce::from_slice(&iv), b"", &mut bytes)
        .map_err(|_| invalid())?;
    Ok(bytes)
}
pub fn encrypt(mut zip: Vec<u8>, value: &str, date: &str) -> Result<Vec<u8>, DeckError> {
    password(value)?;
    if !deck_core::caps::school_data::valid_date(date)
        || zip.len() > BACKUP_LIMIT.saturating_sub(160)
    {
        return Err(invalid());
    }
    let mut salt = [0u8; 16];
    let mut iv = [0u8; 12];
    getrandom::fill(&mut salt).map_err(|_| internal())?;
    getrandom::fill(&mut iv).map_err(|_| internal())?;
    cipher(value, &salt)?
        .encrypt_in_place(Nonce::from_slice(&iv), b"", &mut zip)
        .map_err(|_| internal())?;
    let mut output = format!("TIMEALERT|1|7|{date}|120000\n").into_bytes();
    output.extend_from_slice(&salt);
    output.extend_from_slice(&iv);
    let prefix = output.len();
    let encrypted = zip.len();
    zip.resize(encrypted.checked_add(prefix).ok_or_else(invalid)?, 0);
    zip.copy_within(..encrypted, prefix);
    zip.get_mut(..prefix)
        .ok_or_else(invalid)?
        .copy_from_slice(&output);
    if zip.len() > BACKUP_LIMIT {
        return Err(invalid());
    }
    Ok(zip)
}
fn safe_photo(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| c.is_control() || "\\/:<>\"|?*".contains(c))
        && !name.ends_with(['.', ' '])
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or_default()
                .to_ascii_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
}
/// Writes only fixed private filenames. Original names remain private mapping keys.
pub fn extract(zip: Vec<u8>, root: &Path) -> Result<BTreeMap<String, String>, DeckError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(zip)).map_err(|_| invalid())?;
    if archive.is_empty() || archive.len() > 20_002 {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    let mut folded = HashSet::new();
    let mut total = 0u64;
    let mut photo_total = 0u64;
    let mut photos = BTreeMap::new();
    let mut database = false;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| invalid())?;
        let name = entry.name().map_err(|_| invalid())?.into_owned();
        if !seen.insert(name.clone())
            || !folded.insert(name.to_lowercase())
            || entry.is_symlink()
            || !matches!(
                entry.compression(),
                zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
            )
        {
            return Err(invalid());
        }
        if entry.is_dir() && matches!(name.as_str(), "database/" | "photos/") {
            continue;
        }
        let (destination, bound, photo) = match name.as_str() {
            "database/timealert.db" => {
                database = true;
                ("timealert.db".to_string(), BACKUP_LIMIT, false)
            }
            "database/timealert.db-wal" => ("timealert.db-wal".to_string(), BACKUP_LIMIT, false),
            _ => {
                let basename = name
                    .strip_prefix("photos/")
                    .filter(|n| safe_photo(n))
                    .ok_or_else(invalid)?;
                let key = format!("photo-{}", photos.len());
                photos.insert(basename.to_string(), key.clone());
                (key, PHOTO_LIMIT, true)
            }
        };
        if entry.is_dir()
            || entry.size() > bound as u64
            || entry.size() > TOTAL_LIMIT.saturating_sub(total)
        {
            return Err(invalid());
        }
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(root.join(destination))
            .map_err(|_| internal())?;
        let mut actual = 0usize;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = entry.read(&mut buffer).map_err(|_| invalid())?;
            if read == 0 {
                break;
            }
            actual = actual.checked_add(read).ok_or_else(invalid)?;
            total += read as u64;
            if photo {
                photo_total += read as u64;
            }
            if actual > bound || total > TOTAL_LIMIT || photo_total > PHOTO_TOTAL {
                return Err(invalid());
            }
            output
                .write_all(buffer.get(..read).ok_or_else(invalid)?)
                .map_err(|_| internal())?;
        }
        if actual == 0 {
            return Err(invalid());
        }
        output.sync_all().map_err(|_| internal())?;
    }
    if !database {
        return Err(invalid());
    }
    Ok(photos)
}
struct BoundedZip(Cursor<Vec<u8>>);
impl Write for BoundedZip {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.position().saturating_add(bytes.len() as u64) > BACKUP_LIMIT as u64 - 160 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "backup size limit",
            ));
        }
        self.0.write(bytes)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}
impl std::io::Seek for BoundedZip {
    fn seek(&mut self, value: std::io::SeekFrom) -> std::io::Result<u64> {
        self.0.seek(value)
    }
}
pub fn pack(db: &Path, photos: &BTreeMap<String, Vec<u8>>) -> Result<Vec<u8>, DeckError> {
    let mut zip = zip::ZipWriter::new(BoundedZip(Cursor::new(Vec::new())));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("database/timealert.db", options)
        .map_err(|_| internal())?;
    let source = std::fs::File::open(db).map_err(|_| internal())?;
    if source.metadata().map_err(|_| internal())?.len() > BACKUP_LIMIT as u64 {
        return Err(invalid());
    }
    std::io::copy(&mut source.take(BACKUP_LIMIT as u64 + 1), &mut zip).map_err(|_| internal())?;
    let mut total = 0usize;
    for (name, bytes) in photos {
        total = total.checked_add(bytes.len()).ok_or_else(invalid)?;
        if !safe_photo(name)
            || bytes.is_empty()
            || bytes.len() > PHOTO_LIMIT
            || total > PHOTO_TOTAL as usize
        {
            return Err(invalid());
        }
        zip.start_file(format!("photos/{name}"), options)
            .map_err(|_| internal())?;
        zip.write_all(bytes).map_err(|_| internal())?;
    }
    Ok(zip.finish().map_err(|_| internal())?.0.into_inner())
}
