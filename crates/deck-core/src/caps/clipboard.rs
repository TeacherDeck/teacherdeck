// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded, escaped output-only clipboard documents (ADR-0016).
use crate::error::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
/// Maximum combined text/output bytes.
pub const MAX_TEXT_BYTES: usize = 256 * 1024;
/// Maximum serialized arguments.
pub const MAX_JSON_BYTES: usize = 512 * 1024;
/// Plain text clipboard arguments.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ClipboardWriteTextArgs {
    /// UTF-8 text, at most 256KiB.
    pub text: String,
}
/// An escaped inline text run.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ClipboardRun {
    /// Text; newlines become line breaks.
    pub text: String,
    /// Emphasize this run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub bold: Option<bool>,
}
/// One rectangular table cell.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ClipboardCell {
    /// Inline runs.
    pub runs: Vec<ClipboardRun>,
    /// Header cell presentation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub header: Option<bool>,
}
/// Nonrecursive structured document blocks. No raw HTML, URLs or styles.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClipboardBlock {
    /// Document heading.
    Heading {
        /// Heading level 1..3.
        level: u8,
        /// Heading text.
        runs: Vec<ClipboardRun>,
    },
    /// Ordinary paragraph.
    Paragraph {
        /// Paragraph text.
        runs: Vec<ClipboardRun>,
    },
    /// Rectangular table.
    Table {
        /// Rows of cells; each row has the same nonzero length.
        rows: Vec<Vec<ClipboardCell>>,
    },
}
/// Rich clipboard output plus a plain text alternative.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipboardWriteRichTextArgs {
    /// Plain text alternative, counted in the combined byte limit.
    pub plain_text: String,
    /// At most 4096 structured blocks.
    pub blocks: Vec<ClipboardBlock>,
}
/// Validated OS-ready rich data, never persisted or logged.
#[derive(Debug)]
pub struct RichOutput {
    /// Escaped fixed-format HTML.
    pub html: String,
    /// Plain text alternative.
    pub plain_text: String,
}
fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "복사할 내용의 형식이나 크기를 확인해 주세요.",
    )
}
fn normalize(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}
fn valid_text(text: &str) -> bool {
    !text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r'))
}
fn json_limit<T: Serialize>(args: &T) -> Result<(), DeckError> {
    if serde_json::to_vec(args).map_or(usize::MAX, |v| v.len()) > MAX_JSON_BYTES {
        return Err(invalid());
    }
    Ok(())
}
/// Validates and normalizes a plain clipboard output.
pub fn prepare_text(args: ClipboardWriteTextArgs) -> Result<String, DeckError> {
    json_limit(&args)?;
    if args.text.len() > MAX_TEXT_BYTES || !valid_text(&args.text) {
        return Err(invalid());
    }
    Ok(normalize(&args.text))
}
#[derive(Default)]
struct Counts {
    bytes: usize,
    runs: usize,
    rows: usize,
    cells: usize,
}
impl Counts {
    fn runs(&mut self, runs: &[ClipboardRun]) -> Result<(), DeckError> {
        if runs.len() > 64 {
            return Err(invalid());
        }
        self.runs += runs.len();
        for run in runs {
            self.bytes += run.text.len();
            if self.bytes > MAX_TEXT_BYTES || self.runs > 32768 || !valid_text(&run.text) {
                return Err(invalid());
            }
        }
        Ok(())
    }
}
struct Html {
    value: String,
    limit: usize,
}
impl Html {
    fn push(&mut self, value: &str) -> Result<(), DeckError> {
        if value.len() > self.limit.saturating_sub(self.value.len()) {
            return Err(invalid());
        }
        self.value.push_str(value);
        Ok(())
    }
    fn runs(&mut self, runs: &[ClipboardRun]) -> Result<(), DeckError> {
        for run in runs {
            if run.bold == Some(true) {
                self.push("<strong>")?;
            }
            for c in normalize(&run.text).chars() {
                match c {
                    '&' => self.push("&amp;")?,
                    '<' => self.push("&lt;")?,
                    '>' => self.push("&gt;")?,
                    '"' => self.push("&quot;")?,
                    '\'' => self.push("&#39;")?,
                    '\n' => self.push("<br>")?,
                    _ => {
                        let mut bytes = [0; 4];
                        self.push(c.encode_utf8(&mut bytes))?;
                    }
                }
            }
            if run.bold == Some(true) {
                self.push("</strong>")?;
            }
        }
        Ok(())
    }
}
/// Validates all blocks before generating fixed, escaped HTML and the plain alternative.
pub fn prepare_rich(args: ClipboardWriteRichTextArgs) -> Result<RichOutput, DeckError> {
    json_limit(&args)?;
    if args.blocks.len() > 4096
        || !valid_text(&args.plain_text)
        || args.plain_text.len() > MAX_TEXT_BYTES
    {
        return Err(invalid());
    }
    let mut counts = Counts {
        bytes: args.plain_text.len(),
        ..Counts::default()
    };
    for block in &args.blocks {
        match block {
            ClipboardBlock::Heading { level, runs } => {
                if !(1..=3).contains(level) {
                    return Err(invalid());
                }
                counts.runs(runs)?;
            }
            ClipboardBlock::Paragraph { runs } => counts.runs(runs)?,
            ClipboardBlock::Table { rows } => {
                let width = rows.first().map_or(0, Vec::len);
                if width == 0 || width > 32 || rows.len() > 4096 {
                    return Err(invalid());
                }
                counts.rows += rows.len();
                for row in rows {
                    if row.len() != width {
                        return Err(invalid());
                    }
                    counts.cells += row.len();
                    for cell in row {
                        counts.runs(&cell.runs)?;
                    }
                }
                if counts.rows > 4096 || counts.cells > 16384 {
                    return Err(invalid());
                }
            }
        }
    }
    let plain_text = normalize(&args.plain_text);
    let mut html = Html {
        value: String::new(),
        limit: MAX_TEXT_BYTES.saturating_sub(plain_text.len()),
    };
    html.push("<div style=\"font-family:'Malgun Gothic','Segoe UI',sans-serif;font-size:11pt;color:#000\">")?;
    for block in &args.blocks {
        match block {
            ClipboardBlock::Heading { level, runs } => {
                html.push(&format!("<h{level}>"))?;
                html.runs(runs)?;
                html.push(&format!("</h{level}>"))?;
            }
            ClipboardBlock::Paragraph { runs } => {
                html.push("<p>")?;
                html.runs(runs)?;
                html.push("</p>")?;
            }
            ClipboardBlock::Table { rows } => {
                html.push("<table style=\"border-collapse:collapse;width:100%\">")?;
                for row in rows {
                    html.push("<tr>")?;
                    for cell in row {
                        let tag = if cell.header == Some(true) {
                            "th"
                        } else {
                            "td"
                        };
                        html.push(&format!("<{tag} style=\"border:1px solid #999;padding:5px 8px;text-align:left\">"))?;
                        html.runs(&cell.runs)?;
                        html.push(&format!("</{tag}>"))?;
                    }
                    html.push("</tr>")?;
                }
                html.push("</table>")?;
            }
        }
    }
    html.push("</div>")?;
    Ok(RichOutput {
        html: html.value,
        plain_text,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn args(value: serde_json::Value) -> ClipboardWriteRichTextArgs {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn escapes_text_and_preserves_structure() {
        let out = prepare_rich(args(serde_json::json!({"plainText":"가상\r\n😀", "blocks":[
            {"kind":"heading","level":1,"runs":[{"text":"<가상 & 제목>"}]},
            {"kind":"table","rows":[[{"header":true,"runs":[{"text":"화자","bold":true}]},{"runs":[{"text":"\"발언\"\r다음'줄"}]}]]}
        ]}))).unwrap();
        assert!(out.html.contains("<h1>&lt;가상 &amp; 제목&gt;</h1>"));
        assert!(out.html.contains("<strong>화자</strong>"));
        assert!(out.html.contains("&quot;발언&quot;<br>다음&#39;줄"));
        assert_eq!(out.plain_text, "가상\n😀");
    }
    #[test]
    fn rejects_unknown_fields_controls_and_bad_tables() {
        assert!(
            serde_json::from_value::<ClipboardWriteTextArgs>(
                serde_json::json!({"text":"x","path":"x"})
            )
            .is_err()
        );
        assert!(prepare_text(ClipboardWriteTextArgs { text: "\0".into() }).is_err());
        for blocks in [
            serde_json::json!([{"kind":"table","rows":[]}]),
            serde_json::json!([{"kind":"heading","level":4,"runs":[]}]),
            serde_json::json!([{"kind":"table","rows":[[ {"runs":[]} ],[]]}]),
        ] {
            assert!(
                prepare_rich(args(serde_json::json!({"plainText":"", "blocks":blocks}))).is_err()
            );
        }
    }
    #[test]
    fn limits_utf8_and_expanded_output_without_truncation() {
        assert!(
            prepare_text(ClipboardWriteTextArgs {
                text: "a".repeat(MAX_TEXT_BYTES)
            })
            .is_ok()
        );
        assert!(
            prepare_text(ClipboardWriteTextArgs {
                text: "가".repeat(MAX_TEXT_BYTES / 3 + 1)
            })
            .is_err()
        );
        assert!(prepare_rich(args(serde_json::json!({"plainText":"", "blocks":[{"kind":"paragraph","runs":[{"text":"&".repeat(MAX_TEXT_BYTES/4)}]}]}))).is_err());
        assert!(prepare_rich(args(serde_json::json!({"plainText":"", "blocks": vec![serde_json::json!({"kind":"paragraph","runs":[]});4097]}))).is_err());
        assert!(prepare_rich(args(serde_json::json!({"plainText":"", "blocks":[{"kind":"paragraph","runs":vec![serde_json::json!({"text":""});65]}]}))).is_err());
    }
}
