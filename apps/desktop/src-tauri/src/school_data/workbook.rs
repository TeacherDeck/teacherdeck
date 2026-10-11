// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! ZIP transport only. XML interpretation reuses the tested photo-extract OOXML reader.
use deck_core::caps::school_data::{SchoolWorkbookInput, SchoolWorkbookOutputArgs};
use deck_core::{DeckError, ErrorCode};
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Write};
const LIMIT: usize = 32 * 1024 * 1024;
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "암호 없이 열리는 ZIP 형식 XLSX·XLS 파일과 크기를 확인해 주세요.",
    )
}
/// Counts actual inflated bytes for every ZIP member, including ignored files.
pub fn read(bytes: Vec<u8>) -> Result<SchoolWorkbookInput, DeckError> {
    if bytes.len() > LIMIT || !bytes.starts_with(b"PK") {
        return Err(invalid());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
    if archive.is_empty() || archive.len() > 4096 {
        return Err(invalid());
    }
    let mut remaining = LIMIT;
    let mut seen = HashSet::new();
    let mut parts = HashMap::new();
    let mut photo_count = 0;
    let mut xml_total = 0;
    for n in 0..archive.len() {
        let mut file = archive.by_index(n).map_err(|_| invalid())?;
        let name = file.name().to_owned();
        if name.len() > 240
            || name.starts_with('/')
            || name.chars().any(|c| c.is_control() || "\\:%?#".contains(c))
            || name.split('/').any(|p| p == ".." || p == ".")
            || file.enclosed_name().is_none()
            || !seen.insert(name.clone())
            || file.size() > remaining as u64
            || !matches!(
                file.compression(),
                zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
            )
        {
            return Err(invalid());
        }
        let wanted = name.starts_with("xl/") && (name.ends_with(".xml") || name.ends_with(".rels"));
        let photo = name.starts_with("xl/media/") && !file.is_dir();
        if photo {
            photo_count += 1;
        }
        let mut data = Vec::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut size = 0;
        loop {
            let count = file.read(&mut buffer).map_err(|_| invalid())?;
            if count == 0 {
                break;
            }
            remaining = remaining.checked_sub(count).ok_or_else(invalid)?;
            size += count;
            if wanted {
                if size > 4 * 1024 * 1024 {
                    return Err(invalid());
                }
                data.extend_from_slice(buffer.get(..count).ok_or_else(invalid)?);
            }
        }
        if wanted {
            xml_total += size;
            if xml_total > 16 * 1024 * 1024 {
                return Err(invalid());
            }
            let text = String::from_utf8(data).map_err(|_| invalid())?;
            let upper = text.to_ascii_uppercase();
            if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
                return Err(invalid());
            }
            parts.insert(name, text);
        }
    }
    if !parts
        .keys()
        .any(|p| p.starts_with("xl/worksheets/") && p.ends_with(".xml"))
    {
        return Err(invalid());
    }
    Ok(SchoolWorkbookInput { parts, photo_count })
}
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn column(mut n: usize) -> String {
    let mut out = String::new();
    loop {
        out.insert(0, char::from(b'A' + (n % 26) as u8));
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    out
}
/// Writes inline strings, so names starting with '=' never become executable formulas.
pub fn write(args: &SchoolWorkbookOutputArgs) -> Result<Vec<u8>, DeckError> {
    if !["학생 명단", "시간표"].contains(&args.sheet_name.as_str())
        || args.rows.is_empty()
        || args.rows.len() > 20000
        || args.rows.iter().any(|r| {
            r.len() > 512
                || r.iter().any(|v| {
                    v.len() > 10000 || v.chars().any(|c| c.is_control() && !"\n\r\t".contains(c))
                })
        })
    {
        return Err(invalid());
    }
    let total: usize = args
        .rows
        .iter()
        .flat_map(|r| r.iter())
        .map(String::len)
        .sum();
    if total > 16 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut sheet = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews><cols>",
    );
    let widths = if args.sheet_name == "학생 명단" {
        vec![7, 7, 7, 14]
    } else {
        vec![7, 16, 16, 16, 16, 16, 16, 16]
    };
    for (i, width) in widths.iter().enumerate() {
        sheet.push_str(&format!(
            "<col min=\"{}\" max=\"{}\" width=\"{width}\" customWidth=\"1\"/>",
            i + 1,
            i + 1
        ));
    }
    sheet.push_str("</cols><sheetData>");
    for (r, row) in args.rows.iter().enumerate() {
        sheet.push_str(&format!(
            "<row r=\"{}\" ht=\"22\" customHeight=\"1\">",
            r + 1
        ));
        for (c, value) in row.iter().enumerate() {
            sheet.push_str(&format!("<c r=\"{}{}\" t=\"inlineStr\" s=\"{}\"><is><t xml:space=\"preserve\">{}</t></is></c>",column(c),r+1,if r==0{1}else{0},escape(value)));
        }
        sheet.push_str("</row>");
    }
    sheet.push_str("</sheetData></worksheet>");
    let workbook = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
        escape(&args.sheet_name)
    );
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let files = [
        (
            "[Content_Types].xml",
            String::from(
                "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>",
            ),
        ),
        (
            "_rels/.rels",
            String::from(
                "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>",
            ),
        ),
        ("xl/workbook.xml", workbook),
        (
            "xl/_rels/workbook.xml.rels",
            String::from(
                "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>",
            ),
        ),
        (
            "xl/styles.xml",
            String::from(
                "<?xml version=\"1.0\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"맑은 고딕\"/></font><font><b/><sz val=\"11\"/><name val=\"맑은 고딕\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border/></borders><cellStyleXfs count=\"1\"><xf/></cellStyleXfs><cellXfs count=\"2\"><xf fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs></styleSheet>",
            ),
        ),
        ("xl/worksheets/sheet1.xml", sheet),
    ];
    for (name, value) in files {
        zip.start_file(name, options).map_err(|_| invalid())?;
        zip.write_all(value.as_bytes()).map_err(|_| invalid())?;
    }
    Ok(zip.finish().map_err(|_| invalid())?.into_inner())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inline_roster_roundtrips_and_formula_stays_text() {
        let args = SchoolWorkbookOutputArgs {
            sheet_name: "학생 명단".into(),
            rows: vec![
                vec!["학년".into(), "반".into(), "번호".into(), "이름".into()],
                vec!["1".into(), "2".into(), "3".into(), "=합성&<".into()],
            ],
        };
        let input = read(write(&args).unwrap()).unwrap();
        let xml = input.parts.get("xl/worksheets/sheet1.xml").unwrap();
        assert!(xml.contains("t=\"inlineStr\""));
        assert!(xml.contains("=합성&amp;&lt;"));
        assert!(!xml.contains("<f>"));
        assert_eq!(input.photo_count, 0);
    }
    #[test]
    fn zip_traversal_and_dtd_are_rejected() {
        for name in ["../xl/worksheets/sheet1.xml", "xl/worksheets/sheet1.xml"] {
            let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"<!DOCTYPE worksheet><worksheet/>").unwrap();
            assert!(read(zip.finish().unwrap().into_inner()).is_err());
        }
    }
}
