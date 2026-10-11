// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded OOXML metadata inspection; never loads worksheet formulas or executes code.
use super::{rejected, xlm};
use crate::DeckError;
use quick_xml::{XmlVersion, events::Event, name::ResolveResult, reader::NsReader};
use std::collections::{HashMap, HashSet};

const TYPES_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const SHEET_NS: [&str; 2] = [
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "http://purl.oclc.org/ooxml/spreadsheetml/main",
];
const OFFICE_REL: [&str; 2] = [
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
    "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument",
];

struct Element {
    namespace: String,
    name: String,
    attributes: HashMap<String, String>,
}
impl Element {
    fn required(&self, name: &str) -> Result<&str, DeckError> {
        self.attributes
            .get(name)
            .map(String::as_str)
            .ok_or_else(rejected)
    }
}

fn valid_characters(text: &str) -> bool {
    text.chars().all(|c| matches!(c, '\t' | '\r' | '\n' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}'))
}

fn namespace(result: ResolveResult<'_>) -> Result<String, DeckError> {
    match result {
        ResolveResult::Bound(ns) => {
            // NsReader's namespace resolver stores lexical xmlns values. Normalize
            // references with the same library as ordinary XML attribute values.
            let value = ns.as_ref();
            Ok(quick_xml::escape::unescape(value)
                .map_err(|_| rejected())?
                .into_owned())
        }
        ResolveResult::Unbound => Ok(String::new()),
        ResolveResult::Unknown(_) => Err(rejected()),
    }
}

fn inspect(
    bytes: &[u8],
    mut visit: impl FnMut(&Element, &[Element]) -> Result<(), DeckError>,
) -> Result<(), DeckError> {
    let text = std::str::from_utf8(bytes).map_err(|_| rejected())?;
    if !valid_characters(text) {
        return Err(rejected());
    }
    let mut reader = NsReader::from_str(text);
    reader.config_mut().check_comments = true;
    let mut stack = Vec::new();
    let mut roots = 0;
    let mut declaration = false;
    loop {
        match reader.read_event().map_err(|_| rejected())? {
            event @ (Event::Start(_) | Event::Empty(_)) => {
                let empty = matches!(event, Event::Empty(_));
                let start = match event {
                    Event::Start(s) | Event::Empty(s) => s,
                    _ => return Err(rejected()),
                };
                let (ns, local) = reader.resolver().resolve_element(start.name());
                let mut element = Element {
                    namespace: namespace(ns)?,
                    name: local.as_ref().to_owned(),
                    attributes: HashMap::new(),
                };
                let mut expanded = HashSet::new();
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|_| rejected())?;
                    let value = attribute
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|_| rejected())?
                        .into_owned();
                    if !valid_characters(&value) {
                        return Err(rejected());
                    }
                    if attribute.key.as_ref() == "xmlns"
                        || attribute.key.as_ref().starts_with("xmlns:")
                    {
                        continue;
                    }
                    let (ns, local) = reader.resolver().resolve_attribute(attribute.key);
                    let ns = namespace(ns)?;
                    let key = local.as_ref().to_owned();
                    if !expanded.insert((ns.clone(), key.clone())) {
                        return Err(rejected());
                    }
                    if ns.is_empty() {
                        element.attributes.insert(key, value);
                    }
                }
                if stack.is_empty() {
                    roots += 1;
                    if roots != 1 {
                        return Err(rejected());
                    }
                }
                if stack.len() >= 64 {
                    return Err(rejected());
                }
                visit(&element, &stack)?;
                if !empty {
                    stack.push(element);
                }
            }
            Event::End(_) => {
                stack.pop().ok_or_else(rejected)?;
            }
            Event::DocType(_) => return Err(rejected()),
            Event::Decl(decl) => {
                if declaration
                    || roots != 0
                    || decl.version().map_err(|_| rejected())?.as_ref() != "1.0"
                    || decl
                        .encoding()
                        .transpose()
                        .map_err(|_| rejected())?
                        .is_some_and(|s| !s.eq_ignore_ascii_case("utf-8"))
                {
                    return Err(rejected());
                }
                declaration = true;
            }
            Event::GeneralRef(reference) => {
                let reference = reference.as_ref();
                let encoded = format!("&{reference};");
                let value = quick_xml::escape::unescape(&encoded).map_err(|_| rejected())?;
                if !valid_characters(&value) {
                    return Err(rejected());
                }
                if stack.is_empty() {
                    return Err(rejected());
                }
            }
            Event::Text(content) => {
                if stack.is_empty() && !content.as_ref().bytes().all(|c| c.is_ascii_whitespace()) {
                    return Err(rejected());
                }
            }
            Event::CData(_) if stack.is_empty() => return Err(rejected()),
            Event::Eof => break,
            _ => {}
        }
    }
    if roots != 1 || !stack.is_empty() {
        return Err(rejected());
    }
    Ok(())
}

/// Resolve an OPC part URI to an archive name; reject ambiguous/external targets.
pub(super) fn part(target: &str, base: &str) -> Result<String, DeckError> {
    if target.is_empty() || target.starts_with("//") || target.contains(['\\', '?', '#', ':']) {
        return Err(rejected());
    }
    let mut decoded = Vec::new();
    let mut input = target.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let hi = input
                .next()
                .and_then(|c| (c as char).to_digit(16))
                .ok_or_else(rejected)?;
            let lo = input
                .next()
                .and_then(|c| (c as char).to_digit(16))
                .ok_or_else(rejected)?;
            let value = (hi * 16 + lo) as u8;
            if matches!(value, b'/' | b'\\' | b'%' | b'?' | b'#' | b':' | 0) {
                return Err(rejected());
            }
            decoded.push(value);
        } else {
            decoded.push(byte);
        }
    }
    let decoded = String::from_utf8(decoded).map_err(|_| rejected())?;
    if decoded.chars().any(char::is_control) {
        return Err(rejected());
    }
    let mut segments: Vec<&str> = if decoded.starts_with('/') {
        Vec::new()
    } else {
        base.split('/').filter(|s| !s.is_empty()).collect()
    };
    for segment in decoded.trim_start_matches('/').split('/') {
        match segment {
            "" => return Err(rejected()),
            "." => {}
            ".." => {
                segments.pop().ok_or_else(rejected)?;
            }
            _ => segments.push(segment),
        }
    }
    if segments.is_empty() {
        return Err(rejected());
    }
    Ok(segments.join("/").to_ascii_lowercase())
}

#[derive(Debug)]
pub(super) struct ContentTypes {
    pub(super) overrides: HashMap<String, String>,
    defaults: HashMap<String, String>,
}
impl ContentTypes {
    pub(super) fn content_type(&self, name: &str) -> Option<&str> {
        self.overrides.get(name).map(String::as_str).or_else(|| {
            let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
            self.defaults.get(&extension).map(String::as_str)
        })
    }
}

pub(super) fn content_types(bytes: &[u8]) -> Result<ContentTypes, DeckError> {
    let mut overrides = HashMap::new();
    let mut defaults = HashMap::new();
    inspect(bytes, |element, parents| {
        if element.namespace != TYPES_NS {
            return Err(rejected());
        }
        if parents.is_empty() {
            if element.name != "Types" {
                return Err(rejected());
            }
        } else {
            if parents.len() != 1 {
                return Err(rejected());
            }
            let content = element.required("ContentType")?;
            if content.to_ascii_lowercase().contains("macrosheet") {
                return Err(xlm());
            }
            match element.name.as_str() {
                "Override" => {
                    let name = element.required("PartName")?;
                    if !name.starts_with('/')
                        || overrides
                            .insert(part(name, "")?, content.to_owned())
                            .is_some()
                    {
                        return Err(rejected());
                    }
                }
                "Default" => {
                    if defaults
                        .insert(
                            element.required("Extension")?.to_ascii_lowercase(),
                            content.to_owned(),
                        )
                        .is_some()
                    {
                        return Err(rejected());
                    }
                }
                _ => return Err(rejected()),
            }
        }
        Ok(())
    })?;
    Ok(ContentTypes {
        overrides,
        defaults,
    })
}

pub(super) fn relationships(bytes: &[u8], root: bool) -> Result<Option<String>, DeckError> {
    let mut main = None;
    let mut ids = HashSet::new();
    inspect(bytes, |element, parents| {
        if element.namespace != RELS_NS {
            return Err(rejected());
        }
        if parents.is_empty() {
            if element.name != "Relationships" {
                return Err(rejected());
            }
        } else {
            if parents.len() != 1
                || element.name != "Relationship"
                || !ids.insert(element.required("Id")?.to_owned())
            {
                return Err(rejected());
            }
            let kind = element.required("Type")?;
            let target = element.required("Target")?;
            if kind.to_ascii_lowercase().contains("macrosheet") {
                return Err(xlm());
            }
            if root && OFFICE_REL.contains(&kind) {
                if element
                    .attributes
                    .get("TargetMode")
                    .is_some_and(|value| value != "Internal")
                    || main.replace(part(target, "")?).is_some()
                {
                    return Err(rejected());
                }
            } else if element
                .attributes
                .get("TargetMode")
                .is_some_and(|value| value != "External" && value != "Internal")
            {
                return Err(rejected());
            }
        }
        Ok(())
    })?;
    if root && main.is_none() {
        return Err(rejected());
    }
    Ok(main)
}

pub(super) fn workbook(bytes: &[u8]) -> Result<(), DeckError> {
    inspect(bytes, |element, parents| {
        if parents.is_empty()
            && (!SHEET_NS.contains(&element.namespace.as_str()) || element.name != "workbook")
        {
            return Err(rejected());
        }
        if SHEET_NS.contains(&element.namespace.as_str()) && element.name == "definedName" {
            if parents.len() != 2
                || parents
                    .last()
                    .is_none_or(|p| p.name != "definedNames" || p.namespace != element.namespace)
            {
                return Err(rejected());
            }
            let name = element.required("name")?.to_ascii_lowercase();
            if name.is_empty() || name.chars().any(char::is_whitespace) {
                return Err(rejected());
            }
            let name = name.strip_prefix("_xlnm.").unwrap_or(&name);
            if [
                "auto_open",
                "auto_close",
                "auto_activate",
                "auto_deactivate",
            ]
            .contains(&name)
            {
                return Err(xlm());
            }
            for flag in ["xlm", "function", "vbProcedure"] {
                if let Some(value) = element.attributes.get(flag) {
                    match value.as_str() {
                        "true" | "1" => return Err(xlm()),
                        "false" | "0" => {}
                        _ => return Err(rejected()),
                    }
                }
            }
        }
        Ok(())
    })
}

pub(super) fn is_workbook_type(value: &str) -> bool {
    [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
        "application/vnd.ms-excel.sheet.macroEnabled.main+xml",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml",
        "application/vnd.ms-excel.template.macroEnabled.main+xml",
    ]
    .iter()
    .any(|kind| value.eq_ignore_ascii_case(kind))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefixed_and_escaped_namespaces_and_attributes_are_inspected() {
        let namespace = SHEET_NS[0].replace("main", "ma&#105;n");
        for name in [
            "Auto_&#79;pen",
            "_xlnm.Auto_Open",
            "AUTO_CLOSE",
            "Auto_Activate",
            "Auto_Deactivate",
        ] {
            let bytes = format!(
                "<s:workbook xmlns:s='{namespace}'><s:definedNames><s:definedName name='{name}'/></s:definedNames></s:workbook>"
            );
            assert!(
                workbook(bytes.as_bytes())
                    .unwrap_err()
                    .message
                    .contains("4.0")
            );
        }
        for flag in ["xlm", "function", "vbProcedure"] {
            let bytes = format!(
                "<workbook xmlns='{}'><definedNames><definedName name='SyntheticName' {flag}='&#x31;'/></definedNames></workbook>",
                SHEET_NS[0]
            );
            assert!(
                workbook(bytes.as_bytes())
                    .unwrap_err()
                    .message
                    .contains("4.0")
            );
        }
        let normal = format!(
            "<s:workbook xmlns:s='{namespace}'><s:sheets><s:sheet name='AUTO_OPEN' sheetId='1'/></s:sheets><s:definedNames><s:definedName name='Ordinary' xlm='0'>AUTO_OPEN!$A$1</s:definedName></s:definedNames></s:workbook>"
        );
        workbook(normal.as_bytes()).unwrap();
        workbook(normal.replace(&namespace, SHEET_NS[1]).as_bytes()).unwrap();
    }

    #[test]
    fn macro_content_types_and_relationships_are_checked_in_attribute_context() {
        let types = format!(
            "<t:Types xmlns:t='{TYPES_NS}'><t:Override PartName='/custom/sheet.xml' ContentType='application/vnd.ms-excel.intlmacro&#115;heet+xml'/></t:Types>"
        );
        assert!(
            content_types(types.as_bytes())
                .unwrap_err()
                .message
                .contains("4.0")
        );
        let rels = format!(
            "<r:Relationships xmlns:r='{RELS_NS}'><r:Relationship Id='sheet' Type='http://schemas.microsoft.com/office/2006/relationships/xlMacro&#83;heet' Target='custom/sheet.xml'/></r:Relationships>"
        );
        assert!(
            relationships(rels.as_bytes(), false)
                .unwrap_err()
                .message
                .contains("4.0")
        );
        let benign = format!(
            "<Relationships xmlns='{RELS_NS}'><!-- macrosheet is a comment, not a relationship --><Relationship Id='link' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink' TargetMode='External' Target='https://example.invalid/?note=Auto_Open&amp;a=1'/></Relationships>"
        );
        relationships(benign.as_bytes(), false).unwrap();
    }

    #[test]
    fn malformed_xml_dtd_entities_and_ambiguous_attributes_fail_closed() {
        for bytes in [
            format!(
                "<!DOCTYPE workbook [<!ENTITY external SYSTEM 'https://example.invalid/'>]><workbook xmlns='{}'/>",
                SHEET_NS[0]
            ),
            format!("<workbook xmlns='{}'>&external;</workbook>", SHEET_NS[0]),
            format!("<workbook xmlns='{}'><sheets></workbook>", SHEET_NS[0]),
            format!(
                "<workbook xmlns='{}'/><workbook xmlns='{}'/>",
                SHEET_NS[0], SHEET_NS[0]
            ),
            "<p:workbook/>".to_owned(),
            "<workbook xmlns='urn:synthetic:unknown'/>".to_owned(),
            format!(
                "<workbook xmlns='{}'><definedNames><definedName name='Ordinary' name='Auto_Open'/></definedNames></workbook>",
                SHEET_NS[0]
            ),
            format!(
                "<workbook xmlns='{}'><definedNames><definedName name='Ordinary' xlm='invalid'/></definedNames></workbook>",
                SHEET_NS[0]
            ),
            format!(
                "<workbook xmlns='{}'><definedNames><definedName name='Ordinary' unknown:xlm='1'/></definedNames></workbook>",
                SHEET_NS[0]
            ),
        ] {
            assert!(workbook(bytes.as_bytes()).is_err());
        }
        assert!(workbook(&[0xff, 0xfe, 60, 0]).is_err());
        let deep = format!(
            "<workbook xmlns='{}'>{}{}</workbook>",
            SHEET_NS[0],
            "<node>".repeat(64),
            "</node>".repeat(64)
        );
        assert!(workbook(deep.as_bytes()).is_err());
    }

    #[test]
    fn part_resolution_rejects_external_ambiguous_and_out_of_root_uris() {
        assert_eq!(
            part("../actual.xml", "custom/sub").unwrap(),
            "custom/actual.xml"
        );
        assert_eq!(
            part("/custom/my%20book.xml", "").unwrap(),
            "custom/my book.xml"
        );
        for target in [
            "",
            "//external/book.xml",
            "https://example.invalid/book.xml",
            "../book.xml",
            "xl%2fworkbook.xml",
            "xl%5cworkbook.xml",
            "xl/book.xml#fragment",
            "xl/%00book.xml",
            "xl/%zzbook.xml",
        ] {
            assert!(part(target, "").is_err());
        }
    }
}
