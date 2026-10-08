// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Bridge error codes and the error payload returned to modules (bridge-protocol.md §1).
//! Messages must not contain paths, file names or user data (CAP-007, PRV-003).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Error codes a capability call can fail with. Adding a code is a spec change (DOC-002).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// The module did not declare, or is not granted, the capability or handle.
    PermissionDenied,
    /// The host has no such capability or method.
    CapabilityUnavailable,
    /// The capability version does not satisfy the declared range.
    VersionMismatch,
    /// Malformed arguments or an oversized message.
    InvalidArgs,
    /// The target (handle, key, ...) does not exist.
    NotFound,
    /// Cancelled by a `cancel` message.
    Cancelled,
    /// No response in time.
    Timeout,
    /// The host cannot handle this request right now.
    Busy,
    /// Internal host error.
    Internal,
}

/// Error payload of a failed `res` message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
pub struct DeckError {
    /// Machine-readable code.
    pub code: ErrorCode,
    /// Generic, PII-free message.
    pub message: String,
    /// Optional structured details (never user data).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub details: Option<serde_json::Value>,
}

impl DeckError {
    /// Creates an error without details.
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_spec_strings() {
        let json = serde_json::to_string(&ErrorCode::CapabilityUnavailable).unwrap();
        assert_eq!(json, "\"CAPABILITY_UNAVAILABLE\"");
        let err = DeckError::new(ErrorCode::NotFound, "핸들을 찾을 수 없어요.");
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({ "code": "NOT_FOUND", "message": "핸들을 찾을 수 없어요." })
        );
    }
}
