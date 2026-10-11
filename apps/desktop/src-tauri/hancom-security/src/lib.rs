// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! A fail-closed, dependency-free Hancom path-check callback (ADR-0027).
#![deny(unsafe_code)]
#[cfg(windows)]
mod ffi;
mod protocol;
