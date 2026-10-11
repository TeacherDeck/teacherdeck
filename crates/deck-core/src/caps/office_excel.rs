// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Fail-closed Excel preflight. CFB structure follows the existing bounded HWP reader;
//! only BIFF5/8 and OOXML are admitted. No document code or Office application runs here.
use crate::{DeckError, ErrorCode};
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom};

const END: u32 = 0xfffffffe;
const FREE: u32 = 0xffffffff;
const MAX_STREAM: usize = 64 * 1024 * 1024;
fn rejected() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "Excel 문서의 매크로·암호·파일 구조를 먼저 직접 확인해 주세요.",
    )
}
fn xlm() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "Excel 4.0 매크로 문서는 직접 확인해 주세요.",
    )
}
fn u16_at(bytes: &[u8], at: usize) -> Result<u16, DeckError> {
    Ok(u16::from_le_bytes(
        bytes
            .get(at..at.checked_add(2).ok_or_else(rejected)?)
            .ok_or_else(rejected)?
            .try_into()
            .map_err(|_| rejected())?,
    ))
}
fn u32_at(bytes: &[u8], at: usize) -> Result<u32, DeckError> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at.checked_add(4).ok_or_else(rejected)?)
            .ok_or_else(rejected)?
            .try_into()
            .map_err(|_| rejected())?,
    ))
}
fn words(bytes: &[u8]) -> Result<Vec<u32>, DeckError> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|part| u32_at(part, 0))
        .collect()
}
struct Cfb<'a, R> {
    reader: &'a mut R,
    sector: usize,
    sectors: usize,
    fat: Vec<u32>,
}
impl<R: Read + Seek> Cfb<'_, R> {
    fn sector(&mut self, id: u32) -> Result<Vec<u8>, DeckError> {
        let id = usize::try_from(id).map_err(|_| rejected())?;
        if id >= self.sectors {
            return Err(rejected());
        }
        let offset = id
            .checked_add(1)
            .and_then(|n| n.checked_mul(self.sector))
            .ok_or_else(rejected)?;
        self.reader
            .seek(SeekFrom::Start(
                u64::try_from(offset).map_err(|_| rejected())?,
            ))
            .map_err(|_| rejected())?;
        let mut bytes = vec![0; self.sector];
        self.reader.read_exact(&mut bytes).map_err(|_| rejected())?;
        Ok(bytes)
    }
    fn chain(
        &mut self,
        start: u32,
        size: Option<usize>,
        limit: usize,
    ) -> Result<Vec<u8>, DeckError> {
        if size.is_some_and(|n| n > limit) {
            return Err(rejected());
        }
        let mut seen = HashSet::new();
        let mut id = start;
        let mut bytes = Vec::new();
        while id != END {
            if !seen.insert(id)
                || bytes
                    .len()
                    .checked_add(self.sector)
                    .is_none_or(|n| n > limit)
            {
                return Err(rejected());
            }
            let next = *self
                .fat
                .get(usize::try_from(id).map_err(|_| rejected())?)
                .ok_or_else(rejected)?;
            bytes.extend(self.sector(id)?);
            id = next;
        }
        if let Some(size) = size {
            if size > bytes.len() || bytes.len() - size >= self.sector {
                return Err(rejected());
            }
            bytes.truncate(size);
        }
        Ok(bytes)
    }
}
fn biff(bytes: &[u8]) -> Result<(), DeckError> {
    fn bof(bytes: &[u8], at: usize, kind: u16) -> Result<(), DeckError> {
        let length = usize::from(u16_at(bytes, at.checked_add(2).ok_or_else(rejected)?)?);
        let version = u16_at(bytes, at.checked_add(4).ok_or_else(rejected)?)?;
        if u16_at(bytes, at)? != 0x0809
            || !matches!((version, length), (0x0500, 8) | (0x0600, 16))
            || u16_at(bytes, at.checked_add(6).ok_or_else(rejected)?)? != kind
            || at
                .checked_add(4 + length)
                .is_none_or(|end| end > bytes.len())
        {
            return Err(rejected());
        }
        Ok(())
    }
    bof(bytes, 0, 0x0005)?;
    let mut at = 0usize;
    let mut sheets = Vec::new();
    let global_end = loop {
        let id = u16_at(bytes, at)?;
        let size = usize::from(u16_at(bytes, at.checked_add(2).ok_or_else(rejected)?)?);
        let begin = at.checked_add(4).ok_or_else(rejected)?;
        let end = begin.checked_add(size).ok_or_else(rejected)?;
        let body = bytes.get(begin..end).ok_or_else(rejected)?;
        if id == 0x002f {
            return Err(rejected());
        } // FILEPASS: no password prompt is opened.
        if id == 0x0809 && at != 0 {
            return Err(rejected());
        }
        if id == 0x0018 {
            // Lbl: macro functions/procedures can exist as defined names.
            if body.len() < 14 {
                return Err(rejected());
            }
            let flags = u16_at(body, 0)?;
            if flags & 2 != 0 || (flags & 8 != 0 && flags & 4 == 0) {
                return Err(xlm());
            }
            if flags & 0x20 != 0 {
                let name_at = if u16_at(bytes, 4)? == 0x0600 { 15 } else { 14 };
                if matches!(body.get(name_at), Some(1 | 2 | 10 | 11)) {
                    return Err(xlm());
                }
            }
        }
        if id == 0x0085 {
            let version = u16_at(bytes, 4)?;
            let count = usize::from(*body.get(6).ok_or_else(rejected)?);
            let name_size = if version == 0x0600 {
                let flags = *body.get(7).ok_or_else(rejected)?;
                if flags > 1 {
                    return Err(rejected());
                }
                8 + count * (1 + usize::from(flags))
            } else {
                7 + count
            };
            if !(1..=31).contains(&count)
                || body.len() != name_size
                || *body.get(4).ok_or_else(rejected)? > 2
            {
                return Err(rejected());
            }
            let kind = *body.get(5).ok_or_else(rejected)?;
            if kind == 1 {
                return Err(xlm());
            }
            let expected = match kind {
                0 => 0x0010,
                2 => 0x0020,
                6 => 0x0006,
                _ => return Err(rejected()),
            };
            sheets.push((
                usize::try_from(u32_at(body, 0)?).map_err(|_| rejected())?,
                expected,
            ));
        }
        at = end;
        if id == 0x000a {
            if size != 0 {
                return Err(rejected());
            }
            break at;
        }
        if at > 4 * 1024 * 1024 {
            return Err(rejected());
        }
    };
    if sheets.is_empty() {
        return Err(rejected());
    }
    // Top-level sheets have disjoint substreams. Reject an overlap before scanning
    // its body so many offsets cannot repeatedly parse the same long suffix.
    sheets.sort_unstable_by_key(|(offset, _)| *offset);
    let mut seen = HashSet::new();
    for (index, &(offset, kind)) in sheets.iter().enumerate() {
        let limit = sheets.get(index + 1).map_or(bytes.len(), |&(next, _)| next);
        if offset < global_end || !seen.insert(offset) {
            return Err(rejected());
        }
        if u16_at(bytes, offset.checked_add(6).ok_or_else(rejected)?)? == 0x0040 {
            return Err(xlm());
        }
        bof(bytes, offset, kind)?;
        // Parse lengths and nested chart substreams through EOF. Never admit a repairable
        // truncated sheet or an undeclared XLM BOF hidden inside another sheet.
        let mut at = offset;
        let mut depth = 0usize;
        loop {
            let id = u16_at(bytes, at)?;
            let size = usize::from(u16_at(bytes, at.checked_add(2).ok_or_else(rejected)?)?);
            let end = at.checked_add(4 + size).ok_or_else(rejected)?;
            if end > limit {
                return Err(rejected());
            }
            bytes.get(at..end).ok_or_else(rejected)?;
            if id == 0x0809 {
                let subkind = u16_at(bytes, at.checked_add(6).ok_or_else(rejected)?)?;
                if subkind == 0x0040 {
                    return Err(xlm());
                }
                if at != offset && subkind != 0x0020 {
                    return Err(rejected());
                }
                bof(bytes, at, subkind)?;
                depth += 1;
                if depth > 32 {
                    return Err(rejected());
                }
            }
            at = end;
            if id == 0x000a {
                if size != 0 || depth == 0 {
                    return Err(rejected());
                }
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
        }
    }
    Ok(())
}
fn cfb<R: Read + Seek>(reader: &mut R, length: u64) -> Result<(), DeckError> {
    let mut header = [0u8; 512];
    reader.seek(SeekFrom::Start(0)).map_err(|_| rejected())?;
    reader.read_exact(&mut header).map_err(|_| rejected())?;
    if header.get(..8) != Some(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        || u16_at(&header, 28)? != 0xfffe
        || u16_at(&header, 32)? != 6
        || u32_at(&header, 56)? != 4096
    {
        return Err(rejected());
    }
    let major = u16_at(&header, 26)?;
    let sector = match (major, u16_at(&header, 30)?) {
        (3, 9) => 512,
        (4, 12) => 4096,
        _ => return Err(rejected()),
    };
    let length = usize::try_from(length).map_err(|_| rejected())?;
    if length < sector * 2
        || length % sector != 0
        || length > 512 * 1024 * 1024
        || (major == 3 && u32_at(&header, 40)? != 0)
    {
        return Err(rejected());
    }
    let mut file = Cfb {
        reader,
        sector,
        sectors: length / sector - 1,
        fat: Vec::new(),
    };
    let mut difat: Vec<_> = words(header.get(76..512).ok_or_else(rejected)?)?
        .into_iter()
        .filter(|id| *id != FREE)
        .collect();
    let extra = u32_at(&header, 72)?;
    if extra > 256 {
        return Err(rejected());
    }
    let mut next = u32_at(&header, 68)?;
    let mut extra_seen = HashSet::new();
    for _ in 0..extra {
        if !extra_seen.insert(next) {
            return Err(rejected());
        }
        let mut ids = words(&file.sector(next)?)?;
        next = ids.pop().ok_or_else(rejected)?;
        difat.extend(ids.into_iter().filter(|id| *id != FREE));
    }
    if next != END && !(extra == 0 && next == FREE) {
        return Err(rejected());
    }
    let count = usize::try_from(u32_at(&header, 44)?).map_err(|_| rejected())?;
    if count == 0
        || count > 16384
        || difat.len() != count
        || difat.iter().copied().collect::<HashSet<_>>().len() != count
    {
        return Err(rejected());
    }
    for id in &difat {
        let sector_words = words(&file.sector(*id)?)?;
        file.fat.extend(sector_words);
    }
    if file.fat.len() < file.sectors {
        return Err(rejected());
    }
    for id in &difat {
        if file.fat.get(usize::try_from(*id).map_err(|_| rejected())?) != Some(&0xfffffffd) {
            return Err(rejected());
        }
    }
    for id in extra_seen {
        if file.fat.get(usize::try_from(id).map_err(|_| rejected())?) != Some(&0xfffffffc) {
            return Err(rejected());
        }
    }
    let directory = file.chain(u32_at(&header, 48)?, None, 4 * 1024 * 1024)?;
    let mut root = None;
    let mut book = None;
    let mut links = Vec::new();
    let mut used = 0usize;
    for (index, entry) in directory.as_chunks::<128>().0.iter().enumerate() {
        let kind = *entry.get(66).ok_or_else(rejected)?;
        links.push((
            kind,
            u32_at(entry, 68)?,
            u32_at(entry, 72)?,
            u32_at(entry, 76)?,
        ));
        if kind == 0 {
            continue;
        }
        used += 1;
        if !matches!(kind, 1 | 2 | 5) {
            return Err(rejected());
        }
        if (index == 0) != (kind == 5) || (kind == 2 && u32_at(entry, 76)? != FREE) {
            return Err(rejected());
        }
        let size = usize::from(u16_at(entry, 64)?);
        if !(2..=64).contains(&size) || size % 2 != 0 || u16_at(entry, size - 2)? != 0 {
            return Err(rejected());
        }
        let name = String::from_utf16(
            &entry
                .get(..size - 2)
                .ok_or_else(rejected)?
                .as_chunks::<2>()
                .0
                .iter()
                .map(|c| u16_at(c, 0))
                .collect::<Result<Vec<_>, _>>()?,
        )
        .map_err(|_| rejected())?;
        // A hidden terminator must not make Office read a different stream name.
        if name.is_empty() || name.contains('\0') {
            return Err(rejected());
        }
        if kind == 2
            && (name.eq_ignore_ascii_case("EncryptionInfo")
                || name.eq_ignore_ascii_case("EncryptedPackage"))
        {
            return Err(rejected());
        }
        let high = u32_at(entry, 124)?;
        if major == 3 && high != 0 {
            return Err(rejected());
        }
        let stream_size = u64::from(u32_at(entry, 120)?) | (u64::from(high) << 32);
        let stream = (
            u32_at(entry, 116)?,
            usize::try_from(stream_size).map_err(|_| rejected())?,
        );
        if kind == 5 && root.replace(stream).is_some() {
            return Err(rejected());
        }
        if kind == 2
            && (name.eq_ignore_ascii_case("Workbook") || name.eq_ignore_ascii_case("Book"))
            && book.replace(stream).is_some()
        {
            return Err(rejected());
        }
    }
    let root = root.ok_or_else(rejected)?;
    let root_links = links.first().ok_or_else(rejected)?;
    if root_links.1 != FREE || root_links.2 != FREE {
        return Err(rejected());
    }
    let mut pending = vec![root_links.3];
    let mut reached = HashSet::new();
    while let Some(id) = pending.pop() {
        if id == FREE {
            continue;
        }
        if id == 0 || !reached.insert(id) {
            return Err(rejected());
        }
        let entry = links
            .get(usize::try_from(id).map_err(|_| rejected())?)
            .ok_or_else(rejected)?;
        if !matches!(entry.0, 1 | 2) {
            return Err(rejected());
        }
        pending.extend([entry.1, entry.2, entry.3]);
    }
    if reached.len() + 1 != used {
        return Err(rejected());
    }
    let book = book.ok_or_else(rejected)?;
    if book.1 == 0 || book.1 > MAX_STREAM {
        return Err(rejected());
    }
    let bytes = if book.1 >= 4096 {
        file.chain(book.0, Some(book.1), MAX_STREAM)?
    } else {
        let mini_count = usize::try_from(u32_at(&header, 64)?).map_err(|_| rejected())?;
        if mini_count == 0 || mini_count > 16384 {
            return Err(rejected());
        }
        let mini_size = mini_count.checked_mul(sector).ok_or_else(rejected)?;
        let mini_fat = words(&file.chain(u32_at(&header, 60)?, Some(mini_size), MAX_STREAM)?)?;
        let mini_stream = file.chain(root.0, Some(root.1), MAX_STREAM)?;
        let mut bytes = Vec::new();
        let mut id = book.0;
        let mut seen = HashSet::new();
        while id != END {
            if !seen.insert(id) || bytes.len() >= 4096 {
                return Err(rejected());
            }
            let index = usize::try_from(id).map_err(|_| rejected())?;
            let start = index.checked_mul(64).ok_or_else(rejected)?;
            bytes.extend_from_slice(
                mini_stream
                    .get(start..start.checked_add(64).ok_or_else(rejected)?)
                    .ok_or_else(rejected)?,
            );
            id = *mini_fat.get(index).ok_or_else(rejected)?;
        }
        if book.1 > bytes.len() || bytes.len() - book.1 >= 64 {
            return Err(rejected());
        }
        bytes.truncate(book.1);
        bytes
    };
    biff(&bytes)
}

#[path = "office_excel_xml.rs"]
mod xml;

fn metadata<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    index: usize,
    total: &mut u64,
) -> Result<Vec<u8>, DeckError> {
    let mut entry = archive.by_index(index).map_err(|_| rejected())?;
    *total = total.checked_add(entry.size()).ok_or_else(rejected)?;
    if entry.size() > 1024 * 1024 || *total > 8 * 1024 * 1024 {
        return Err(rejected());
    }
    let mut bytes = Vec::new();
    (&mut entry)
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| rejected())?;
    if bytes.len() as u64 != entry.size() {
        return Err(rejected());
    }
    Ok(bytes)
}

fn ooxml<R: Read + Seek>(reader: &mut R) -> Result<(), DeckError> {
    reader.seek(SeekFrom::Start(0)).map_err(|_| rejected())?;
    let mut archive = zip::ZipArchive::new(reader).map_err(|_| rejected())?;
    if archive.len() > 20000 {
        return Err(rejected());
    }
    let mut names = std::collections::HashMap::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| rejected())?;
        let name = entry.name().to_ascii_lowercase();
        if name.starts_with('/')
            || name.contains('\\')
            || name.split('/').any(|s| matches!(s, "." | ".."))
            || names.insert(name.clone(), index).is_some()
        {
            return Err(rejected());
        }
    }
    let mut total = 0;
    let types_index = *names.get("[content_types].xml").ok_or_else(rejected)?;
    let types = xml::content_types(&metadata(&mut archive, types_index, &mut total)?)?;
    let mut main = None;
    for (name, &index) in &names {
        if name.ends_with(".rels") {
            let root = name == "_rels/.rels";
            let target = xml::relationships(&metadata(&mut archive, index, &mut total)?, root)?;
            if root {
                main = target;
            }
        }
    }
    let main = main.ok_or_else(rejected)?;
    if !types.content_type(&main).is_some_and(xml::is_workbook_type) {
        return Err(rejected());
    }
    let (base, file) = main.rsplit_once('/').unwrap_or(("", main.as_str()));
    let relations = if base.is_empty() {
        format!("_rels/{file}.rels")
    } else {
        format!("{base}/_rels/{file}.rels")
    };
    if !names.contains_key(&relations) {
        return Err(rejected());
    }
    // Inspect every declared workbook, including the actual main part, rather
    // than assuming Excel selects xl/workbook.xml or trusting a decoy there.
    for (name, kind) in &types.overrides {
        if xml::is_workbook_type(kind) && !names.contains_key(name) {
            return Err(rejected());
        }
    }
    for (name, &index) in &names {
        if name != "[content_types].xml"
            && types.content_type(name).is_some_and(xml::is_workbook_type)
        {
            xml::workbook(&metadata(&mut archive, index, &mut total)?)?;
        }
    }
    Ok(())
}

/// Inspect a locked/staged Excel source before any Office activation or document open.
/// Unknown, encrypted, oversized or malformed structures are rejected without executing code.
pub fn validate_excel_source<R: Read + Seek>(
    reader: &mut R,
    length: u64,
    extension: &str,
) -> Result<(), DeckError> {
    if length == 0 || length > 512 * 1024 * 1024 {
        return Err(rejected());
    }
    match extension {
        "xls" => cfb(reader, length),
        "xlsx" | "xlsm" => ooxml(reader),
        _ => Err(rejected()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    fn record(target: &mut Vec<u8>, id: u16, body: &[u8]) {
        target.extend(id.to_le_bytes());
        target.extend((body.len() as u16).to_le_bytes());
        target.extend(body);
    }
    fn book(kind: u8, extra: Option<(u16, Vec<u8>)>) -> Vec<u8> {
        let mut data = Vec::new();
        let mut bof = vec![0; 16];
        bof[..2].copy_from_slice(&0x0600u16.to_le_bytes());
        bof[2..4].copy_from_slice(&5u16.to_le_bytes());
        record(&mut data, 0x0809, &bof);
        if let Some((id, body)) = extra {
            record(&mut data, id, &body);
        }
        let position = data.len();
        record(&mut data, 0x0085, &[0, 0, 0, 0, 0, kind, 1, 0, b'S']);
        record(&mut data, 0x000a, &[]);
        let sheet = data.len() as u32;
        data[position + 4..position + 8].copy_from_slice(&sheet.to_le_bytes());
        bof[2..4].copy_from_slice(&0x0010u16.to_le_bytes());
        record(&mut data, 0x0809, &bof);
        record(&mut data, 0x000a, &[]);
        data
    }
    fn put32(data: &mut [u8], at: usize, value: u32) {
        data[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }
    fn entry(data: &mut [u8], name: &str, kind: u8, start: u32, size: u32) {
        let name: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
        for (i, c) in name.iter().enumerate() {
            data[i * 2..i * 2 + 2].copy_from_slice(&c.to_le_bytes());
        }
        data[64..66].copy_from_slice(&((name.len() * 2) as u16).to_le_bytes());
        data[66] = kind;
        for at in [68, 72, 76] {
            put32(data, at, FREE);
        }
        put32(data, 116, start);
        put32(data, 120, size);
    }
    fn compound(book: &[u8], mini: bool) -> Vec<u8> {
        let mut data = vec![0; 11 * 512];
        data[..8].copy_from_slice(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        for (at, value) in [(26, 3u16), (28, 0xfffe), (30, 9), (32, 6)] {
            data[at..at + 2].copy_from_slice(&value.to_le_bytes());
        }
        put32(&mut data, 44, 1);
        put32(&mut data, 48, 8);
        put32(&mut data, 56, 4096);
        put32(&mut data, 60, if mini { 7 } else { END });
        put32(&mut data, 64, u32::from(mini));
        put32(&mut data, 68, END);
        for at in (76..512).step_by(4) {
            put32(&mut data, at, FREE);
        }
        put32(&mut data, 76, 9);
        data[512..512 + book.len()].copy_from_slice(book);
        entry(
            &mut data[9 * 512..9 * 512 + 128],
            "Root Entry",
            5,
            if mini { 0 } else { END },
            if mini { 512 } else { 0 },
        );
        put32(&mut data, 9 * 512 + 76, 1);
        entry(
            &mut data[9 * 512 + 128..9 * 512 + 256],
            "Workbook",
            2,
            0,
            if mini { book.len() as u32 } else { 4096 },
        );
        for at in (10 * 512..11 * 512).step_by(4) {
            put32(&mut data, at, FREE);
        }
        for id in 0..8 {
            put32(
                &mut data,
                10 * 512 + id * 4,
                if mini || id == 7 { END } else { id as u32 + 1 },
            );
        }
        put32(&mut data, 10 * 512 + 8 * 4, END);
        put32(&mut data, 10 * 512 + 9 * 4, 0xfffffffd);
        if mini {
            for at in (8 * 512..9 * 512).step_by(4) {
                put32(&mut data, at, FREE);
            }
            let count = book.len().div_ceil(64);
            for id in 0..count {
                put32(
                    &mut data,
                    8 * 512 + id * 4,
                    if id + 1 == count { END } else { id as u32 + 1 },
                );
            }
        }
        data
    }
    fn check(data: Vec<u8>, extension: &str) -> Result<(), DeckError> {
        validate_excel_source(&mut Cursor::new(&data), data.len() as u64, extension)
    }
    const TYPES: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
    const RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
    const SHEET: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const MAIN_TYPE: &str =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
    const OFFICE_REL: &str =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
    fn zip_parts(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for &(name, bytes) in parts {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    fn main_package(path: &str, workbook: &str, extra: Option<(&str, &[u8])>) -> Vec<u8> {
        let types = format!(
            "<Types xmlns='{TYPES}'><Override PartName='/{path}' ContentType='{MAIN_TYPE}'/></Types>"
        );
        let root = format!(
            "<Relationships xmlns='{RELS}'><Relationship Id='main' Type='{OFFICE_REL}' Target='{path}'/></Relationships>"
        );
        let rels = format!("<Relationships xmlns='{RELS}'/>");
        let (base, file) = path.rsplit_once('/').unwrap_or(("", path));
        let rel_path = if base.is_empty() {
            format!("_rels/{file}.rels")
        } else {
            format!("{base}/_rels/{file}.rels")
        };
        let mut parts = vec![
            ("[Content_Types].xml", types.as_bytes()),
            ("_rels/.rels", root.as_bytes()),
            (path, workbook.as_bytes()),
            (rel_path.as_str(), rels.as_bytes()),
        ];
        parts.extend(extra);
        zip_parts(&parts)
    }
    fn package(types: &str, workbook: &str, rels: &str, extra: Option<(&str, &[u8])>) -> Vec<u8> {
        let types = if types == "<Types/>" {
            format!(
                "<Types xmlns='{TYPES}'><Override PartName='/xl/workbook.xml' ContentType='{MAIN_TYPE}'/></Types>"
            )
        } else {
            types.replacen("<Types", &format!("<Types xmlns='{TYPES}'"), 1)
        };
        let workbook = workbook.replacen("<workbook", &format!("<workbook xmlns='{SHEET}'"), 1);
        let rels = rels.replacen(
            "<Relationships",
            &format!("<Relationships xmlns='{RELS}'"),
            1,
        );
        let root = format!(
            "<Relationships xmlns='{RELS}'><Relationship Id='main' Type='{OFFICE_REL}' Target='xl/workbook.xml'/></Relationships>"
        );
        let mut parts = vec![
            ("[Content_Types].xml", types.as_bytes()),
            ("_rels/.rels", root.as_bytes()),
            ("xl/workbook.xml", workbook.as_bytes()),
            ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
        ];
        parts.extend(extra);
        zip_parts(&parts)
    }
    #[test]
    fn normal_biff_regular_and_mini_streams_are_admitted() {
        for mini in [false, true] {
            check(compound(&book(0, None), mini), "xls").unwrap();
        }
    }
    #[test]
    fn encrypted_container_markers_cannot_hide_behind_a_valid_biff_workbook() {
        for mini in [false, true] {
            for name in [
                "EncryptionInfo",
                "EncryptedPackage",
                "eNcRyPtEdPaCkAgE",
                "EncryptedPackage\0hidden",
            ] {
                let mut data = compound(&book(0, None), mini);
                // Keep the valid Workbook and attach a second reachable stream.
                put32(&mut data, 9 * 512 + 128 + 72, 2);
                entry(&mut data[9 * 512 + 256..9 * 512 + 384], name, 2, END, 0);
                assert!(check(data, "xls").is_err(), "marker {name}");
            }
        }
    }
    fn book_with_chart(overlap: bool) -> Vec<u8> {
        let mut data = book(0, Some((0x0085, vec![0, 0, 0, 0, 0, 2, 1, 0, b'C'])));
        if overlap {
            // Make the declared chart a nested chart inside the declared worksheet.
            data.truncate(data.len() - 4);
        }
        let chart = data.len() as u32;
        put32(&mut data, 24, chart);
        let mut bof = vec![0; 16];
        bof[..2].copy_from_slice(&0x0600u16.to_le_bytes());
        bof[2..4].copy_from_slice(&0x0020u16.to_le_bytes());
        record(&mut data, 0x0809, &bof);
        record(&mut data, 0x000a, &[]);
        if overlap {
            record(&mut data, 0x000a, &[]);
        }
        data
    }
    #[test]
    fn disjoint_sheets_may_be_declared_out_of_order_but_overlapping_substreams_are_rejected() {
        for mini in [false, true] {
            check(compound(&book_with_chart(false), mini), "xls").unwrap();
            assert!(check(compound(&book_with_chart(true), mini), "xls").is_err());
        }
    }
    #[test]
    fn xlm_sheet_flag_is_rejected_without_any_executable_formula() {
        assert!(biff(&book(1, None)).unwrap_err().message.contains("4.0"));
        for mini in [false, true] {
            assert!(check(compound(&book(1, None), mini), "xls").is_err());
        }
    }
    #[test]
    fn mismatched_macro_bof_and_unsupported_sheet_type_are_rejected() {
        let mut data = book(0, None);
        let sheet = u32_at(&data, 24).unwrap() as usize;
        data[sheet + 6..sheet + 8].copy_from_slice(&0x0040u16.to_le_bytes());
        assert!(biff(&data).is_err());
        assert!(biff(&book(7, None)).is_err());
    }
    #[test]
    fn macro_defined_names_and_password_records_are_rejected() {
        let mut name = vec![0; 16];
        name[0] = 2 | 8;
        assert!(biff(&book(0, Some((0x0018, name)))).is_err());
        assert!(biff(&book(0, Some((0x002f, vec![0; 8])))).is_err());
    }
    #[test]
    fn invalid_header_sector_offsets_cycles_and_sizes_fail_closed() {
        let base = compound(&book(0, None), false);
        for (at, value) in [
            (44, u32::MAX),
            (48, u32::MAX - 3),
            (68, 0),
            (72, 257),
            (10 * 512, 0),
            (9 * 512 + 128 + 68, 1),
            (9 * 512 + 76, u32::MAX - 3),
            (9 * 512 + 128 + 120, u32::MAX),
            (9 * 512 + 128 + 124, 1),
        ] {
            let mut data = base.clone();
            put32(&mut data, at, value);
            assert!(check(data, "xls").is_err(), "offset {at}");
        }
        for length in [0, 1, 511, 512, base.len() - 1] {
            assert!(check(base[..length].to_vec(), "xls").is_err());
        }
    }
    #[test]
    fn mini_fat_cycle_and_out_of_range_offsets_fail_closed() {
        for value in [0, u32::MAX - 3] {
            let mut data = compound(&book(0, None), true);
            put32(&mut data, 8 * 512, value);
            assert!(check(data, "xls").is_err());
        }
    }
    #[test]
    fn unknown_or_truncated_biff_and_sheet_offsets_fail_closed() {
        let data = book(0, None);
        for length in 0..data.len() {
            assert!(biff(&data[..length]).is_err());
        }
        let mut offset = data.clone();
        put32(&mut offset, 24, u32::MAX);
        assert!(biff(&offset).is_err());
        let mut version = data;
        version[4] = 0;
        version[5] = 4;
        assert!(biff(&version).is_err());
        assert!(check(b"unsupported HTML spreadsheet".to_vec(), "xls").is_err());
    }
    #[test]
    fn normal_ooxml_with_escaped_hyperlink_is_admitted() {
        check(package("<Types/>", "<workbook/>", "<Relationships><Relationship Id='link' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' TargetMode='External' Target='https://example.invalid/?a=1&amp;b=2'/></Relationships>", None), "xlsx").unwrap();
    }
    #[test]
    fn ooxml_macro_relationship_content_type_name_and_encoded_name_are_rejected() {
        for (types, workbook, rels, extra) in [
            (
                "<Types><Default Extension='xml' ContentType='application/vnd.ms-excel.macrosheet+xml'/></Types>",
                "<workbook/>",
                "<Relationships/>",
                None,
            ),
            (
                "<Types/>",
                "<workbook/>",
                "<Relationships><Relationship Id='sheet' Type='http://schemas.microsoft.com/office/2006/relationships/xlMacro&#x53;heet' Target='custom/sheet.xml'/></Relationships>",
                None,
            ),
            (
                "<Types><Override PartName='/custom/sheet.xml' ContentType='application/vnd.ms-excel.macrosheet+xml'/></Types>",
                "<workbook/>",
                "<Relationships/>",
                Some(("custom/sheet.xml", &b"<sheet/>"[..])),
            ),
            (
                "<Types/>",
                "<workbook><definedNames><definedName name='Auto_Open'/></definedNames></workbook>",
                "<Relationships/>",
                None,
            ),
            (
                "<Types/>",
                "<workbook><definedNames><definedName name='SyntheticName' xlm = '&#49;'/></definedNames></workbook>",
                "<Relationships/>",
                None,
            ),
        ] {
            assert!(check(package(types, workbook, rels, extra), "xlsm").is_err());
        }
    }
    #[test]
    fn ooxml_unsupported_xml_entities_utf16_and_missing_parts_fail_closed() {
        for xml in [
            "<!DOCTYPE x><Types/>",
            "<Types>&unknown;</Types>",
            "<Types>&#xFFFFFFFF;</Types>",
        ] {
            assert!(
                check(
                    package(xml, "<workbook/>", "<Relationships/>", None),
                    "xlsx"
                )
                .is_err()
            );
        }
        assert!(xml::workbook(&[0xff, 0xfe, 60, 0]).is_err());
        assert!(check(vec![0; 512], "xlsx").is_err());
        assert!(check(vec![0; 512], "xlsb").is_err());
    }

    #[test]
    fn actual_main_part_is_checked_and_normal_auto_open_sheet_is_allowed() {
        let benign = format!(
            "<workbook xmlns='{SHEET}'><sheets><sheet name='AUTO_OPEN' sheetId='1'/></sheets><definedNames><definedName name='Ordinary'>AUTO_OPEN!$A$1</definedName></definedNames></workbook>"
        );
        check(main_package("custom/actual.xml", &benign, None), "xlsx").unwrap();
        let malicious = format!(
            "<workbook xmlns='{SHEET}'><definedNames><definedName name='_xlnm.Auto_Open'>SyntheticName</definedName></definedNames></workbook>"
        );
        let decoy = format!("<workbook xmlns='{SHEET}'/>");
        assert!(
            check(
                main_package(
                    "custom/actual.xml",
                    &malicious,
                    Some(("xl/workbook.xml", decoy.as_bytes()))
                ),
                "xlsx"
            )
            .is_err()
        );
    }
    #[test]
    fn benign_macro_named_media_is_not_a_macro_sheet() {
        let types = format!(
            "<Types><Override PartName='/xl/workbook.xml' ContentType='{MAIN_TYPE}'/><Override PartName='/xl/media/macrosheet-preview.png' ContentType='image/png'/></Types>"
        );
        check(
            package(
                &types,
                "<workbook/>",
                "<Relationships/>",
                Some(("xl/media/macrosheet-preview.png", b"\x89PNG\r\n\x1a\n")),
            ),
            "xlsx",
        )
        .unwrap();
    }

    #[test]
    fn default_workbook_content_types_use_overrides_and_check_all_workbook_parts() {
        let types = format!(
            "<Types xmlns='{TYPES}'><Default Extension='xml' ContentType='{MAIN_TYPE}'/><Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/><Override PartName='/xl/sheet.xml' ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'/></Types>"
        );
        let root = format!(
            "<Relationships xmlns='{RELS}'><Relationship Id='main' Type='{OFFICE_REL}' Target='xl/workbook.xml'/></Relationships>"
        );
        let book = format!("<workbook xmlns='{SHEET}'/>");
        let rels = format!(
            "<Relationships xmlns='{RELS}'><Relationship Id='sheet' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet' Target='sheet.xml'/></Relationships>"
        );
        let sheet = format!("<worksheet xmlns='{SHEET}'/>");
        let mut parts = vec![
            ("[Content_Types].xml", types.as_bytes()),
            ("_rels/.rels", root.as_bytes()),
            ("xl/workbook.xml", book.as_bytes()),
            ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
            ("xl/sheet.xml", sheet.as_bytes()),
        ];
        check(zip_parts(&parts), "xlsx").unwrap();
        let other = format!(
            "<workbook xmlns='{SHEET}'><definedNames><definedName name='Auto_Open'/></definedNames></workbook>"
        );
        parts.push(("custom/other.xml", other.as_bytes()));
        assert!(
            check(zip_parts(&parts), "xlsx")
                .unwrap_err()
                .message
                .contains("4.0")
        );
        let declared = format!(
            "<Types xmlns='{TYPES}'><Default Extension='xml' ContentType='application/xml'/><Override PartName='/xl/workbook.xml' ContentType='{MAIN_TYPE}'/><Override PartName='/custom/other.xml' ContentType='{MAIN_TYPE}'/></Types>"
        );
        parts[0] = ("[Content_Types].xml", declared.as_bytes());
        assert!(
            check(zip_parts(&parts), "xlsx")
                .unwrap_err()
                .message
                .contains("4.0")
        );
    }
    #[test]
    fn workbook_xml_size_and_combined_metadata_limits_are_retained() {
        let huge = format!(
            "<workbook xmlns='{SHEET}'><!--{}--></workbook>",
            "x".repeat(1024 * 1024)
        );
        assert!(check(main_package("custom/actual.xml", &huge, None), "xlsx").is_err());
        let types = format!(
            "<Types xmlns='{TYPES}'><Override PartName='/xl/workbook.xml' ContentType='{MAIN_TYPE}'/></Types>"
        );
        let root = format!(
            "<Relationships xmlns='{RELS}'><Relationship Id='main' Type='{OFFICE_REL}' Target='xl/workbook.xml'/></Relationships>"
        );
        let book = format!("<workbook xmlns='{SHEET}'/>");
        let rel = format!(
            "<Relationships xmlns='{RELS}'><!--{}--></Relationships>",
            "x".repeat(950_000)
        );
        let names: Vec<_> = (0..9)
            .map(|n| format!("custom/_rels/sheet{n}.xml.rels"))
            .collect();
        let mut parts = vec![("[Content_Types].xml", types.as_bytes()), ("_rels/.rels", root.as_bytes()), ("xl/workbook.xml", book.as_bytes()), ("xl/_rels/workbook.xml.rels", b"<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'/>".as_slice())];
        for name in &names {
            parts.push((name.as_str(), rel.as_bytes()));
        }
        assert!(check(zip_parts(&parts), "xlsx").is_err());
    }
    #[test]
    fn root_relationship_must_select_one_internal_declared_workbook() {
        let types = format!(
            "<Types xmlns='{TYPES}'><Override PartName='/xl/workbook.xml' ContentType='{MAIN_TYPE}'/></Types>"
        );
        let book = format!("<workbook xmlns='{SHEET}'/>");
        let rels = format!("<Relationships xmlns='{RELS}'/>");
        for inner in [
            format!(
                "<Relationship Id='main' Type='{OFFICE_REL}' Target='https://example.invalid/book.xml' TargetMode='External'/>"
            ),
            format!("<Relationship Id='main' Type='{OFFICE_REL}' Target='../xl/workbook.xml'/>"),
            format!(
                "<Relationship Id='main' Type='{OFFICE_REL}' Target='xl/workbook.xml'/><Relationship Id='other' Type='{OFFICE_REL}' Target='xl/workbook.xml'/>"
            ),
            format!("<Relationship Id='main' Type='{OFFICE_REL}' Target='xl/missing.xml'/>"),
            "".to_owned(),
        ] {
            let root = format!("<Relationships xmlns='{RELS}'>{inner}</Relationships>");
            let parts = [
                ("[Content_Types].xml", types.as_bytes()),
                ("_rels/.rels", root.as_bytes()),
                ("xl/workbook.xml", book.as_bytes()),
                ("xl/_rels/workbook.xml.rels", rels.as_bytes()),
            ];
            assert!(check(zip_parts(&parts), "xlsx").is_err());
        }
    }
}
