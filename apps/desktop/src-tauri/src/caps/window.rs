// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `window` capability (capabilities.md §2.3). The first change a module makes records the
//! original state; [`restore`] puts it back when the module hides or unloads.

use deck_core::caps::window::{
    CompleteDocumentSaveArgs, DocumentState, ToggleArgs, WindowOverrides,
};
use deck_core::error::DeckError;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{internal, parse_args};
use crate::origins::MAIN_WINDOW;
use crate::state::AppState;

/// window methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Register an owner-scoped editable document.
    RegisterDocument,
    /// Publish unsaved and saving state.
    SetDocumentState,
    /// Complete only a host-requested document save.
    CompleteDocumentSave,
    /// Enumerate owner-scoped display choices.
    ListDisplays,
    /// Open a public-only local window.
    OpenPresentation,
    /// Update an owned public result.
    UpdatePresentation,
    /// Close an owned public window.
    ClosePresentation,
    /// `setAlwaysOnTop`
    AlwaysOnTop,
    /// `setFullscreen`
    Fullscreen,
}

impl Op {
    /// Maps a method name.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "registerDocument" => Self::RegisterDocument,
            "setDocumentState" => Self::SetDocumentState,
            "completeDocumentSave" => Self::CompleteDocumentSave,
            "listDisplays" => Self::ListDisplays,
            "openPresentation" => Self::OpenPresentation,
            "updatePresentation" => Self::UpdatePresentation,
            "closePresentation" => Self::ClosePresentation,
            "setAlwaysOnTop" => Self::AlwaysOnTop,
            "setFullscreen" => Self::Fullscreen,
            _ => return None,
        })
    }
}

/// Runs a window method.
pub fn call(
    app: &AppHandle,
    state: &AppState,
    module_id: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    match op {
        Op::RegisterDocument => {
            let _: deck_core::caps::NoArgs = parse_args(args)?;
            let result = state
                .documents
                .lock()
                .map_err(|_| internal())?
                .register(module_id, crate::document_host::token()?);
            return super::to_value(&result);
        }
        Op::SetDocumentState => {
            let args: DocumentState = parse_args(args)?;
            state
                .documents
                .lock()
                .map_err(|_| internal())?
                .update(module_id, args)?;
            return Ok(Value::Null);
        }
        Op::CompleteDocumentSave => {
            let args: CompleteDocumentSaveArgs = parse_args(args)?;
            state.documents.lock().map_err(|_| internal())?.complete(
                module_id,
                args,
                crate::document_host::now(),
            )?;
            return Ok(Value::Null);
        }
        Op::ListDisplays => {
            let _: deck_core::caps::NoArgs = parse_args(args)?;
            return super::to_value(&crate::presentation_host::list_displays(app, module_id)?);
        }
        Op::OpenPresentation => {
            return super::to_value(&crate::presentation_host::open(
                app,
                module_id,
                parse_args(args)?,
            )?);
        }
        Op::UpdatePresentation => {
            return super::to_value(&crate::presentation_host::update(
                app,
                module_id,
                parse_args(args)?,
            )?);
        }
        Op::ClosePresentation => {
            crate::presentation_host::close(app, module_id, parse_args(args)?)?;
            return Ok(Value::Null);
        }
        Op::AlwaysOnTop | Op::Fullscreen => {}
    }
    let ToggleArgs { value } = parse_args(args)?;
    let window = app.get_webview_window(MAIN_WINDOW).ok_or_else(internal)?;
    let mut overrides = state.overrides.lock().map_err(|_| internal())?;
    let entry = overrides.entry(module_id.to_owned()).or_default();
    match op {
        Op::AlwaysOnTop => {
            entry.note_always_on_top(window.is_always_on_top().unwrap_or(false));
            window.set_always_on_top(value).map_err(|_| internal())?;
        }
        Op::Fullscreen => {
            entry.note_fullscreen(window.is_fullscreen().unwrap_or(false));
            window.set_fullscreen(value).map_err(|_| internal())?;
        }
        _ => return Err(internal()),
    }
    Ok(Value::Null)
}

/// Restores whatever `module_id` changed. Safe to call repeatedly.
pub fn restore(app: &AppHandle, state: &AppState, module_id: &str) {
    let pending = match state.overrides.lock() {
        Ok(mut map) => map.get_mut(module_id).map(WindowOverrides::take),
        Err(_) => None,
    };
    let (Some(pending), Some(window)) = (pending, app.get_webview_window(MAIN_WINDOW)) else {
        return;
    };
    if let Some(v) = pending.always_on_top {
        let _ = window.set_always_on_top(v);
    }
    if let Some(v) = pending.fullscreen {
        let _ = window.set_fullscreen(v);
    }
}
