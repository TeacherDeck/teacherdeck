// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `host_invoke`: the only IPC entry for module requests (bridge-protocol.md, CAP-008).
//!
//! The shell identifies the module by its iframe (BRG-001) and forwards `req` here. Every call is
//! re-authorized in Rust, whatever the shell checked: the cap and method exist, the module is
//! runnable, it declared the cap (MOD-006) and this host satisfies the declared range.

use deck_core::caps::{self, HostCaps};
use deck_core::error::{DeckError, ErrorCode};
use semver::VersionReq;
use serde_json::Value;
use tauri::{AppHandle, State, Webview};

use crate::caps::dispatch;
use crate::modules::ModuleStore;
use crate::origins::MAIN_WINDOW;
use crate::state::AppState;

/// Maximum serialized argument size (BRG-007).
pub const MAX_ARGS_BYTES: usize = 1024 * 1024;

/// Checks whether `module_id` may call `cap.method` (CAP-008). Pure; unit-tested below.
pub fn authorize(
    store: &ModuleStore,
    host: &HostCaps,
    module_id: &str,
    cap: &str,
    method: &str,
) -> Result<(), DeckError> {
    if caps::method(cap, method).is_none() {
        return Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "이 앱에는 없는 기능이에요.",
        ));
    }
    let module = store
        .runnable(module_id)
        .ok_or_else(|| DeckError::new(ErrorCode::PermissionDenied, "실행 중인 모듈이 아니에요."))?;
    let range = module.declared_range(cap).ok_or_else(|| {
        DeckError::new(
            ErrorCode::PermissionDenied,
            "[MOD-006] module.json의 requires·optional에 선언하지 않은 캡이에요.",
        )
    })?;
    let satisfied = matches!(
        (VersionReq::parse(range), host.get(cap)),
        (Ok(req), Some(v)) if req.matches(v)
    );
    if !satisfied {
        return Err(DeckError::new(
            ErrorCode::VersionMismatch,
            "이 앱의 캡 버전이 모듈이 선언한 범위와 맞지 않아요.",
        ));
    }
    Ok(())
}

/// Forwards one module request. Only the main window may call this (capabilities/main.json).
#[tauri::command]
pub async fn host_invoke(
    app: AppHandle,
    webview: Webview,
    state: State<'_, AppState>,
    module_id: String,
    cap: String,
    method: String,
    args: Value,
) -> Result<Value, DeckError> {
    if webview.label() != MAIN_WINDOW {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "허용되지 않은 창이에요.",
        ));
    }
    if serde_json::to_vec(&args).map_or(usize::MAX, |b| b.len()) > MAX_ARGS_BYTES {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "요청이 1MB를 넘어요.",
        ));
    }
    {
        let store = state
            .modules
            .read()
            .map_err(|_| DeckError::new(ErrorCode::Internal, "내부 오류가 발생했어요."))?;
        authorize(&store, &state.host_caps, &module_id, &cap, &method)?;
    }
    let result = dispatch(&app, &state, &module_id, &cap, &method, args).await;
    match &result {
        Ok(_) => tracing::debug!(module = %module_id, %cap, %method, "invoke ok"),
        // PRV-003: ids and codes only.
        Err(e) => {
            tracing::info!(module = %module_id, %cap, %method, code = ?e.code, "invoke failed")
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::package_file_name;
    use deck_core::catalog::CatalogIndex;
    use deck_core::package::build_package;

    fn store_with(requires: &str, optional: &str) -> ModuleStore {
        let manifest = format!(
            r#"{{"manifestVersion":1,"id":"sample-tool","name":"샘플","description":"테스트",
            "version":"0.1.0","category":"utility","icon":"icon.svg","entry":"index.html",
            "authors":[{{"name":"홍길동"}}],"requires":{requires},"optional":{optional}}}"#
        );
        let files = vec![
            ("module.json".to_owned(), manifest.into_bytes()),
            ("index.html".to_owned(), b"<!doctype html>".to_vec()),
            ("icon.svg".to_owned(), b"<svg/>".to_vec()),
        ];
        let (bytes, pkg) = build_package(&files).unwrap();
        let index = serde_json::json!({
            "format": 1, "seq": 1, "generatedAt": "2026-01-01T00:00:00Z",
            "modules": { "sample-tool": [{
                "version": "0.1.0",
                "requires": pkg.manifest.requires, "optional": pkg.manifest.optional,
                "sha256": pkg.sha256, "size": bytes.len(),
                "url": "sample-tool/0.1.0/", "revoked": false
            }]}
        });
        let index = CatalogIndex::parse(&index.to_string()).unwrap();
        assert_eq!(
            package_file_name("sample-tool", "0.1.0"),
            "sample-tool-0.1.0.deckmod"
        );
        ModuleStore::from_index(&index, &caps::host_caps(), |_, _| Some(bytes.clone()))
    }

    fn code(r: Result<(), DeckError>) -> Option<ErrorCode> {
        r.err().map(|e| e.code)
    }

    #[test]
    fn allows_declared_satisfied_caps() {
        let s = store_with(r#"{"storage":"^1.0"}"#, r#"{"window":"^1.0"}"#);
        let host = caps::host_caps();
        assert_eq!(
            code(authorize(&s, &host, "sample-tool", "storage", "get")),
            None
        );
        assert_eq!(
            code(authorize(
                &s,
                &host,
                "sample-tool",
                "window",
                "setFullscreen"
            )),
            None
        );
    }

    #[test]
    fn denies_undeclared_caps_and_unknown_modules() {
        let s = store_with(r#"{"storage":"^1.0"}"#, "{}");
        let host = caps::host_caps();
        assert_eq!(
            code(authorize(&s, &host, "sample-tool", "fs", "pickFiles")),
            Some(ErrorCode::PermissionDenied)
        );
        assert_eq!(
            code(authorize(&s, &host, "other-tool", "storage", "get")),
            Some(ErrorCode::PermissionDenied)
        );
    }

    #[test]
    fn unknown_cap_or_method_is_unavailable() {
        let s = store_with(r#"{"storage":"^1.0"}"#, "{}");
        let host = caps::host_caps();
        assert_eq!(
            code(authorize(&s, &host, "sample-tool", "storage", "drop")),
            Some(ErrorCode::CapabilityUnavailable)
        );
        assert_eq!(
            code(authorize(&s, &host, "sample-tool", "ocr", "read")),
            Some(ErrorCode::CapabilityUnavailable)
        );
    }

    #[test]
    fn optional_cap_beyond_host_is_version_mismatch() {
        let s = store_with(r#"{"storage":"^1.0"}"#, r#"{"window":"^2.0"}"#);
        let host = caps::host_caps();
        assert_eq!(
            code(authorize(
                &s,
                &host,
                "sample-tool",
                "window",
                "setAlwaysOnTop"
            )),
            Some(ErrorCode::VersionMismatch)
        );
        assert_eq!(s.granted("sample-tool", &host), vec!["storage".to_owned()]);
    }
}
