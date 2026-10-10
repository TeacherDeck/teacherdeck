// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! SEC-004 probe (debug builds with `DECK_SEC_PROBE=1` only). Serves a page under the reserved
//! `_probe/` path on the module origin that tries to reach Tauri IPC and reports what it found
//! to the shell, which logs it via `sec_probe_report`. Procedure: docs/security/sec-004.md.

use tauri::http::{Response, StatusCode, Uri};

use crate::protocol::{is_probe_uri, module_id_from_uri, respond};
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

const MODULE_PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>module probe</title>
<script type="module" src="./module.js"></script></head><body><span id="synthetic-marker">synthetic-module-marker</span></body></html>"#;

const MODULE_SCRIPT: &str = r#"
const r = {origin: location.origin, bundleFetch: false, selfFetch: false, worker: false,
  siblingBlocked: 0, siblingMarkerReads: 0, parentAccess: "blocked", internalsInvoke: "n/a", rawIpcFetch: "n/a"};
const within = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
try { void window.parent.document; r.parentAccess = "allowed"; } catch {}
try {
  const data = await (await fetch("./data.json")).json();
  r.selfFetch = data.marker === "synthetic-module-marker";
  const bundle = await fetch(data.entry);
  r.bundleFetch = bundle.ok && (await bundle.text()).includes("<");
} catch {}
try {
  const worker = new Worker("./worker.js");
  try { r.worker = await within(new Promise((resolve) => { worker.onmessage = (e) => resolve(e.data === "synthetic-worker-marker"); worker.onerror = () => resolve(false); }), 3000); }
  finally { worker.terminate(); }
} catch {}
// Wait for the other synthetic frame's marker to exist; no user content is inspected.
await new Promise((resolve) => setTimeout(resolve, 500));
for (let i = 0; i < window.parent.length; i++) {
  const sibling = window.parent.frames[i];
  if (sibling === window) continue;
  try { if (sibling.document.getElementById("synthetic-marker")?.textContent === "synthetic-module-marker") r.siblingMarkerReads++; }
  catch { r.siblingBlocked++; }
}
if (typeof window.__TAURI_INTERNALS__ !== "undefined") {
  try { await within(window.__TAURI_INTERNALS__.invoke("shell_info"), 3000); r.internalsInvoke = "allowed"; }
  catch { r.internalsInvoke = "rejected"; }
}
try {
  const response = await within(fetch("http://ipc.localhost/shell_info", { method: "POST", body: "{}",
    headers: { "Content-Type": "application/json", "Tauri-Callback": "1", "Tauri-Error": "2" } }), 3000);
  r.rawIpcFetch = "status " + response.status;
} catch { r.rawIpcFetch = "blocked"; }
window.parent.postMessage({kind: "sec-module-probe", result: r}, "*");
"#;

const MODULE_WORKER: &str = "postMessage('synthetic-worker-marker');";

/// Serves `/_probe/*` when the probe is enabled; `None` otherwise.
pub fn serve(state: &AppState, uri: &Uri) -> Option<Response<Vec<u8>>> {
    if !cfg!(debug_assertions) || !state.sec_probe {
        return None;
    }
    if !is_probe_uri(uri) {
        let id = module_id_from_uri(uri)?;
        let store = state.modules.read().ok()?;
        let module = store.runnable(id)?;
        let (mime, bytes) = match uri.path() {
            "/_probe/module.html" => ("text/html; charset=utf-8", MODULE_PAGE.as_bytes().to_vec()),
            "/_probe/module.js" => (
                "text/javascript; charset=utf-8",
                MODULE_SCRIPT.as_bytes().to_vec(),
            ),
            "/_probe/worker.js" => (
                "text/javascript; charset=utf-8",
                MODULE_WORKER.as_bytes().to_vec(),
            ),
            "/_probe/data.json" => (
                "application/json",
                serde_json::to_vec(&serde_json::json!({
                    "marker": "synthetic-module-marker",
                    "entry": format!("/{id}/{}/{}", module.manifest.version, module.manifest.entry)
                }))
                .ok()?,
            ),
            _ => return None,
        };
        return Some(respond(StatusCode::OK, mime, bytes));
    }
    match uri.path() {
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
