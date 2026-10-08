// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `deckmod` custom protocol (catalog.md §3, SEC-005).
//!
//! URL shape: `http://deckmod.localhost/<id>/<version>/<path>`. The path is percent-decoded once
//! and validated with deck-core's package path rules; anything else is a 404. Files come from the
//! in-memory module store, so no URL can reach the file system. Every response carries the
//! module CSP and `nosniff`.

use percent_encoding::percent_decode_str;
use tauri::http::{Method, Response, StatusCode, header};

use deck_core::util::{is_safe_relative_path, is_valid_module_id};

use crate::origins::shell_origins;

/// A request path split into its parts.
#[derive(Debug, PartialEq, Eq)]
pub struct ModulePath {
    /// Module id.
    pub id: String,
    /// Module version.
    pub version: String,
    /// Package-relative file path.
    pub file: String,
}

/// Parses and validates `/<id>/<version>/<path>`. `None` means "not servable".
pub fn parse_path(raw: &str) -> Option<ModulePath> {
    let decoded = percent_decode_str(raw).decode_utf8().ok()?;
    // A `%` left after one decoding pass is a double-encoding attempt (`%252e%252e`).
    if decoded.contains('%') {
        return None;
    }
    let rest = decoded.strip_prefix('/')?;
    let mut parts = rest.splitn(3, '/');
    let id = parts.next()?;
    let version = parts.next()?;
    let file = parts.next()?;
    if !is_valid_module_id(id) || semver::Version::parse(version).is_err() {
        return None;
    }
    if !is_safe_relative_path(file) {
        return None;
    }
    Some(ModulePath {
        id: id.to_owned(),
        version: version.to_owned(),
        file: file.to_owned(),
    })
}

/// Module CSP (catalog.md §3). `frame-ancestors` lists the shell origin(s) only.
pub fn module_csp() -> String {
    format!(
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; \
         object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors {}",
        shell_origins().join(" ")
    )
}

/// Content type by extension. Unknown types are served as `application/octet-stream`.
pub fn content_type(path: &str) -> &'static str {
    let ext = path.rsplit_once('.').map_or("", |(_, e)| e);
    match ext.to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Builds a response with the security headers every `deckmod` response carries.
pub fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut res = Response::new(body);
    *res.status_mut() = status;
    let headers = res.headers_mut();
    let mut set = |name: header::HeaderName, value: &str| {
        if let Ok(v) = header::HeaderValue::from_str(value) {
            headers.insert(name, v);
        }
    };
    set(header::CONTENT_TYPE, content_type);
    set(header::CONTENT_SECURITY_POLICY, &module_csp());
    set(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    set(header::CACHE_CONTROL, "no-store");
    set(header::REFERRER_POLICY, "no-referrer");
    res
}

/// Status for a request method: only GET and HEAD are served.
pub fn method_allowed(method: &Method) -> bool {
    method == Method::GET || method == Method::HEAD
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_paths() {
        assert_eq!(
            parse_path("/timer/0.1.0/assets/app.js"),
            Some(ModulePath {
                id: "timer".into(),
                version: "0.1.0".into(),
                file: "assets/app.js".into(),
            })
        );
        assert!(parse_path("/timer/0.1.0/%EC%95%84%EC%9D%B4%EC%BD%98.svg").is_some());
    }

    #[test]
    fn rejects_traversal_and_encoding_tricks() {
        for bad in [
            "/timer/0.1.0/../../secret",
            "/timer/0.1.0/a/../../b",
            "/timer/0.1.0/%2e%2e/%2e%2e/secret",
            "/timer/0.1.0/%2E%2E%2Fsecret",
            "/timer/0.1.0/%252e%252e/secret",
            "/timer/0.1.0/..%5c..%5csecret",
            "/timer/0.1.0/a%5cb",
            "/timer/0.1.0/C:/Windows/win.ini",
            "/timer/0.1.0//etc/passwd",
            "/timer/0.1.0/a%00b",
            "/timer/0.1.0/%ff",
            "/_host/0.1.0/x",
            "/Timer/0.1.0/index.html",
            "/timer/latest/index.html",
            "/timer/0.1.0/",
            "/timer/0.1.0",
            "timer/0.1.0/index.html",
        ] {
            assert_eq!(parse_path(bad), None, "{bad}");
        }
    }

    #[test]
    fn responses_carry_security_headers() {
        let res = respond(StatusCode::OK, content_type("index.html"), b"x".to_vec());
        let h = res.headers();
        assert_eq!(h.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(), "nosniff");
        let csp = h
            .get(header::CONTENT_SECURITY_POLICY)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(csp.contains("connect-src 'self'"));
        assert!(csp.contains("frame-ancestors http://tauri.localhost"));
        assert!(csp.contains("object-src 'none'"));
        assert_eq!(
            h.get(header::CONTENT_TYPE).unwrap(),
            "text/html; charset=utf-8"
        );
    }

    #[test]
    fn only_get_and_head() {
        assert!(method_allowed(&Method::GET));
        assert!(method_allowed(&Method::HEAD));
        assert!(!method_allowed(&Method::POST));
    }
}
