// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! capture capability contracts and pure validation.
use super::fs::FileHandleInfo;
use crate::error::DeckError;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
/// PhysicalRect contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhysicalRect {
    /// x; opaque handles never expose paths.
    pub x: i32,
    /// y; opaque handles never expose paths.
    pub y: i32,
    /// width; opaque handles never expose paths.
    pub width: u32,
    /// height; opaque handles never expose paths.
    pub height: u32,
}
/// DisplayInfo contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayInfo {
    /// display handle; opaque handles never expose paths.
    pub display_handle: String,
    /// bounds; opaque handles never expose paths.
    pub bounds: PhysicalRect,
    /// scale; opaque handles never expose paths.
    pub scale: f64,
    /// primary; opaque handles never expose paths.
    pub primary: bool,
}
/// CaptureNaming contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureNaming {
    /// mode; opaque handles never expose paths.
    pub mode: CaptureNamingMode,
    /// prefix; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub prefix: Option<String>,
}
/// CaptureSettings contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureSettings {
    /// format; opaque handles never expose paths.
    pub format: CaptureFormat,
    /// quality; opaque handles never expose paths.
    pub quality: u8,
    /// naming; opaque handles never expose paths.
    pub naming: CaptureNaming,
    /// cursor; opaque handles never expose paths.
    pub cursor: bool,
}
/// CaptureArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureArgs {
    /// rect; opaque handles never expose paths.
    pub rect: PhysicalRect,
    /// settings; opaque handles never expose paths.
    pub settings: CaptureSettings,
}
/// CaptureResult contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureResult {
    /// file; opaque handles never expose paths.
    pub file: FileHandleInfo,
    /// width; opaque handles never expose paths.
    pub width: u32,
    /// height; opaque handles never expose paths.
    pub height: u32,
    /// sequence; opaque handles never expose paths.
    pub sequence: u32,
}
/// CaptureArmArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureArmArgs {
    /// overlay handle; opaque handles never expose paths.
    pub overlay_handle: String,
    /// shortcut handle; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shortcut_handle: Option<String>,
    /// destination grant; opaque handles never expose paths.
    pub destination_grant: String,
    /// settings; opaque handles never expose paths.
    pub settings: CaptureSettings,
}
/// CaptureSession contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureSession {
    /// session handle; opaque handles never expose paths.
    pub session_handle: String,
    /// overlay handle; opaque handles never expose paths.
    pub overlay_handle: String,
    /// destination grant; opaque handles never expose paths.
    pub destination_grant: String,
    /// shortcut handle; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shortcut_handle: Option<String>,
    /// settings; opaque handles never expose paths.
    pub settings: CaptureSettings,
    /// sequence; opaque handles never expose paths.
    pub sequence: u32,
    /// busy; opaque handles never expose paths.
    pub busy: bool,
    /// last result; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_result: Option<CaptureResult>,
    /// last error; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_error: Option<DeckError>,
}
/// CaptureStatusArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureStatusArgs {
    /// session handle; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_handle: Option<String>,
}
/// CaptureSessionArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureSessionArgs {
    /// session handle; opaque handles never expose paths.
    pub session_handle: String,
}
/// CaptureUpdateArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureUpdateArgs {
    /// session handle; opaque handles never expose paths.
    pub session_handle: String,
    /// settings; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub settings: Option<CaptureSettings>,
    /// destination grant; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub destination_grant: Option<String>,
    /// shortcut handle; opaque handles never expose paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub shortcut_handle: Option<String>,
}
/// CaptureCompletedEvent contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureCompletedEvent {
    /// session handle; opaque handles never expose paths.
    pub session_handle: String,
    /// result; opaque handles never expose paths.
    pub result: CaptureResult,
}
/// CaptureFailedEvent contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaptureFailedEvent {
    /// session handle; opaque handles never expose paths.
    pub session_handle: String,
    /// error; opaque handles never expose paths.
    pub error: DeckError,
}
/// CaptureFormat values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureFormat {
    /// Png choice.
    Png,
    /// Jpeg choice.
    Jpeg,
}
/// CaptureNamingMode values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureNamingMode {
    /// Numbered choice.
    Numbered,
    /// Datetime choice.
    Datetime,
    /// Custom choice.
    Custom,
}

/// Maximum selected pixels; each raw RGBA buffer is bounded to 128MiB.
pub const MAX_PIXELS: u64 = 32 * 1024 * 1024;
/// Maximum axis, limiting GDI signed arithmetic before dependency calls.
pub const MAX_AXIS: u32 = 16384;
fn invalid() -> DeckError {
    DeckError::new(
        crate::error::ErrorCode::InvalidArgs,
        "캡처 영역이나 저장 설정을 확인해 주세요.",
    )
}
/// Validates physical bounds with no DPI scaling or signed overflow.
pub fn validate_rect(rect: &PhysicalRect) -> Result<usize, DeckError> {
    if rect.width < 5 || rect.height < 5 || rect.width > MAX_AXIS || rect.height > MAX_AXIS {
        return Err(invalid());
    }
    let pixels = u64::from(rect.width)
        .checked_mul(u64::from(rect.height))
        .ok_or_else(invalid)?;
    if pixels > MAX_PIXELS {
        return Err(invalid());
    }
    rect.x
        .checked_add(i32::try_from(rect.width).map_err(|_| invalid())?)
        .ok_or_else(invalid)?;
    rect.y
        .checked_add(i32::try_from(rect.height).map_err(|_| invalid())?)
        .ok_or_else(invalid)?;
    usize::try_from(pixels.checked_mul(4).ok_or_else(invalid)?).map_err(|_| invalid())
}
/// Physical intersection, including negative virtual desktop positions.
pub fn intersection(a: &PhysicalRect, b: &PhysicalRect) -> Option<PhysicalRect> {
    let x = i64::from(a.x).max(i64::from(b.x));
    let y = i64::from(a.y).max(i64::from(b.y));
    let right = (i64::from(a.x) + i64::from(a.width)).min(i64::from(b.x) + i64::from(b.width));
    let bottom = (i64::from(a.y) + i64::from(a.height)).min(i64::from(b.y) + i64::from(b.height));
    if right <= x || bottom <= y {
        return None;
    }
    Some(PhysicalRect {
        x: i32::try_from(x).ok()?,
        y: i32::try_from(y).ok()?,
        width: u32::try_from(right - x).ok()?,
        height: u32::try_from(bottom - y).ok()?,
    })
}
/// Validates a single filename prefix without silently changing the user's choice.
pub fn validate_settings(settings: &CaptureSettings) -> Result<(), DeckError> {
    if settings.cursor || !(1..=100).contains(&settings.quality) {
        return Err(invalid());
    }
    if settings.naming.mode == CaptureNamingMode::Custom {
        let prefix = settings.naming.prefix.as_deref().ok_or_else(invalid)?;
        if prefix.is_empty()
            || prefix.chars().count() > 80
            || prefix.ends_with(['.', ' '])
            || prefix
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        {
            return Err(invalid());
        }
        let upper = prefix.split('.').next().unwrap_or("").to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL", "CLOCK$", "CONIN$", "CONOUT$"].contains(&upper.as_str())
            || (upper.len() == 4
                && (upper.starts_with("COM") || upper.starts_with("LPT"))
                && upper.as_bytes().get(3).is_some_and(u8::is_ascii_digit))
        {
            return Err(invalid());
        }
    }
    Ok(())
}
/// Calendar clock supplied by the host (local timezone), never parsed from module input.
#[derive(Debug, Clone, Copy)]
pub struct CaptureClock {
    /// Full year.
    pub year: u16,
    /// Month 1..12.
    pub month: u8,
    /// Day 1..31.
    pub day: u8,
    /// Hour 0..23.
    pub hour: u8,
    /// Minute 0..59.
    pub minute: u8,
    /// Second 0..59.
    pub second: u8,
}
/// Generates one safe candidate; the host must atomically publish without overwrite.
pub fn output_filename(
    settings: &CaptureSettings,
    clock: CaptureClock,
    sequence: u32,
    collision: u32,
) -> Result<String, DeckError> {
    validate_settings(settings)?;
    if sequence == 0
        || !(1..=12).contains(&clock.month)
        || !(1..=31).contains(&clock.day)
        || clock.hour > 23
        || clock.minute > 59
        || clock.second > 59
    {
        return Err(invalid());
    }
    let stem = match settings.naming.mode {
        CaptureNamingMode::Numbered => format!(
            "image_{sequence:03}_{:02}{:02}{:02}",
            clock.hour, clock.minute, clock.second
        ),
        CaptureNamingMode::Datetime => format!(
            "capture_{:02}{:02}{:02}_{:02}{:02}{:02}",
            clock.year % 100,
            clock.month,
            clock.day,
            clock.hour,
            clock.minute,
            clock.second
        ),
        CaptureNamingMode::Custom => format!(
            "{}_{sequence:04}",
            settings.naming.prefix.as_deref().ok_or_else(invalid)?
        ),
    };
    let suffix = if collision == 0 {
        String::new()
    } else {
        format!("({collision})")
    };
    Ok(format!(
        "{stem}{suffix}.{}",
        match settings.format {
            CaptureFormat::Png => "png",
            CaptureFormat::Jpeg => "jpg",
        }
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn settings(prefix: &str) -> CaptureSettings {
        CaptureSettings {
            format: CaptureFormat::Png,
            quality: 95,
            naming: CaptureNaming {
                mode: CaptureNamingMode::Custom,
                prefix: Some(prefix.into()),
            },
            cursor: false,
        }
    }
    #[test]
    fn negative_origin_and_cross_monitor_intersections_are_physical() {
        let a = PhysicalRect {
            x: -100,
            y: 20,
            width: 200,
            height: 100,
        };
        let left = PhysicalRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let right = PhysicalRect {
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
        };
        assert_eq!(intersection(&a, &left).unwrap().width, 100);
        assert_eq!(intersection(&a, &right).unwrap().x, 0);
        assert_eq!(validate_rect(&a).unwrap(), 80000);
    }
    #[test]
    fn oversized_and_overflow_rectangles_are_rejected() {
        for a in [
            PhysicalRect {
                x: i32::MAX,
                y: 0,
                width: 5,
                height: 5,
            },
            PhysicalRect {
                x: 0,
                y: 0,
                width: MAX_AXIS,
                height: MAX_AXIS,
            },
            PhysicalRect {
                x: 0,
                y: 0,
                width: 4,
                height: 10,
            },
        ] {
            assert!(validate_rect(&a).is_err());
        }
    }
    #[test]
    fn unsafe_names_and_cursor_are_rejected() {
        for prefix in [
            "", "../x", "CON", "nul.txt", "COM1", "tail.", "tail ", "a:b", "a\n",
        ] {
            assert!(validate_settings(&settings(prefix)).is_err(), "{prefix}");
        }
        assert!(validate_settings(&settings("가상 자료")).is_ok());
        let mut s = settings("safe");
        s.cursor = true;
        assert!(validate_settings(&s).is_err());
    }
    #[test]
    fn filenames_preserve_modes_and_collision_suffix() {
        let clock = CaptureClock {
            year: 2026,
            month: 10,
            day: 10,
            hour: 9,
            minute: 8,
            second: 7,
        };
        assert_eq!(
            output_filename(&settings("가상"), clock, 2, 1).unwrap(),
            "가상_0002(1).png"
        );
        let mut s = settings("safe");
        s.naming.mode = CaptureNamingMode::Numbered;
        assert_eq!(
            output_filename(&s, clock, 1, 0).unwrap(),
            "image_001_090807.png"
        );
        s.naming.mode = CaptureNamingMode::Datetime;
        s.format = CaptureFormat::Jpeg;
        assert_eq!(
            output_filename(&s, clock, 1, 0).unwrap(),
            "capture_261010_090807.jpg"
        );
    }
    #[test]
    fn unknown_paths_cannot_be_injected() {
        assert!(
            serde_json::from_value::<PhysicalRect>(
                serde_json::json!({"x":0,"y":0,"width":10,"height":10,"path":"secret"})
            )
            .is_err()
        );
    }
}
