// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Small shared helpers: identifiers, package-relative paths, hex.

use std::fmt::Write as _;

use sha2::{Digest, Sha256};

/// Maximum module id length (`^[a-z][a-z0-9-]{1,30}[a-z0-9]$`, MOD-002).
const MODULE_ID_MAX: usize = 32;

/// MOD-002: `^[a-z][a-z0-9-]{1,30}[a-z0-9]$`. Ids starting with `_` are impossible by construction,
/// which keeps the `_` path prefix reserved for host resources (catalog.md §3).
pub fn is_valid_module_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    let (Some(first), Some(last)) = (bytes.first(), bytes.last()) else {
        return false;
    };
    (3..=MODULE_ID_MAX).contains(&bytes.len())
        && first.is_ascii_lowercase()
        && (last.is_ascii_lowercase() || last.is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Capability names: lowercase ASCII letters and digits, starting with a letter (e.g. `storage`).
pub fn is_valid_cap_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 32
}

/// A path inside a module package: forward slashes, relative, no `.`/`..`/empty segments,
/// no drive letters, backslashes or control characters (SEC-005, SEC-006).
pub fn is_safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 255
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.chars().any(char::is_control)
        && path
            .split('/')
            .all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

/// Lowercase hex encoding.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
            // Writing to a String cannot fail.
            let _ = write!(out, "{b:02x}");
            out
        })
}

/// SHA-256 of `data` as lowercase hex.
pub fn sha256_hex(data: &[u8]) -> String {
    to_hex(&Sha256::digest(data))
}

/// `true` for a 64-character lowercase hex SHA-256 digest.
pub fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_ids() {
        for ok in ["timer", "seat-plan", "a1b", "abc-123"] {
            assert!(is_valid_module_id(ok), "{ok}");
        }
        for bad in [
            "",
            "ab",
            "_timer",
            "Timer",
            "timer-",
            "1timer",
            "time_r",
            &"a".repeat(33),
        ] {
            assert!(!is_valid_module_id(bad), "{bad}");
        }
    }

    #[test]
    fn relative_paths() {
        for ok in ["index.html", "assets/a.png", "a/b/c.js"] {
            assert!(is_safe_relative_path(ok), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../b",
            "a/./b",
            "a//b",
            "C:/x",
            "c:x",
            "a\\b",
            "a\u{0}b",
        ] {
            assert!(!is_safe_relative_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn hex_and_hash() {
        assert_eq!(to_hex(&[0x00, 0xab, 0xff]), "00abff");
        let h = sha256_hex(b"abc");
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(is_sha256_hex(&h));
        assert!(!is_sha256_hex(&h.to_uppercase()));
    }
}
