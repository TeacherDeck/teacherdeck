// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! TeacherDeck pure logic crate.
//!
//! Platform-independent logic shared by the host and the code generator: manifest model,
//! compatibility resolver, catalog index, `.deckmod` validation and the handle table.
//! Must not depend on Tauri or OS APIs (crates/AGENTS.md); must not panic in library code.
//!
//! Public types derive `serde`, `schemars` and `ts-rs`; `crates/deck-codegen` turns them into
//! `schema/*.json` and TS types (`pnpm gen`, CAP-006, GEN-006).

#![forbid(unsafe_code)]

pub mod caps;
pub mod catalog;
pub mod error;
pub mod handles;
pub mod manifest;
pub mod package;
pub mod resolver;
pub mod util;

pub use caps::HostCaps;
pub use catalog::{CatalogError, CatalogIndex, IndexEntry};
pub use error::{DeckError, ErrorCode};
pub use handles::{HandleError, HandleTable, RandomSource};
pub use manifest::{Issue, ManifestError, ModuleManifest};
pub use package::{PackageError, ValidatedPackage, validate_package};
pub use resolver::{Candidate, Resolution, ResolveState, Source, resolve, resolve_one};
