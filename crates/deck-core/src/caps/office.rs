// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded installed-Office conversion contract (ADR-0021).
use super::fs::FileHandleInfo;
use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[path = "office_excel.rs"]
mod excel_preflight;
pub use excel_preflight::validate_excel_source;

/// Fixed installed providers. Modules cannot select arbitrary COM classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum OfficeProvider {
    /// Hancom HWP.
    Hancom,
    /// Microsoft Excel.
    Excel,
    /// Microsoft PowerPoint.
    Powerpoint,
    /// Microsoft Word.
    Word,
}
/// Fixed genuine output formats; macro-enabled outputs preserve VBA.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum OfficeFormat {
    /// Hancom XML document.
    Hwpx,
    /// Excel workbook.
    Xlsx,
    /// Excel VBA workbook.
    Xlsm,
    /// PowerPoint presentation.
    Pptx,
    /// PowerPoint VBA presentation.
    Pptm,
    /// Word document.
    Docx,
    /// Word VBA document.
    Docm,
}
impl OfficeFormat {
    /// The fixed output extension.
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Hwpx => "hwpx",
            Self::Xlsx => "xlsx",
            Self::Xlsm => "xlsm",
            Self::Pptx => "pptx",
            Self::Pptm => "pptm",
            Self::Docx => "docx",
            Self::Docm => "docm",
        }
    }
    /// Installed application needed by the format.
    pub const fn provider(self) -> OfficeProvider {
        match self {
            Self::Hwpx => OfficeProvider::Hancom,
            Self::Xlsx | Self::Xlsm => OfficeProvider::Excel,
            Self::Pptx | Self::Pptm => OfficeProvider::Powerpoint,
            Self::Docx | Self::Docm => OfficeProvider::Word,
        }
    }
    /// Whether VBA survives this format.
    pub const fn retains_macros(self) -> bool {
        matches!(self, Self::Xlsm | Self::Pptm | Self::Docm)
    }
}
/// Discovery never launches installed applications.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct OfficeProviderStatus {
    /// Fixed provider.
    pub provider: OfficeProvider,
    /// COM registration exists.
    pub registered: bool,
    /// Conversion is available subject to opening the selected document.
    pub ready: bool,
}
/// All provider statuses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OfficeAvailability {
    /// Installed provider registrations.
    pub providers: Vec<OfficeProviderStatus>,
}
/// Converts one selected source into an existing append-new output batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfficeConvertArgs {
    /// Same-module read-only file handle.
    pub source_handle: String,
    /// Same-module output batch from fs.
    pub batch_id: String,
    /// Fixed real conversion format.
    pub target_format: OfficeFormat,
    /// One filename, with matching extension.
    pub suggested_name: String,
}
/// Completed checks; no claim of pixel-identical rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct OfficeValidation {
    /// Archive signature and mandatory parts checked.
    pub package_valid: bool,
    /// Reopened in the installed provider.
    pub reopened: bool,
    /// Locked original bytes have the same SHA-256.
    pub original_unchanged: bool,
}
/// Non-personal advice for completed conversions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum OfficeWarningCode {
    /// Layout must still be reviewed in the user's application.
    ReviewLayout,
}
/// A published conversion result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct OfficeConvertResult {
    /// Output file handle.
    pub file: FileHandleInfo,
    /// Used application.
    pub provider: OfficeProvider,
    /// Actual format.
    pub target_format: OfficeFormat,
    /// Completed validation.
    pub validation: OfficeValidation,
    /// Safe warning codes.
    pub warnings: Vec<OfficeWarningCode>,
}
/// Cancel only a current conversion owned by the calling module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct OfficeCancelResult {
    /// Cancellation was requested.
    pub requested: bool,
}
/// Validates extension pairs and filename before any application starts.
pub fn validate_conversion(
    args: &OfficeConvertArgs,
    source_extension: &str,
) -> Result<(), DeckError> {
    let accepted = match args.target_format.provider() {
        OfficeProvider::Hancom => matches!(source_extension, "hwp" | "hwpx"),
        OfficeProvider::Excel => matches!(source_extension, "xls" | "xlsx" | "xlsm"),
        OfficeProvider::Powerpoint => matches!(source_extension, "ppt" | "pptx" | "pptm"),
        OfficeProvider::Word => matches!(source_extension, "doc" | "docx" | "docm"),
    };
    let name = &args.suggested_name;
    if !accepted
        || name.len() > 240
        || name.is_empty()
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        || name.ends_with([' ', '.'])
        || !name
            .to_ascii_lowercase()
            .ends_with(&format!(".{}", args.target_format.extension()))
    {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "원본 종류와 변환 형식, 새 파일 이름을 확인해 주세요.",
        ));
    }
    if matches!(source_extension, "xlsm" | "pptm" | "docm") && !args.target_format.retains_macros()
    {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "매크로를 보존하는 변환 형식을 선택해 주세요.",
        ));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_real_pair_and_macro_preservation() {
        let mut a = OfficeConvertArgs {
            source_handle: "opaque".into(),
            batch_id: "batch".into(),
            target_format: OfficeFormat::Xlsx,
            suggested_name: "합성.xlsx".into(),
        };
        assert!(validate_conversion(&a, "xls").is_ok());
        assert!(validate_conversion(&a, "ppt").is_err());
        assert!(validate_conversion(&a, "xlsm").is_err());
        a.target_format = OfficeFormat::Xlsm;
        a.suggested_name = "합성.xlsm".into();
        assert!(validate_conversion(&a, "xlsm").is_ok());
        a.suggested_name = "../합성.xlsm".into();
        assert!(validate_conversion(&a, "xls").is_err());
    }
    #[test]
    fn rejects_unknown_arguments() {
        assert!(serde_json::from_value::<OfficeConvertArgs>(serde_json::json!({"sourceHandle":"x","batchId":"y","targetFormat":"xlsx","suggestedName":"a.xlsx","progId":"arbitrary"})).is_err());
    }
}
