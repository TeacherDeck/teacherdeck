// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! SEC-004 probe (debug builds with `DECK_SEC_PROBE=1` only). Serves a page under the reserved
//! `_probe/` path on the module origin that tries to reach Tauri IPC and reports what it found
//! to the shell, which logs it via `sec_probe_report`. Procedure: docs/security/sec-004.md.

use tauri::http::{Response, StatusCode};

use crate::protocol::respond;
use crate::state::AppState;

const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>probe</title>
<script type="module" src="./probe.js"></script></head><body>probe</body></html>"#;

const SCRIPT: &str = r#"
const r = {
  origin: location.origin,
  tauriInternals: typeof window.__TAURI_INTERNALS__ !== "undefined",
  tauriGlobal: typeof window.__TAURI__ !== "undefined",
  parentAccess: "blocked",
  internalsInvoke: "n/a",
  rawIpcFetch: "n/a",
};
try { void window.parent.__TAURI_INTERNALS__; r.parentAccess = "allowed"; } catch { /* cross-origin */ }
const within = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);
if (r.tauriInternals) {
  try { await within(window.__TAURI_INTERNALS__.invoke("shell_info"), 3000); r.internalsInvoke = "allowed"; }
  catch (e) { r.internalsInvoke = "rejected: " + String(e); }
}
try {
  const res = await within(fetch("http://ipc.localhost/shell_info", { method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", "Tauri-Callback": "1", "Tauri-Error": "2" } }), 3000);
  r.rawIpcFetch = "status " + res.status;
} catch (e) { r.rawIpcFetch = "blocked: " + String(e); }
window.parent.postMessage({ kind: "sec-probe", result: r }, "*");
"#;

/// Serves `/_probe/*` when the probe is enabled; `None` otherwise.
pub fn serve(state: &AppState, path: &str) -> Option<Response<Vec<u8>>> {
    if !cfg!(debug_assertions) || !state.sec_probe {
        return None;
    }
    match path {
        "/_probe/index.html" => Some(respond(
            StatusCode::OK,
            "text/html; charset=utf-8",
            PAGE.into(),
        )),
        "/_probe/probe.js" => Some(respond(
            StatusCode::OK,
            "text/javascript; charset=utf-8",
            SCRIPT.into(),
        )),
        _ => None,
    }
}
