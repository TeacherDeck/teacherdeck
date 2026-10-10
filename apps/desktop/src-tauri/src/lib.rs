// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! TeacherDeck host (apps/desktop/src-tauri/AGENTS.md).
//!
//! Wiring only: window and Mica, logging, temp area, module store, `deckmod` protocol, IPC
//! commands and drag-and-drop. Logic lives in deck-core; capability handlers in [`caps`].

use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

use deck_core::handles::HandleTable;
use deck_core::shell::FsDroppedEvent;
use tauri::http::StatusCode;
use tauri::{DragDropEvent, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

mod bridge;
mod caps;
mod commands;
pub mod file_output;
pub mod file_read;
pub mod file_transfer;
pub mod modules;
pub mod origins;
pub mod platform;
mod probe;
mod protocol;
pub mod state;
pub mod storage;

use crate::modules::ModuleStore;
use crate::origins::{MAIN_WINDOW, MODULE_SCHEME};
use crate::platform::{OsRng, TempArea, apply_mica, init_logging, supports_mica};
use crate::protocol::{content_type, method_allowed, module_request_path, respond};
use crate::state::AppState;
use crate::storage::StorageService;

/// Shell event carrying dropped files for the active module.
pub const FS_DROPPED_EVENT: &str = "deck://fs-dropped";

fn serve(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let not_found = || {
        respond(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            Vec::new(),
        )
    };
    if !method_allowed(request.method()) {
        return respond(
            StatusCode::METHOD_NOT_ALLOWED,
            "text/plain; charset=utf-8",
            Vec::new(),
        );
    }
    let state = app.state::<AppState>();
    let path = request.uri().path();
    tracing::debug!(
        len = path.len(),
        probe = path.starts_with("/_probe/"),
        "deckmod request"
    );
    if let Some(res) = probe::serve(&state, request.uri()) {
        return res;
    }
    if path.starts_with("/_resources/") {
        return caps::serve_file_resource(&state, request);
    }
    let Some(req) = module_request_path(request.uri()) else {
        return not_found();
    };
    let Ok(store) = state.modules.read() else {
        return not_found();
    };
    if store.served_version(&req.id).as_deref() != Some(req.version.as_str()) {
        return not_found();
    }
    match store.runnable(&req.id).and_then(|m| m.file(&req.file)) {
        Some(bytes) => respond(
            StatusCode::OK,
            content_type(&req.file),
            bytes.as_ref().clone(),
        ),
        None => not_found(),
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let paths = app.path();
    let log_dir = paths.app_log_dir()?;
    if let Some(guard) = init_logging(&log_dir) {
        // Keep the log writer alive for the whole session.
        app.manage(guard);
    }
    let app_version = app.package_info().version.to_string();
    tracing::info!(version = %app_version, "starting");

    let temp = TempArea::init(paths.app_cache_dir()?.join("tmp"))
        .inspect_err(|e| tracing::warn!(error = %e, "temp area unavailable"))
        .ok();
    let host_caps = deck_core::caps::host_caps();
    let file_temp = TempArea::init_preserving(paths.app_cache_dir()?.join("file-tmp")).ok();
    if let Some(area) = &file_temp
        && file_output::recover(area).is_err()
    {
        tracing::warn!("file output recovery incomplete; unverified remnants preserved");
    }
    let store = ModuleStore::load_bundled(&paths.resource_dir()?, &host_caps);

    app.manage(AppState {
        app_version,
        host_caps,
        modules: RwLock::new(store),
        handles: Mutex::new(HandleTable::new(OsRng)),
        transfers: Mutex::new(Default::default()),
        storage: StorageService::new(paths.app_data_dir()?.join("module-data")),
        overrides: Mutex::new(Default::default()),
        active: Mutex::new(None),
        mica: AtomicBool::new(false),
        sec_probe: cfg!(debug_assertions)
            && std::env::var("DECK_SEC_PROBE").is_ok_and(|v| v == "1"),
        temp,
        file_temp,
        log_dir,
    });

    let cleanup_app = app.handle().clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            let Some(state) = cleanup_app.try_state::<AppState>() else {
                break;
            };
            if let Ok(mut transfers) = state.transfers.try_lock() {
                transfers.expire();
            }
        }
    });

    // Transparent only where Mica can fill it; Windows 10 gets an opaque window (UI-004).
    let mut builder = WebviewWindowBuilder::new(app, MAIN_WINDOW, WebviewUrl::default())
        .title("TeacherDeck")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 560.0)
        // The shell draws its own title bar (apps/desktop/src/TitleBar.tsx); the OS keeps
        // the shadow, rounded corners, resize borders and snapping.
        .decorations(false)
        .shadow(true)
        .transparent(supports_mica())
        .visible(false);
    // Debug-only diagnostics (docs/security/sec-004.md): DevTools protocol on a local port.
    // Release builds never compile this branch in (SEC-007).
    if cfg!(debug_assertions) && std::env::var("DECK_REMOTE_DEBUG").is_ok_and(|v| v == "1") {
        builder = builder.additional_browser_args(
            "--remote-debugging-port=9333 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        );
    }
    let window = builder.build()?;
    let mica = apply_mica(&window);
    app.state::<AppState>()
        .mica
        .store(mica, std::sync::atomic::Ordering::Relaxed);
    window.show()?;

    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
            on_drop(&handle, paths);
        }
    });
    Ok(())
}

/// Issues handles for dropped files and forwards them to the active module if it holds `fs`.
fn on_drop(app: &tauri::AppHandle, paths: &[std::path::PathBuf]) {
    let state = app.state::<AppState>();
    let Some(module_id) = state.active_module() else {
        return;
    };
    let granted = state
        .modules
        .read()
        .map(|s| s.granted(&module_id, &state.host_caps))
        .unwrap_or_default();
    if !granted.iter().any(|c| c == "fs") {
        return;
    }
    let payload = caps::issue_dropped(&state, &module_id, paths);
    tracing::debug!(module = %module_id, count = payload.files.len(), "files dropped");
    let _ = app.emit_to(
        MAIN_WINDOW,
        FS_DROPPED_EVENT,
        FsDroppedEvent { module_id, payload },
    );
}

/// Builds and runs the app.
pub fn run() {
    let result = tauri::Builder::default()
        // Must be first so a second launch focuses the existing window.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window(MAIN_WINDOW) {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol(MODULE_SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(serve(&app, &request)));
        })
        .invoke_handler(tauri::generate_handler![
            bridge::host_invoke,
            commands::shell_info,
            commands::list_modules,
            commands::module_activated,
            commands::module_visibility,
            commands::module_unloaded,
            commands::check_update,
            commands::install_update,
            commands::restart_app,
            commands::sec_probe_report,
        ])
        .setup(setup)
        .run(tauri::generate_context!());
    if let Err(e) = result {
        tracing::error!(error = %e, "app terminated with an error");
        std::process::exit(1);
    }
}
