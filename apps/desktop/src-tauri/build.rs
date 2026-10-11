// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Declares the app's IPC commands so each one needs an explicit permission in
//! `capabilities/main.json` (SEC-003: least privilege, main window only).

use std::io::Write as _;

const COMMANDS: &[&str] = &[
    "host_invoke",
    "overlay_ui_state",
    "overlay_ui_action",
    "shell_info",
    "list_modules",
    "module_activated",
    "module_visibility",
    "module_unloaded",
    "check_update",
    "install_update",
    "restart_app",
    "sec_probe_report",
    "school_data_load",
    "school_data_save",
    "school_data_pending",
    "school_data_resolve_access",
    "school_data_grants",
    "school_data_revoke_grant",
    "school_data_import_photo",
    "school_data_read_backup",
    "school_data_recover",
    "school_data_read_workbook",
    "school_data_write_workbook",
    "school_data_export_backup",
    "school_data_export_timetable_image",
    "messaging_pending_confirmations",
    "messaging_resolve_confirmation",
];

fn main() {
    let attrs = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));
    if let Err(e) = tauri_build::try_build(attrs) {
        let _ = writeln!(std::io::stderr(), "tauri-build failed: {e}");
        std::process::exit(1);
    }
}
