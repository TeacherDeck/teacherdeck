// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `system` capability.

use deck_core::caps::NoArgs;
use deck_core::caps::system::SystemInfo;
use deck_core::error::DeckError;
use serde_json::Value;

use super::{parse_args, to_value};
use crate::platform::{locale, os_info};
use crate::state::AppState;

/// `system.info`
pub fn info(state: &AppState, args: Value) -> Result<Value, DeckError> {
    let NoArgs {} = parse_args(args)?;
    to_value(&SystemInfo {
        app_version: state.app_version.clone(),
        os: os_info(),
        locale: locale(),
    })
}
