// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! TeacherDeck desktop entry point.

// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = teacherdeck_lib::native_workers::dispatch_worker_mode() {
        std::process::exit(code);
    }
    teacherdeck_lib::run();
}
