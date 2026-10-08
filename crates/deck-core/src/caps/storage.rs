// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `storage` capability: a per-module JSON key-value store (capabilities.md §2.1, PRV-007).
//! The in-memory model and limits live here; the host persists [`Store::to_json`] atomically.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Maximum serialized size of one value.
pub const MAX_VALUE_BYTES: usize = 256 * 1024;
/// Maximum serialized size of a module's whole store.
pub const MAX_TOTAL_BYTES: usize = 5 * 1024 * 1024;
/// Maximum key length.
pub const MAX_KEY_LEN: usize = 128;

/// Arguments of `get` and `delete`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct KeyArgs {
    /// `^[A-Za-z0-9._-]{1,128}$`
    pub key: String,
}

/// Arguments of `set`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct SetArgs {
    /// `^[A-Za-z0-9._-]{1,128}$`
    pub key: String,
    /// Any JSON value up to 256 KB.
    #[ts(type = "unknown")]
    pub value: serde_json::Value,
}

/// Why a storage operation was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StorageError {
    /// Key does not match `^[A-Za-z0-9._-]{1,128}$`.
    #[error("키는 영문·숫자·._- 1~128자여야 해요.")]
    InvalidKey,
    /// Value exceeds [`MAX_VALUE_BYTES`].
    #[error("값이 256KB를 넘어요.")]
    ValueTooLarge,
    /// Store would exceed [`MAX_TOTAL_BYTES`].
    #[error("모듈 저장 공간(5MB)이 가득 찼어요.")]
    QuotaExceeded,
}

/// `^[A-Za-z0-9._-]{1,128}$`
pub fn is_valid_key(key: &str) -> bool {
    (1..=MAX_KEY_LEN).contains(&key.len())
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// One module's store.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Store {
    entries: BTreeMap<String, serde_json::Value>,
}

fn json_len(v: &impl Serialize) -> usize {
    serde_json::to_vec(v).map_or(usize::MAX, |b| b.len())
}

impl Store {
    /// Loads a persisted store. Corrupt data yields an empty store rather than an error so a
    /// broken file never blocks the module; the host logs the event without contents (PRV-003).
    pub fn from_json(bytes: &[u8]) -> Option<Self> {
        serde_json::from_slice(bytes).ok()
    }

    /// Serialized form for persistence.
    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// Value of `key`.
    pub fn get(&self, key: &str) -> Result<Option<&serde_json::Value>, StorageError> {
        if !is_valid_key(key) {
            return Err(StorageError::InvalidKey);
        }
        Ok(self.entries.get(key))
    }

    /// Stores `value` under `key`, enforcing both limits.
    pub fn set(&mut self, key: &str, value: serde_json::Value) -> Result<(), StorageError> {
        if !is_valid_key(key) {
            return Err(StorageError::InvalidKey);
        }
        if json_len(&value) > MAX_VALUE_BYTES {
            return Err(StorageError::ValueTooLarge);
        }
        let previous = self.entries.insert(key.to_owned(), value);
        if json_len(&self.entries) > MAX_TOTAL_BYTES {
            match previous {
                Some(p) => self.entries.insert(key.to_owned(), p),
                None => self.entries.remove(key),
            };
            return Err(StorageError::QuotaExceeded);
        }
        Ok(())
    }

    /// Removes `key`. Removing a missing key is not an error.
    pub fn delete(&mut self, key: &str) -> Result<(), StorageError> {
        if !is_valid_key(key) {
            return Err(StorageError::InvalidKey);
        }
        self.entries.remove(key);
        Ok(())
    }

    /// All keys, sorted.
    pub fn keys(&self) -> Vec<String> {
        self.entries.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_follow_the_pattern() {
        assert!(is_valid_key("presets.v1"));
        assert!(is_valid_key(&"a".repeat(128)));
        for bad in ["", "한글", "a b", "a/b", &"a".repeat(129)] {
            assert!(!is_valid_key(bad), "{bad}");
        }
    }

    #[test]
    fn set_get_delete_round_trip() {
        let mut s = Store::default();
        s.set("presets", json!([300, 600])).unwrap();
        assert_eq!(s.get("presets").unwrap(), Some(&json!([300, 600])));
        assert_eq!(s.keys(), vec!["presets".to_owned()]);
        let restored = Store::from_json(&s.to_json()).unwrap();
        assert_eq!(restored, s);
        s.delete("presets").unwrap();
        assert_eq!(s.get("presets").unwrap(), None);
        assert_eq!(s.get("bad key"), Err(StorageError::InvalidKey));
    }

    #[test]
    fn enforces_value_and_total_limits() {
        let mut s = Store::default();
        let big = "x".repeat(MAX_VALUE_BYTES);
        assert_eq!(s.set("big", json!(big)), Err(StorageError::ValueTooLarge));

        let chunk = "y".repeat(MAX_VALUE_BYTES - 16);
        let mut stored = 0;
        let err = loop {
            match s.set(&format!("k{stored}"), json!(chunk)) {
                Ok(()) => stored += 1,
                Err(e) => break e,
            }
        };
        assert_eq!(err, StorageError::QuotaExceeded);
        assert_eq!(
            s.keys().len(),
            stored,
            "failed set leaves the store unchanged"
        );
        assert!(stored >= 19);
    }

    #[test]
    fn corrupt_file_is_rejected() {
        assert!(Store::from_json(b"{not json").is_none());
    }
}
