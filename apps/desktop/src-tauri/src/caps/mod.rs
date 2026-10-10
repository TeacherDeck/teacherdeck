// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Capability handlers. [`route`] maps every registry method to a handler; a test fails if the
//! registry (deck-core `caps::REGISTRY`) lists a method that has no route.
//!
//! Adding a capability: stop and write a proposal first (GEN-005, CAP-005), then follow
//! capabilities.md §3 and apps/desktop/src-tauri/AGENTS.md.

use deck_core::error::{DeckError, ErrorCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tauri::AppHandle;

use crate::state::AppState;

pub mod clipboard;
mod fs;
mod storage;
mod system;
pub mod window;

pub use fs::issue_dropped;
pub use fs::serve_file_resource;

/// Handler selected for a `(cap, method)` pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Route {
    /// `clipboard.*`
    Clipboard(clipboard::Op),
    /// Native capture sessions.
    Capture,
    /// Trusted overlay windows.
    Overlay,
    /// OS shortcut registration.
    Shortcut,
    /// `system.info`
    SystemInfo,
    /// `storage.*`
    Storage(storage::Op),
    /// `fs.*`
    Fs(fs::Op),
    /// `window.*`
    Window(window::Op),
}

/// Finds the handler for a registry method.
pub fn route(cap: &str, method: &str) -> Option<Route> {
    deck_core::caps::method(cap, method)?;
    Some(match (cap, method) {
        ("capture", _) => Route::Capture,
        ("overlay", _) => Route::Overlay,
        ("global-shortcut", _) => Route::Shortcut,
        ("clipboard", m) => Route::Clipboard(clipboard::Op::parse(m)?),
        ("system", "info") => Route::SystemInfo,
        ("storage", m) => Route::Storage(storage::Op::parse(m)?),
        ("fs", m) => Route::Fs(fs::Op::parse(m)?),
        ("window", m) => Route::Window(window::Op::parse(m)?),
        _ => return None,
    })
}

/// Parses method arguments; `null` counts as `{}`. Bad shapes are `INVALID_ARGS`.
pub fn parse_args<T: DeserializeOwned>(args: Value) -> Result<T, DeckError> {
    let args = if args.is_null() {
        Value::Object(serde_json::Map::new())
    } else {
        args
    };
    serde_json::from_value(args)
        .map_err(|_| DeckError::new(ErrorCode::InvalidArgs, "인자 형식이 올바르지 않아요."))
}

/// Serializes a handler result.
pub fn to_value<T: serde::Serialize>(v: &T) -> Result<Value, DeckError> {
    serde_json::to_value(v).map_err(|_| internal())
}

/// Generic internal error (details go to the log as codes only, PRV-003).
pub fn internal() -> DeckError {
    DeckError::new(ErrorCode::Internal, "내부 오류가 발생했어요.")
}

/// Runs an authorized request.
pub async fn dispatch(
    app: &AppHandle,
    state: &AppState,
    module_id: &str,
    cap: &str,
    method: &str,
    args: Value,
) -> Result<Value, DeckError> {
    match route(cap, method) {
        Some(Route::Capture) => {
            crate::capture_host::capture_call(app, module_id, method, args).await
        }
        Some(Route::Overlay) => crate::capture_host::overlay_call(app, module_id, method, args),
        Some(Route::Shortcut) => crate::capture_host::shortcut_call(app, module_id, method, args),
        Some(Route::Clipboard(op)) => clipboard::call(app, op, args).await,
        Some(Route::SystemInfo) => system::info(state, args),
        Some(Route::Storage(op)) => storage::call(state, module_id, op, args),
        Some(Route::Fs(op)) => fs::call(app, state, module_id, op, args).await,
        Some(Route::Window(op)) => window::call(app, state, module_id, op, args),
        None => Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "이 앱에는 없는 기능이에요.",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_registry_method_has_a_route() {
        for cap in deck_core::caps::REGISTRY {
            for m in cap.methods {
                assert!(
                    route(cap.name, m.name).is_some(),
                    "{}.{} has no handler",
                    cap.name,
                    m.name
                );
            }
        }
        assert_eq!(route("storage", "drop"), None);
    }

    #[test]
    fn null_args_mean_empty_object() {
        let a: deck_core::caps::NoArgs = parse_args(Value::Null).unwrap();
        assert_eq!(a, deck_core::caps::NoArgs {});
        let bad: Result<deck_core::caps::NoArgs, _> = parse_args(serde_json::json!({"x": 1}));
        assert_eq!(bad.map_err(|e| e.code), Err(ErrorCode::InvalidArgs));
    }
}
