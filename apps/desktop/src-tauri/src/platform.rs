// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Platform helpers: OS facts, Mica backdrop, randomness, temp area, logging.
//! No `unsafe` here: Win32 access goes through `window-vibrancy` and `windows-version`
//! (SEC-010: if raw FFI is ever needed, isolate it in its own module with SAFETY comments).

use std::path::{Path, PathBuf};

use deck_core::caps::system::OsInfo;
use deck_core::handles::{HANDLE_BYTES, RandomSource};

/// Windows 11 starts at build 22000.
const WIN11_BUILD: u32 = 22000;

/// OS name, version and build.
pub fn os_info() -> OsInfo {
    #[cfg(windows)]
    {
        let v = windows_version::OsVersion::current();
        OsInfo {
            name: "windows".into(),
            version: format!("{}.{}", v.major, v.minor),
            build: v.build,
        }
    }
    #[cfg(not(windows))]
    {
        OsInfo {
            name: std::env::consts::OS.into(),
            version: String::new(),
            build: 0,
        }
    }
}

/// Whether this OS supports the Mica backdrop.
pub fn supports_mica() -> bool {
    cfg!(windows) && os_info().build >= WIN11_BUILD
}

/// Applies Mica to the window. Returns `false` (opaque fallback, UI-004) when unsupported.
pub fn apply_mica(window: &tauri::WebviewWindow) -> bool {
    if !supports_mica() {
        return false;
    }
    match window_vibrancy::apply_mica(window, None) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!(error = %e, "mica unavailable; using opaque background");
            false
        }
    }
}

/// User locale as BCP 47, defaulting to Korean.
pub fn locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "ko-KR".into())
}

/// OS CSPRNG for handles (deck-core keeps the table pure and injects this).
pub struct OsRng;

impl RandomSource for OsRng {
    fn fill(&mut self, buf: &mut [u8; HANDLE_BYTES]) {
        if getrandom::fill(buf).is_err() {
            // getrandom only fails when the OS has no entropy source; refusing to issue
            // predictable handles is safer than continuing.
            tracing::error!("OS random source unavailable; aborting");
            std::process::abort();
        }
    }
}

/// App-private temp area (PRV-005): created under the app cache dir, emptied at startup.
pub struct TempArea {
    root: PathBuf,
}

/// A temp directory removed when dropped.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// Directory path (never log it, PRV-003).
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl TempArea {
    /// Uses `root`, removing leftovers from a previous run.
    pub fn init(root: PathBuf) -> std::io::Result<Self> {
        if root.exists() {
            std::fs::remove_dir_all(&root)?;
        }
        std::fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    /// Creates a fresh directory that is deleted when the guard drops.
    pub fn create_dir(&self, rng: &mut impl RandomSource) -> std::io::Result<TempDir> {
        let mut buf = [0u8; HANDLE_BYTES];
        rng.fill(&mut buf);
        let path = self.root.join(deck_core::util::to_hex(&buf));
        std::fs::create_dir(&path)?;
        Ok(TempDir { path })
    }
}

/// Starts file logging (daily rotation, 7 files). Keep the returned guard alive.
///
/// PRV-003: log only module ids, cap/method names, counts, sizes and error codes — never paths,
/// file names, file contents, user input or storage values.
pub fn init_logging(dir: &Path) -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("teacherdeck")
        .filename_suffix("log")
        .max_log_files(7)
        .build(dir)
        .ok()?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let level = if cfg!(debug_assertions) {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };
    tracing_subscriber::fmt()
        .with_writer(writer)
        .with_ansi(false)
        .with_max_level(level)
        .try_init()
        .ok()?;
    Some(guard)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Counter(u8);
    impl RandomSource for Counter {
        fn fill(&mut self, buf: &mut [u8; HANDLE_BYTES]) {
            self.0 = self.0.wrapping_add(1);
            *buf = [self.0; HANDLE_BYTES];
        }
    }

    #[test]
    fn temp_area_cleans_leftovers_and_drops_dirs() {
        let root = std::env::temp_dir().join(format!("deck-temp-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("stale")).unwrap();
        let area = TempArea::init(root.clone()).unwrap();
        assert!(
            !root.join("stale").exists(),
            "PRV-005: leftovers removed at startup"
        );
        let dir = area.create_dir(&mut Counter(0)).unwrap();
        let p = dir.path().to_path_buf();
        assert!(p.exists());
        drop(dir);
        assert!(!p.exists(), "PRV-005: removed when the job ends");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn os_rng_fills_bytes() {
        let mut a = [0u8; HANDLE_BYTES];
        let mut b = [0u8; HANDLE_BYTES];
        OsRng.fill(&mut a);
        OsRng.fill(&mut b);
        assert_ne!(a, b);
    }
}
