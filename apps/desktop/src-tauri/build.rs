// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Declares the app's IPC commands so each one needs an explicit permission in
//! `capabilities/main.json` (SEC-003: least privilege, main window only).

use std::io::Write as _;

const COMMANDS: &[&str] = &[
    "host_invoke",
    "shell_info",
    "list_modules",
    "module_activated",
    "module_visibility",
    "module_unloaded",
    "check_update",
    "install_update",
    "restart_app",
    "sec_probe_report",
];

fn main() {
    let attrs = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(e) = tauri_build::try_build(attrs) {
        let _ = writeln!(std::io::stderr(), "tauri-build failed: {e}");
        std::process::exit(1);
    }
}
