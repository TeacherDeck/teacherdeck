// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `storage` capability (capabilities.md §2.1). Limits live in deck-core `caps::storage`.

use deck_core::caps::NoArgs;
use deck_core::caps::storage::{KeyArgs, SetArgs, StorageError};
use deck_core::error::{DeckError, ErrorCode};
use serde_json::Value;

use super::{internal, parse_args, to_value};
use crate::state::AppState;

/// Storage methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// `get`
    Get,
    /// `set`
    Set,
    /// `delete`
    Delete,
    /// `keys`
    Keys,
}

impl Op {
    /// Maps a method name.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "get" => Self::Get,
            "set" => Self::Set,
            "delete" => Self::Delete,
            "keys" => Self::Keys,
            _ => return None,
        })
    }
}

fn storage_error(e: &StorageError) -> DeckError {
    DeckError::new(ErrorCode::InvalidArgs, e.to_string())
}

/// Runs a storage method for `module_id` (PRV-007: one store per module).
pub fn call(state: &AppState, module_id: &str, op: Op, args: Value) -> Result<Value, DeckError> {
    let result = match op {
        Op::Get => {
            let KeyArgs { key } = parse_args(args)?;
            state.storage.with_store(module_id, |s| {
                (
                    s.get(&key).map(|v| v.cloned().unwrap_or(Value::Null)),
                    false,
                )
            })
        }
        Op::Set => {
            let SetArgs { key, value } = parse_args(args)?;
            state.storage.with_store(module_id, |s| {
                let r = s.set(&key, value).map(|()| Value::Null);
                let dirty = r.is_ok();
                (r, dirty)
            })
        }
        Op::Delete => {
            let KeyArgs { key } = parse_args(args)?;
            state.storage.with_store(module_id, |s| {
                let r = s.delete(&key).map(|()| Value::Null);
                let dirty = r.is_ok();
                (r, dirty)
            })
        }
        Op::Keys => {
            let NoArgs {} = parse_args(args)?;
            state
                .storage
                .with_store(module_id, |s| (Ok(Value::from(s.keys())), false))
        }
    };
    match result {
        Ok(inner) => inner
            .map_err(|e| storage_error(&e))
            .and_then(|v| to_value(&v)),
        Err(e) => {
            tracing::error!(module = %module_id, error = %e, "storage failure");
            Err(internal())
        }
    }
}
