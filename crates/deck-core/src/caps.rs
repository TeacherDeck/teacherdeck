// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Capability version map types (capabilities.md). The capability registry itself lives in the
//! host (Phase 4); deck-core only needs "which version of each cap does this host provide".

use std::collections::BTreeMap;

use semver::Version;

/// Capability name → version provided by the running host (`init.host.caps`).
pub type HostCaps = BTreeMap<String, Version>;
