// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Handle table (capabilities.md §2.2, CAP-002). Modules see opaque random strings instead of
//! paths. A table lives for one app session; handles are bound to the module that received them.
//!
//! The random source is injected so this crate stays pure; the host supplies an OS CSPRNG.

use std::collections::HashMap;

use crate::error::ErrorCode;
use crate::util::to_hex;

/// Number of random bytes per handle (128 bits).
pub const HANDLE_BYTES: usize = 16;
/// Prefix that makes handles recognizable in logs (they are safe to log, PRV-003).
pub const HANDLE_PREFIX: &str = "h_";

/// Source of unpredictable bytes. The host must use a cryptographically secure generator.
pub trait RandomSource {
    /// Fills `buf` with random bytes.
    fn fill(&mut self, buf: &mut [u8; HANDLE_BYTES]);
}

/// Lookup failures. Map to bridge codes with [`HandleError::code`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HandleError {
    /// Unknown handle (never issued, released, or from a previous session).
    #[error("핸들을 찾을 수 없어요.")]
    NotFound,
    /// The handle belongs to another module.
    #[error("이 모듈이 받은 핸들이 아니에요.")]
    NotOwner,
}

impl HandleError {
    /// Bridge error code for this failure.
    pub fn code(self) -> ErrorCode {
        match self {
            Self::NotFound => ErrorCode::NotFound,
            Self::NotOwner => ErrorCode::PermissionDenied,
        }
    }
}

struct Slot<T> {
    module_id: String,
    target: T,
}

/// Maps handles to host-side targets (e.g. paths) per module.
pub struct HandleTable<T, R: RandomSource> {
    rng: R,
    slots: HashMap<String, Slot<T>>,
}

impl<T, R: RandomSource> HandleTable<T, R> {
    /// Creates an empty table for a new app session.
    pub fn new(rng: R) -> Self {
        Self {
            rng,
            slots: HashMap::new(),
        }
    }

    /// Issues a fresh handle for `target`, owned by `module_id`.
    pub fn issue(&mut self, module_id: &str, target: T) -> String {
        let handle = loop {
            let mut buf = [0u8; HANDLE_BYTES];
            self.rng.fill(&mut buf);
            let candidate = format!("{HANDLE_PREFIX}{}", to_hex(&buf));
            if !self.slots.contains_key(&candidate) {
                break candidate;
            }
        };
        self.slots.insert(
            handle.clone(),
            Slot {
                module_id: module_id.to_owned(),
                target,
            },
        );
        handle
    }

    /// Returns the target if `handle` exists and belongs to `module_id`.
    pub fn resolve(&self, module_id: &str, handle: &str) -> Result<&T, HandleError> {
        let slot = self.slots.get(handle).ok_or(HandleError::NotFound)?;
        if slot.module_id == module_id {
            Ok(&slot.target)
        } else {
            Err(HandleError::NotOwner)
        }
    }

    /// Drops every handle owned by `module_id` (e.g. when the module is unloaded).
    pub fn release_module(&mut self, module_id: &str) {
        self.slots.retain(|_, slot| slot.module_id != module_id);
    }

    /// Number of live handles.
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Whether no handles are live.
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic source that repeats its first output once to force a collision.
    struct Seq {
        n: u8,
        repeat_first: bool,
    }

    impl RandomSource for Seq {
        fn fill(&mut self, buf: &mut [u8; HANDLE_BYTES]) {
            if self.repeat_first && self.n == 1 {
                self.repeat_first = false;
                self.n = 0;
            }
            *buf = [self.n; HANDLE_BYTES];
            self.n = self.n.wrapping_add(1);
        }
    }

    fn table(repeat_first: bool) -> HandleTable<&'static str, Seq> {
        HandleTable::new(Seq { n: 0, repeat_first })
    }

    #[test]
    fn issue_and_resolve_for_owner_only() {
        let mut t = table(false);
        let h = t.issue("timer", "C:/secret/path.txt");
        assert!(h.starts_with(HANDLE_PREFIX));
        assert_eq!(h.len(), HANDLE_PREFIX.len() + HANDLE_BYTES * 2);
        assert_eq!(t.resolve("timer", &h), Ok(&"C:/secret/path.txt"));
        assert_eq!(t.resolve("other", &h), Err(HandleError::NotOwner));
        assert_eq!(HandleError::NotOwner.code(), ErrorCode::PermissionDenied);
        assert_eq!(t.resolve("timer", "h_unknown"), Err(HandleError::NotFound));
    }

    #[test]
    fn handles_never_collide() {
        let mut t = table(true);
        let a = t.issue("m-a", "a");
        let b = t.issue("m-a", "b");
        assert_ne!(a, b);
        assert_eq!(t.len(), 2);
    }

    #[test]
    fn release_module_drops_only_its_handles() {
        let mut t = table(false);
        let a = t.issue("m-a", "a");
        let b = t.issue("m-b", "b");
        t.release_module("m-a");
        assert_eq!(t.resolve("m-a", &a), Err(HandleError::NotFound));
        assert_eq!(t.resolve("m-b", &b), Ok(&"b"));
    }

    #[test]
    fn new_session_does_not_know_old_handles() {
        let mut old = table(false);
        let h = old.issue("timer", "x");
        let fresh = table(false);
        assert_eq!(fresh.resolve("timer", &h), Err(HandleError::NotFound));
    }
}
