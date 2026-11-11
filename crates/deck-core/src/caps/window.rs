// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `window` capability types (capabilities.md §2.3).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Arguments of `setAlwaysOnTop` and `setFullscreen`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct ToggleArgs {
    /// Turn the state on (`true`) or off (`false`).
    pub value: bool,
}

/// Owner-scoped protection reference for one editable document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentRegistration {
    /// Opaque reference, valid until this module unloads.
    pub document_handle: String,
}

/// Registers current unsaved and active-save state; no document content is transmitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentState {
    /// Reference returned by registerDocument.
    pub document_handle: String,
    /// Current revision has not been saved as a complete editable document.
    pub dirty: bool,
    /// An explicit document save is in progress.
    pub saving: bool,
}

/// Host-prepared save request delivered only to its owning module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSaveRequested {
    /// The owner's protected document.
    pub document_handle: String,
    /// One-use request reference.
    pub request_id: String,
}

/// Reports an explicit save result without transmitting private document data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompleteDocumentSaveArgs {
    /// Reference returned by registerDocument.
    pub document_handle: String,
    /// Reference delivered in window.documentSaveRequested.
    pub request_id: String,
    /// True only after the current document revision is completely saved.
    pub saved: bool,
}

/// Fixed native exit operation; only the trusted shell can resolve it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub enum DocumentExitAction {
    /// Ordinary main-window close (capture may instead hide it).
    Close,
    /// Explicit tray exit.
    Exit,
    /// Explicit updater restart.
    Restart,
}

/// Main-only native exit confirmation reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentExitRequest {
    /// One-use native action reference.
    pub request_id: String,
    /// Fixed operation requested by the user.
    pub action: DocumentExitAction,
}

/// Main-only extension of module_visibility; never a module capability method.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DocumentAction {
    /// Read the owner's protection state.
    Status {},
    /// Prepare one bounded leave decision.
    Prepare {},
    /// Deliver one save request for a prepared decision.
    RequestSave {
        /// One-use leave reference from prepare.
        request_id: String,
    },
    /// Read and consume a completed save response.
    SaveResult {
        /// The requested save to inspect.
        request_id: String,
    },
    /// Cancel a prepared decision without clearing dirty state.
    CancelSave {
        /// The prepared decision to cancel.
        request_id: String,
    },
    /// Discard only the prepared owner's document, then unload its iframe.
    Discard {
        /// The exact protected document to discard.
        document_handle: String,
        /// The matching prepared leave reference.
        request_id: String,
    },
    /// Resolve a native exit after all protected documents have been considered.
    ResolveExit {
        /// Host-created native exit reference.
        request_id: String,
        /// Explicit main-shell decision; false preserves the process.
        proceed: bool,
    },
}

/// Main-only protection result. Null saved means the module has not yet answered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentActionResult {
    /// Current document state, or null when no protection is registered.
    pub state: Option<DocumentState>,
    /// Prepared leave reference when applicable.
    pub request_id: Option<String>,
    /// Completed and rechecked save result, or null while waiting.
    pub saved: Option<bool>,
}

/// Window state a module changed, so the host can restore it when the module hides (§2.3).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WindowOverrides {
    /// Original always-on-top state before the module changed it.
    pub always_on_top: Option<bool>,
    /// Original fullscreen state before the module changed it.
    pub fullscreen: Option<bool>,
}

impl WindowOverrides {
    /// Remembers the original value the first time a module changes always-on-top.
    pub fn note_always_on_top(&mut self, original: bool) {
        self.always_on_top.get_or_insert(original);
    }

    /// Remembers the original value the first time a module changes fullscreen.
    pub fn note_fullscreen(&mut self, original: bool) {
        self.fullscreen.get_or_insert(original);
    }

    /// Takes the values to restore, leaving nothing pending.
    pub fn take(&mut self) -> Self {
        std::mem::take(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_first_original_value() {
        let mut o = WindowOverrides::default();
        o.note_always_on_top(false);
        o.note_always_on_top(true);
        o.note_fullscreen(false);
        let restore = o.take();
        assert_eq!(restore.always_on_top, Some(false));
        assert_eq!(restore.fullscreen, Some(false));
        assert_eq!(o, WindowOverrides::default());
    }

    #[test]
    fn document_state_and_main_actions_reject_unknown_or_missing_fields() {
        assert!(
            serde_json::from_str::<DocumentState>(r#"{"documentHandle":"synthetic","dirty":true}"#)
                .is_err()
        );
        assert!(
            serde_json::from_str::<DocumentState>(
                r#"{"documentHandle":"synthetic","dirty":true,"saving":false,"path":"synthetic"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<DocumentAction>(
                r#"{"kind":"discard","documentHandle":"synthetic"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<DocumentAction>(r#"{"kind":"status","content":"synthetic"}"#)
                .is_err()
        );
    }
}
