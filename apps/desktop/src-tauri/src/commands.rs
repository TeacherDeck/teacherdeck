// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Shell-only commands (never reachable from modules; capabilities/main.json grants them to
//! the main window only).

use std::sync::{Mutex, atomic::Ordering};

use deck_core::shell::{ModuleEntry, ShellInfo, UpdateStatus};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::UpdaterExt;

use crate::caps::window::restore;
use crate::origins::MODULE_ORIGIN;
use crate::state::AppState;

/// Startup facts for the shell.
#[tauri::command]
pub fn shell_info(state: State<'_, AppState>) -> ShellInfo {
    ShellInfo {
        app_version: state.app_version.clone(),
        mica: state.mica.load(Ordering::Relaxed),
        caps: state
            .host_caps
            .iter()
            .map(|(k, v)| (k.clone(), v.to_string()))
            .collect(),
        module_origin: MODULE_ORIGIN.into(),
        dev: cfg!(debug_assertions),
        sec_probe: state.sec_probe,
    }
}

/// Modules for the deck.
#[tauri::command]
pub fn list_modules(state: State<'_, AppState>) -> Vec<ModuleEntry> {
    state.modules.read().map(|s| s.list()).unwrap_or_default()
}

/// Granted caps of a runnable module (`init.granted`).
#[tauri::command]
pub fn module_activated(
    state: State<'_, AppState>,
    module_id: Option<String>,
    activate: Option<bool>,
) -> Vec<String> {
    update_active_module(&state.active, &module_id, activate);
    match (module_id, state.modules.read()) {
        (Some(id), Ok(store)) => store.granted(&id, &state.host_caps),
        _ => Vec::new(),
    }
}

fn update_active_module(
    active: &Mutex<Option<String>>,
    module_id: &Option<String>,
    activate: Option<bool>,
) {
    if activate.unwrap_or(true)
        && let Ok(mut active) = active.lock()
    {
        active.clone_from(module_id);
    }
}

/// The shell hid or showed a module iframe; hiding restores window state (capabilities.md §2.3).
#[tauri::command]
pub fn module_visibility(
    app: AppHandle,
    state: State<'_, AppState>,
    module_id: String,
    visible: Option<bool>,
    document_action: Option<deck_core::caps::window::DocumentAction>,
) -> Result<deck_core::caps::window::DocumentActionResult, deck_core::DeckError> {
    if visible == Some(false) {
        restore(&app, &state, &module_id);
    }
    match document_action {
        Some(action) => crate::document_host::shell_action(&app, &state, &module_id, action),
        None => Ok(Default::default()),
    }
}

/// The shell removed a module iframe: restore window state, drop its handles and storage cache.
#[tauri::command]
pub async fn module_unloaded(
    app: AppHandle,
    state: State<'_, AppState>,
    module_id: String,
    module_ids: Option<Vec<String>>,
) -> Result<(), ()> {
    let owners = module_ids.unwrap_or_else(|| vec![module_id]);
    if owners.len() > 4 {
        return Err(());
    }
    state
        .documents
        .lock()
        .map_err(|_| ())?
        .unload_many(&owners.iter().map(String::as_str).collect::<Vec<_>>())
        .map_err(|_| ())?;
    for module_id in owners {
        restore(&app, &state, &module_id);
        crate::caps::school_data::unload(&app, &module_id);
        crate::presentation_host::unload(&app, &module_id);
        crate::caps::office::cancel_owner(&app, &module_id);
        crate::caps::media_download::cancel_owner(&app, &module_id);
        crate::messaging_host::cancel_owner(&app, &module_id);
        if let Ok(mut plans) = state.file_ops.lock() {
            plans.unload(&module_id);
        }
        if let Ok(mut listings) = state.folder_listings.lock() {
            listings.unload(&module_id);
        }
        if let Ok(mut transfers) = state.transfers.lock() {
            transfers.unload(&module_id);
        }
        if let Ok(mut table) = state.handles.lock() {
            table.release_module(&module_id);
        }
        state.storage.forget(&module_id);
    }
    Ok(())
}

fn updater_configured(app: &AppHandle) -> bool {
    let cfg = app.config().plugins.0.get("updater");
    let pubkey = cfg.and_then(|c| c.get("pubkey")).and_then(Value::as_str);
    let endpoints = cfg
        .and_then(|c| c.get("endpoints"))
        .and_then(Value::as_array);
    pubkey.is_some_and(|k| !k.trim().is_empty()) && endpoints.is_some_and(|e| !e.is_empty())
}

/// Checks for an app update. Never installs on its own (SEC-008).
#[tauri::command]
pub async fn check_update(app: AppHandle) -> UpdateStatus {
    if !updater_configured(&app) {
        return UpdateStatus::NotConfigured;
    }
    let result = match app.updater() {
        Ok(u) => u.check().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(Some(update)) => UpdateStatus::Available {
            version: update.version,
        },
        Ok(None) => UpdateStatus::UpToDate,
        Err(e) => {
            tracing::warn!(error = %e, "update check failed");
            UpdateStatus::Failed {
                reason: "업데이트 서버에 연결할 수 없어요.".into(),
            }
        }
    }
}

/// Downloads and installs the update after the user agreed. Restart is a separate step.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    if !updater_configured(&app) {
        return Err("업데이트가 아직 설정되지 않았어요.".into());
    }
    let update = app
        .updater()
        .map_err(|_| "업데이트를 확인할 수 없어요.".to_owned())?
        .check()
        .await
        .map_err(|_| "업데이트 서버에 연결할 수 없어요.".to_owned())?
        .ok_or_else(|| "이미 최신 버전이에요.".to_owned())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "update install failed");
            "업데이트를 설치하지 못했어요.".to_owned()
        })
}

/// Restarts the app (only after the user chose to apply an update).
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    if !crate::document_host::request_exit(
        &app,
        deck_core::caps::window::DocumentExitAction::Restart,
    ) {
        app.restart();
    }
}

/// Debug-only SEC-004 probe result (docs/security/sec-004.md). Ignored in release builds.
#[tauri::command]
pub fn sec_probe_report(app: AppHandle, state: State<'_, AppState>, report: Value) {
    if !cfg!(debug_assertions) || !state.sec_probe {
        return;
    }
    tracing::warn!(%report, "SEC-004 probe report");
    let dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| state.log_dir.clone());
    let _ = crate::storage::write_atomic(
        &dir,
        "sec-probe.json",
        serde_json::to_string_pretty(&report)
            .unwrap_or_default()
            .as_bytes(),
    );
}

#[cfg(test)]
mod foreground_tests {
    use super::update_active_module;
    use std::sync::Mutex;

    #[test]
    fn grant_lookup_preserves_foreground_and_legacy_activation_still_updates_it() {
        let active = Mutex::new(Some("synthetic-visible".to_owned()));
        update_active_module(&active, &Some("synthetic-hidden".to_owned()), Some(false));
        assert_eq!(
            *active.lock().unwrap(),
            Some("synthetic-visible".to_owned())
        );
        update_active_module(&active, &Some("synthetic-next".to_owned()), None);
        assert_eq!(*active.lock().unwrap(), Some("synthetic-next".to_owned()));
        update_active_module(&active, &None, Some(true));
        assert_eq!(*active.lock().unwrap(), None);
    }
}
