// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! TeacherDeck pure logic crate.
//!
//! Holds platform-independent logic (manifest model, compatibility resolver, catalog model,
//! `.deckmod` validation, handle table). Must not depend on Tauri or OS APIs (crates/AGENTS.md).
//! Contents are added in Phase 3.

#![forbid(unsafe_code)]
