// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Strict public-only local presentation models (ADR-0025).

use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// Whitelisted classroom result layouts, without teacher conditions or notes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum PresentationKind {
    /// A confirmed seat arrangement viewed from the students' side.
    Seats,
    /// Selected presenter names only.
    Picker,
    /// Group labels and members only.
    Groups,
    /// Assigned role labels and members only.
    Roles,
}

/// One public display item. Private roster metadata is deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationItem {
    /// Public name/number, or empty text for an empty seat.
    pub label: String,
    /// Public group or role name.
    pub group: Option<String>,
    /// Zero-based row for a seat.
    pub row: Option<u16>,
    /// Zero-based column for a seat.
    pub column: Option<u16>,
}

/// Public data only; never arbitrary markup, URLs, or executable content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationPayload {
    /// Result layout.
    pub kind: PresentationKind,
    /// Teacher-chosen public heading.
    pub title: String,
    /// Number of seat columns, absent for other layouts.
    pub columns: Option<u16>,
    /// Bounded public results.
    pub items: Vec<PresentationItem>,
}

/// Display description; coordinates and native display names stay in the host.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationDisplay {
    /// Owner-scoped opaque display handle.
    pub display_handle: String,
    /// Localized display number and dimensions.
    pub label: String,
    /// Whether this is the operating system's primary display.
    pub primary: bool,
    /// Physical pixel width.
    pub width: u32,
    /// Physical pixel height.
    pub height: u32,
    /// Current OS scale factor.
    pub scale_factor: f64,
}

/// Opens a selected display with an explicit public snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenPresentationArgs {
    /// An owner-scoped handle issued by listDisplays.
    pub display_handle: String,
    /// Public data, validated before any window opens.
    pub payload: PresentationPayload,
}

/// Revision and owner-scoped reference of a public window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationSession {
    /// Owner-scoped opaque session handle.
    pub presentation_handle: String,
    /// Last accepted public result revision.
    pub revision: u32,
}

/// Explicitly publishes a newer public result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePresentationArgs {
    /// Owner-scoped session handle.
    pub presentation_handle: String,
    /// Strictly greater than the last accepted revision.
    pub revision: u32,
    /// New public data.
    pub payload: PresentationPayload,
}

/// Closes only the calling module's public window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClosePresentationArgs {
    /// Owner-scoped session handle.
    pub presentation_handle: String,
}

/// Trusted presentation shell state, with no private teacher data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationViewState {
    /// None after monitor configuration changes.
    pub payload: Option<PresentationPayload>,
    /// Last accepted revision.
    pub revision: u32,
    /// Requires a new monitor selection by the teacher.
    pub disconnected: bool,
}

fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "학생 화면에 표시할 자료를 확인해 주세요.",
    )
}

fn valid_text(value: &str, empty: bool) -> bool {
    (empty || !value.trim().is_empty())
        && value.chars().count() <= 120
        && !value.chars().any(char::is_control)
}

impl PresentationPayload {
    /// Validates size, layout consistency and a closed public-field schema.
    pub fn validate(&self) -> Result<(), DeckError> {
        if !valid_text(&self.title, false) || self.items.is_empty() || self.items.len() > 1_000 {
            return Err(invalid());
        }
        let seats = self.kind == PresentationKind::Seats;
        if seats != self.columns.is_some()
            || self
                .columns
                .is_some_and(|columns| !(1..=100).contains(&columns))
        {
            return Err(invalid());
        }
        let mut positions = HashSet::new();
        for item in &self.items {
            if !valid_text(&item.label, seats) {
                return Err(invalid());
            }
            match self.kind {
                PresentationKind::Seats => {
                    let (Some(row), Some(column), Some(columns)) =
                        (item.row, item.column, self.columns)
                    else {
                        return Err(invalid());
                    };
                    if row >= 100
                        || column >= columns
                        || item.group.is_some()
                        || !positions.insert((row, column))
                    {
                        return Err(invalid());
                    }
                }
                PresentationKind::Picker => {
                    if item.group.is_some() || item.row.is_some() || item.column.is_some() {
                        return Err(invalid());
                    }
                }
                PresentationKind::Groups | PresentationKind::Roles => {
                    if !item
                        .group
                        .as_deref()
                        .is_some_and(|group| valid_text(group, false))
                        || item.row.is_some()
                        || item.column.is_some()
                    {
                        return Err(invalid());
                    }
                }
            }
        }
        if serde_json::to_vec(self).map_err(|_| invalid())?.len() > 512 * 1_024 {
            return Err(invalid());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picker() -> PresentationPayload {
        PresentationPayload {
            kind: PresentationKind::Picker,
            title: "발표자".into(),
            columns: None,
            items: vec![PresentationItem {
                label: "1 학생가".into(),
                group: None,
                row: None,
                column: None,
            }],
        }
    }

    #[test]
    fn public_only_schema_rejects_private_or_executable_fields() {
        let mut value = serde_json::to_value(picker()).expect("synthetic payload");
        value["notes"] = "private synthetic note".into();
        assert!(serde_json::from_value::<PresentationPayload>(value).is_err());
        assert!(picker().validate().is_ok());
    }

    #[test]
    fn rejects_layout_confusion_and_duplicate_seats() {
        let mut payload = picker();
        payload.items[0].group = Some("교사 조건".into());
        assert!(payload.validate().is_err());
        payload.kind = PresentationKind::Seats;
        payload.columns = Some(2);
        payload.items[0] = PresentationItem {
            label: "".into(),
            group: None,
            row: Some(0),
            column: Some(1),
        };
        assert!(payload.validate().is_ok());
        payload.items.push(payload.items[0].clone());
        assert!(payload.validate().is_err());
    }

    #[test]
    fn rejects_overlarge_and_control_text_and_accepts_a_thousand() {
        let mut payload = picker();
        payload.items = vec![payload.items[0].clone(); 1_000];
        assert!(payload.validate().is_ok());
        payload.items.push(payload.items[0].clone());
        assert!(payload.validate().is_err());
        payload = picker();
        payload.title = "x".repeat(121);
        assert!(payload.validate().is_err());
        payload.title = "x\n".into();
        assert!(payload.validate().is_err());
    }
}
