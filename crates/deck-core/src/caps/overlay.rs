// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! overlay capability contracts and pure validation.
use super::capture::{CaptureSession, PhysicalRect};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
/// OverlayStyle contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayStyle {
    /// border color; opaque handles never expose paths.
    pub border_color: String,
    /// border width; opaque handles never expose paths.
    pub border_width: u8,
}
/// OverlayInfo contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayInfo {
    /// overlay handle; opaque handles never expose paths.
    pub overlay_handle: String,
    /// rect; opaque handles never expose paths.
    pub rect: PhysicalRect,
    /// style; opaque handles never expose paths.
    pub style: OverlayStyle,
    /// visible; opaque handles never expose paths.
    pub visible: bool,
    /// always on top; opaque handles never expose paths.
    pub always_on_top: bool,
}
/// OverlayCreateArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayCreateArgs {
    /// rect; opaque handles never expose paths.
    pub rect: PhysicalRect,
    /// style; opaque handles never expose paths.
    pub style: OverlayStyle,
    /// always on top; opaque handles never expose paths.
    pub always_on_top: bool,
}
/// OverlayArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayArgs {
    /// overlay handle; opaque handles never expose paths.
    pub overlay_handle: String,
}
/// OverlayUpdateArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayUpdateArgs {
    /// overlay handle; opaque handles never expose paths.
    pub overlay_handle: String,
    /// rect; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub rect: Option<PhysicalRect>,
    /// style; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<OverlayStyle>,
    /// always on top; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub always_on_top: Option<bool>,
}
/// Host-calculated physical layout for the trusted overlay shell only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayUiLayout {
    /// Local physical rectangle including the capture border.
    pub region: PhysicalRect,
    /// Local physical toolbar band, kept inside its monitor.
    pub toolbar: PhysicalRect,
    /// Native scale used to convert local physical coordinates to CSS pixels.
    pub scale: f64,
}
/// OverlayUiState contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayUiState {
    /// Internal shell layout; never changes OverlayInfo or module capture coordinates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub layout: Option<OverlayUiLayout>,
    /// Whether this window displays the separate toolbar.
    pub toolbar: bool,
    /// overlay; opaque handles never expose paths.
    pub overlay: OverlayInfo,
    /// session; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session: Option<CaptureSession>,
}
/// OverlayUiActionArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OverlayUiActionArgs {
    /// action; opaque handles never expose paths.
    pub action: OverlayUiAction,
}
/// OverlayUiAction values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum OverlayUiAction {
    /// Capture choice.
    Capture,
    /// ShowSettings choice.
    ShowSettings,
    /// OpenFolder choice.
    OpenFolder,
    /// ToggleOnTop choice.
    ToggleOnTop,
    /// ToggleVisible choice.
    ToggleVisible,
    /// Stop choice.
    Stop,
}

/// Validates bounded user-selected overlay appearance.
pub fn validate_style(style: &OverlayStyle) -> Result<(), crate::error::DeckError> {
    let color = style.border_color.as_bytes();
    if !(1..=12).contains(&style.border_width)
        || color.len() != 7
        || color.first() != Some(&b'#')
        || !color.iter().skip(1).all(u8::is_ascii_hexdigit)
    {
        return Err(crate::error::DeckError::new(
            crate::error::ErrorCode::InvalidArgs,
            "영역 테두리 설정을 확인해 주세요.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_hex_and_unbounded_overlay_styles() {
        for (color, width) in [
            ("", 2),
            ("#12345", 2),
            ("#zzzzzz", 2),
            ("#123456", 0),
            ("#123456", 13),
        ] {
            assert!(
                validate_style(&OverlayStyle {
                    border_color: color.into(),
                    border_width: width
                })
                .is_err()
            );
        }
        assert!(
            validate_style(&OverlayStyle {
                border_color: "#abcdef".into(),
                border_width: 12
            })
            .is_ok()
        );
    }
}
