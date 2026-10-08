// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Persistence for the `storage` capability: `app_data/module-data/<id>/storage.json`,
//! written atomically (temp file + rename). One store per module id (PRV-007).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use deck_core::caps::storage::Store;
use deck_core::util::is_valid_module_id;

const FILE: &str = "storage.json";

/// Loads, caches and persists module stores.
pub struct StorageService {
    root: PathBuf,
    cache: Mutex<HashMap<String, Store>>,
}

/// Storage failures surfaced as `INTERNAL` without details (PRV-003).
#[derive(Debug, thiserror::Error)]
pub enum PersistError {
    /// The module id is not a valid directory name.
    #[error("invalid module id")]
    InvalidModule,
    /// Disk I/O failed.
    #[error("storage I/O failed")]
    Io(#[from] std::io::Error),
    /// The cache lock was poisoned by a panic elsewhere.
    #[error("storage lock poisoned")]
    Poisoned,
}

impl StorageService {
    /// Uses `root` (normally `app_data_dir/module-data`).
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn dir(&self, module_id: &str) -> Result<PathBuf, PersistError> {
        // Module ids are validated identifiers, so joining cannot escape `root`.
        if !is_valid_module_id(module_id) {
            return Err(PersistError::InvalidModule);
        }
        Ok(self.root.join(module_id))
    }

    fn load(&self, module_id: &str) -> Result<Store, PersistError> {
        let path = self.dir(module_id)?.join(FILE);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Store::from_json(&bytes).unwrap_or_else(|| {
                tracing::warn!(module = %module_id, "storage file corrupt; starting empty");
                Store::default()
            })),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Runs `f` on the module's store; if it returns `Ok(true)` the store is persisted.
    pub fn with_store<T>(
        &self,
        module_id: &str,
        f: impl FnOnce(&mut Store) -> (T, bool),
    ) -> Result<T, PersistError> {
        let mut cache = self.cache.lock().map_err(|_| PersistError::Poisoned)?;
        if !cache.contains_key(module_id) {
            let loaded = self.load(module_id)?;
            cache.insert(module_id.to_owned(), loaded);
        }
        let store = cache
            .get_mut(module_id)
            .ok_or(PersistError::InvalidModule)?;
        let (out, dirty) = f(store);
        if dirty {
            write_atomic(&self.dir(module_id)?, FILE, &store.to_json())?;
        }
        Ok(out)
    }

    /// Drops the cached store of an unloaded module.
    pub fn forget(&self, module_id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(module_id);
        }
    }
}

/// Writes `dir/name` via a temp file and rename so a crash never leaves a half-written file.
pub fn write_atomic(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dir.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("deck-storage-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn persists_and_isolates_modules() {
        let root = temp_root("iso");
        let svc = StorageService::new(root.clone());
        svc.with_store("timer", |s| (s.set("k", json!(1)), true))
            .unwrap()
            .unwrap();
        let other = svc.with_store("seat-plan", |s| (s.keys(), false)).unwrap();
        assert!(
            other.is_empty(),
            "PRV-007: modules do not see each other's data"
        );

        let fresh = StorageService::new(root.clone());
        let v = fresh
            .with_store("timer", |s| (s.get("k").ok().flatten().cloned(), false))
            .unwrap();
        assert_eq!(v, Some(json!(1)));
        assert!(root.join("timer").join(FILE).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_module_ids() {
        let svc = StorageService::new(temp_root("bad"));
        assert!(matches!(
            svc.with_store("../evil", |_| ((), false)),
            Err(PersistError::InvalidModule)
        ));
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let root = temp_root("corrupt");
        write_atomic(&root.join("timer"), FILE, b"{broken").unwrap();
        let svc = StorageService::new(root.clone());
        let keys = svc.with_store("timer", |s| (s.keys(), false)).unwrap();
        assert!(keys.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
