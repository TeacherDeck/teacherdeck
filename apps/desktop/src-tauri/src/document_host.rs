// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Native and shell boundaries for content-free document protection (ADR-0030).

use crate::origins::MAIN_WINDOW;
use crate::state::AppState;
use deck_core::caps::window::*;
use deck_core::{DeckError, ErrorCode};
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

pub const EXIT_REQUEST_EVENT: &str = "deck://document-exit-request";

pub fn now() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    u64::try_from(START.get_or_init(Instant::now).elapsed().as_millis()).unwrap_or(u64::MAX)
}
pub fn token() -> Result<String, DeckError> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| failure())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn failure() -> DeckError {
    DeckError::new(ErrorCode::Internal, "문서 보호 상태를 확인하지 못했어요.")
}

/// True means the dangerous native operation must stop until the main shell resolves it.
pub fn request_exit(app: &AppHandle, action: DocumentExitAction) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut registry) = state.documents.lock() else {
        return true;
    };
    if !registry.protected() {
        return false;
    }
    // Repeated Alt+F4 while the modal is open must not cancel its current one-use token.
    if registry.exit_pending(now()) {
        return true;
    }
    let Ok(id) = token() else {
        return true;
    };
    let Some(request) = registry.request_exit(action, id, now()) else {
        return false;
    };
    drop(registry);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to(MAIN_WINDOW, EXIT_REQUEST_EVENT, request);
    true
}

/// Existing main-only module_visibility command invokes only these fixed lifecycle actions.
pub fn shell_action(
    app: &AppHandle,
    state: &AppState,
    owner: &str,
    action: DocumentAction,
) -> Result<DocumentActionResult, DeckError> {
    let mut registry = state.documents.lock().map_err(|_| failure())?;
    let empty = DocumentActionResult::default();
    let mut event = None;
    let mut exit = None;
    let result = match action {
        DocumentAction::Status {} => DocumentActionResult {
            state: registry.state(owner),
            ..empty
        },
        DocumentAction::Prepare {} => registry.prepare(owner, token()?, now()),
        DocumentAction::RequestSave { request_id } => {
            event = Some(registry.request_save(owner, &request_id, now())?);
            empty
        }
        DocumentAction::SaveResult { request_id } => {
            registry.save_result(owner, &request_id, now())?
        }
        DocumentAction::CancelSave { request_id } => {
            registry.cancel(owner, &request_id);
            empty
        }
        DocumentAction::Discard {
            document_handle,
            request_id,
        } => {
            registry.discard(owner, &document_handle, &request_id, now())?;
            empty
        }
        DocumentAction::ResolveExit {
            request_id,
            proceed,
        } => {
            exit = registry.resolve_exit(&request_id, proceed, now())?;
            empty
        }
    };
    drop(registry);
    if let Some(payload) = event {
        app.emit_to(
            MAIN_WINDOW,
            "deck://module-event",
            serde_json::json!({
                "moduleId":owner,"topic":"window.documentSaveRequested","payload":payload
            }),
        )
        .map_err(|_| failure())?;
    }
    if let Some(action) = exit {
        match action {
            DocumentExitAction::Close => {
                app.get_webview_window(MAIN_WINDOW)
                    .ok_or_else(failure)?
                    .close()
                    .map_err(|_| failure())?;
            }
            DocumentExitAction::Exit => app.exit(0),
            DocumentExitAction::Restart => app.restart(),
        }
    }
    Ok(result)
}
