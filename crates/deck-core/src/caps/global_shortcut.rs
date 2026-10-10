// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! global_shortcut capability contracts and pure validation.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
/// ShortcutModifier values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutModifier {
    /// Control choice.
    Control,
    /// Shift choice.
    Shift,
    /// Alt choice.
    Alt,
    /// Meta choice.
    Meta,
}
/// ShortcutRegisterArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutRegisterArgs {
    /// modifiers; opaque handles never expose paths.
    pub modifiers: Vec<ShortcutModifier>,
    /// key; opaque handles never expose paths.
    pub key: String,
}
/// ShortcutInfo contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutInfo {
    /// shortcut handle; opaque handles never expose paths.
    pub shortcut_handle: String,
    /// modifiers; opaque handles never expose paths.
    pub modifiers: Vec<ShortcutModifier>,
    /// key; opaque handles never expose paths.
    pub key: String,
}
/// ShortcutArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutArgs {
    /// shortcut handle; opaque handles never expose paths.
    pub shortcut_handle: String,
}
/// ShortcutReplaceArgs contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutReplaceArgs {
    /// shortcut handle; opaque handles never expose paths.
    pub shortcut_handle: String,
    /// modifiers; opaque handles never expose paths.
    pub modifiers: Vec<ShortcutModifier>,
    /// key; opaque handles never expose paths.
    pub key: String,
}
/// ShortcutTriggeredEvent contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShortcutTriggeredEvent {
    /// shortcut handle; opaque handles never expose paths.
    pub shortcut_handle: String,
}

/// Validates a bounded shortcut without accepting arbitrary native accelerator strings.
pub fn validate_shortcut(
    modifiers: &[ShortcutModifier],
    key: &str,
) -> Result<(), crate::error::DeckError> {
    let named = [
        "Space",
        "Enter",
        "Escape",
        "Tab",
        "Backspace",
        "Delete",
        "Insert",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
    ];
    let letter = key.len() == 1
        && key
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric);
    let function = key
        .strip_prefix('F')
        .and_then(|s| s.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n) && n != 12 && key == format!("F{n}"));
    if modifiers.is_empty()
        || modifiers.len() > 4
        || modifiers
            .iter()
            .enumerate()
            .any(|(i, m)| modifiers.iter().take(i).any(|old| old == m))
        || !(letter || function || named.contains(&key))
    {
        return Err(crate::error::DeckError::new(
            crate::error::ErrorCode::InvalidArgs,
            "단축키 조합을 확인해 주세요.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_empty_duplicate_and_reserved_shortcuts() {
        assert!(validate_shortcut(&[], "C").is_err());
        assert!(
            validate_shortcut(&[ShortcutModifier::Control, ShortcutModifier::Control], "C")
                .is_err()
        );
        assert!(validate_shortcut(&[ShortcutModifier::Control], "F12").is_err());
        assert!(validate_shortcut(&[ShortcutModifier::Alt], "Control+C").is_err());
        assert!(
            validate_shortcut(&[ShortcutModifier::Control, ShortcutModifier::Shift], "C").is_ok()
        );
    }
}
