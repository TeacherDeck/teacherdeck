// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Fixed origins (SEC-002). Confirmed at runtime in Phase 4 (see docs/security/sec-004.md):
//! on Windows, Tauri 2 serves the shell from `http://tauri.localhost` and the custom scheme
//! `deckmod` from `http://deckmod.localhost`. Shell and modules therefore never share an origin.

/// Custom URI scheme that serves module packages.
pub const MODULE_SCHEME: &str = "deckmod";
/// Origin of module iframes.
pub const MODULE_ORIGIN: &str = "http://deckmod.localhost";
/// Origin of the shell in release builds.
pub const SHELL_ORIGIN: &str = "http://tauri.localhost";
/// Origin of the shell in debug builds (Vite dev server, `build.devUrl`).
pub const SHELL_DEV_ORIGIN: &str = "http://localhost:1420";
/// Label of the only window that may use IPC (capabilities/main.json).
pub const MAIN_WINDOW: &str = "main";

/// Origins allowed to frame modules (`frame-ancestors`).
pub fn shell_origins() -> &'static [&'static str] {
    if cfg!(debug_assertions) {
        &[SHELL_ORIGIN, SHELL_DEV_ORIGIN]
    } else {
        &[SHELL_ORIGIN]
    }
}

/// iframe URL of a file inside a module package.
pub fn module_url(id: &str, version: &str, path: &str) -> String {
    format!("{MODULE_ORIGIN}/{id}/{version}/{path}")
}
