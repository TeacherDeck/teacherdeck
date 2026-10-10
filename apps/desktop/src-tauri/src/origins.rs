// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Origins (SEC-002, ADR-0013). Each module has a distinct reserved host. The bare origin is
//! retained only for the debug IPC probe; it must never serve module bundles or user files.

/// Custom URI scheme that serves module packages.
pub const MODULE_SCHEME: &str = "deckmod";
/// Legacy origin used only by the debug SEC-004 probe.
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
    format!("{}/{id}/{version}/{path}", module_origin(id))
}

/// Windows origin for a validated module id. Callers obtain ids from verified manifests.
pub fn module_origin(id: &str) -> String {
    format!("http://deckmod.{id}.modules.localhost")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_origins_are_separate_from_each_other_and_shell() {
        assert_eq!(
            module_url("timer", "0.1.0", "index.html"),
            "http://deckmod.timer.modules.localhost/timer/0.1.0/index.html"
        );
        assert_ne!(module_origin("timer"), module_origin("meeting-note"));
        assert_ne!(module_origin("timer"), SHELL_ORIGIN);
        assert_ne!(module_origin("timer"), MODULE_ORIGIN);
    }
}
