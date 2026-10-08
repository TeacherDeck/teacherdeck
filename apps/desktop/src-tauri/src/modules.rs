// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Module store: loads the bundled index, validates every package with deck-core, resolves
//! versions (VER-005) and keeps runnable packages in memory for the `deckmod` protocol.
//! Serving from memory means no file system path is ever derived from a URL (SEC-005).

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

use deck_core::caps::HostCaps;
use deck_core::catalog::{CatalogIndex, IndexEntry};
use deck_core::manifest::ModuleManifest;
use deck_core::package::{ValidatedPackage, validate_package};
use deck_core::resolver::{Candidate, Source, resolve};
use deck_core::shell::ModuleEntry;
use semver::VersionReq;

use crate::origins::module_url;

/// Bundled index location inside the app resources.
pub const BUNDLED_INDEX: &str = "modules/index.json";

/// A runnable module version.
pub struct LoadedModule {
    /// Validated manifest.
    pub manifest: ModuleManifest,
    files: HashMap<String, Arc<Vec<u8>>>,
}

impl LoadedModule {
    fn from_package(pkg: ValidatedPackage) -> Self {
        Self {
            manifest: pkg.manifest,
            files: pkg
                .files
                .into_iter()
                .map(|f| (f.path, Arc::new(f.data)))
                .collect(),
        }
    }

    /// File contents by package-relative path.
    pub fn file(&self, path: &str) -> Option<Arc<Vec<u8>>> {
        self.files.get(path).cloned()
    }

    /// Whether the module declared `cap` in `requires` or `optional` (MOD-006).
    pub fn declared_range(&self, cap: &str) -> Option<&str> {
        self.manifest
            .requires
            .get(cap)
            .or_else(|| self.manifest.optional.get(cap))
            .map(String::as_str)
    }
}

/// All modules known to this app session.
#[derive(Default)]
pub struct ModuleStore {
    entries: BTreeMap<String, ModuleEntry>,
    /// Runnable modules: id → picked version.
    runnable: HashMap<String, LoadedModule>,
}

/// Why a bundled package version is unusable (logged by id/version only, PRV-003).
fn check_entry(id: &str, entry: &IndexEntry, pkg: &ValidatedPackage) -> Result<(), &'static str> {
    if pkg.sha256 != entry.sha256 {
        return Err("sha256 mismatch");
    }
    if pkg.manifest.id != id || pkg.manifest.version != entry.version {
        return Err("manifest id/version differs from index");
    }
    if pkg.manifest.requires != entry.requires || pkg.manifest.optional != entry.optional {
        return Err("manifest caps differ from index");
    }
    Ok(())
}

impl ModuleStore {
    /// Loads bundled modules from `resource_dir/modules/`. Missing index → no modules.
    pub fn load_bundled(resource_dir: &Path, host: &HostCaps) -> Self {
        let index_path = resource_dir.join(BUNDLED_INDEX);
        let Ok(text) = std::fs::read_to_string(&index_path) else {
            tracing::warn!("bundled module index not found");
            return Self::default();
        };
        let index = match CatalogIndex::parse(&text) {
            Ok(i) => i,
            Err(e) => {
                tracing::error!(error = %e, "bundled module index rejected");
                return Self::default();
            }
        };
        let base = index_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default();
        Self::from_index(&index, host, |id, entry| {
            let file = base
                .join(entry.url.trim_end_matches('/'))
                .join(package_file_name(id, &entry.version.to_string()));
            std::fs::read(file).ok()
        })
    }

    /// Builds the store from an index and a package reader (tests inject the reader).
    pub fn from_index(
        index: &CatalogIndex,
        host: &HostCaps,
        mut read_package: impl FnMut(&str, &IndexEntry) -> Option<Vec<u8>>,
    ) -> Self {
        let mut packages: HashMap<(String, String), ValidatedPackage> = HashMap::new();
        let mut candidates: BTreeMap<String, Vec<Candidate>> = BTreeMap::new();

        for (id, entries) in &index.modules {
            for entry in entries {
                let version = entry.version.to_string();
                let valid = match read_package(id, entry).map(|b| validate_package(&b)) {
                    Some(Ok(pkg)) => match check_entry(id, entry, &pkg) {
                        Ok(()) => {
                            packages.insert((id.clone(), version.clone()), pkg);
                            true
                        }
                        Err(reason) => {
                            tracing::warn!(module = %id, %version, reason, "bundled package rejected");
                            false
                        }
                    },
                    Some(Err(e)) => {
                        tracing::warn!(module = %id, %version, error = %e, "bundled package invalid");
                        false
                    }
                    None => {
                        tracing::warn!(module = %id, %version, "bundled package missing");
                        false
                    }
                };
                candidates.entry(id.clone()).or_default().push(Candidate {
                    source: Source::Bundled,
                    version: entry.version.clone(),
                    requires: entry.requires.clone(),
                    optional: entry.optional.clone(),
                    sha256: Some(entry.sha256.clone()),
                    revoked: entry.revoked,
                    manifest_valid: valid,
                });
            }
        }

        let mut store = Self::default();
        for (id, resolution) in resolve(host, &candidates) {
            let picked = resolution.picked.as_ref().map(|p| p.version.to_string());
            let display = picked
                .clone()
                .or_else(|| resolution.newest.as_ref().map(ToString::to_string));
            let manifest = display
                .as_ref()
                .and_then(|v| packages.get(&(id.clone(), v.clone())))
                .map(|p| p.manifest.clone());
            let icon_url = manifest
                .as_ref()
                .zip(display.as_ref())
                .filter(|_| picked.is_some())
                .map(|(m, v)| module_url(&id, v, &m.icon));
            let entry_url = manifest
                .as_ref()
                .zip(picked.as_ref())
                .map(|(m, v)| module_url(&id, v, &m.entry));
            if let Some(v) = &picked
                && let Some(pkg) = packages.remove(&(id.clone(), v.clone()))
            {
                store
                    .runnable
                    .insert(id.clone(), LoadedModule::from_package(pkg));
            }
            tracing::info!(module = %id, state = ?resolution.state, "module resolved");
            store.entries.insert(
                id,
                ModuleEntry {
                    resolution,
                    manifest,
                    entry_url,
                    icon_url,
                },
            );
        }
        store
    }

    /// Modules for the shell's deck, in id order.
    pub fn list(&self) -> Vec<ModuleEntry> {
        self.entries.values().cloned().collect()
    }

    /// Runnable module by id.
    pub fn runnable(&self, id: &str) -> Option<&LoadedModule> {
        self.runnable.get(id)
    }

    /// The version currently served for `id`.
    pub fn served_version(&self, id: &str) -> Option<String> {
        self.entries
            .get(id)
            .and_then(|e| e.resolution.picked.as_ref())
            .map(|p| p.version.to_string())
    }

    /// Caps granted to `id`: declared caps the host satisfies (`init.granted`).
    pub fn granted(&self, id: &str, host: &HostCaps) -> Vec<String> {
        let Some(m) = self.runnable(id) else {
            return Vec::new();
        };
        m.manifest
            .requires
            .iter()
            .chain(&m.manifest.optional)
            .filter(|(cap, range)| {
                matches!((VersionReq::parse(range), host.get(cap.as_str())), (Ok(r), Some(v)) if r.matches(v))
            })
            .map(|(cap, _)| cap.clone())
            .collect()
    }
}

/// File name of a package inside its index `url` directory (catalog.md §1).
pub fn package_file_name(id: &str, version: &str) -> String {
    format!("{id}-{version}.deckmod")
}
