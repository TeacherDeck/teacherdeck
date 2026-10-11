// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Typed network capability dispatch. GUI never mutates OS network settings directly.
use super::{parse_args, to_value};
use crate::state::AppState;
use deck_core::caps::network::*;
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use tauri::{AppHandle, Manager};
/// Fixed network methods from the capability registry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Discover adapters.
    Adapters,
    /// Observe one adapter.
    Inspect,
    /// Save profile only.
    SaveProfile,
    /// Register fixed automation.
    Configure,
    /// Restore saved status.
    Status,
    /// Evaluate saved rules.
    Evaluate,
    /// Apply a saved fixed mode.
    Apply,
    /// Remove owned tasks, retain IP.
    Stop,
}
impl Op {
    /// Accept only known operations.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "adapters" => Some(Self::Adapters),
            "inspect" => Some(Self::Inspect),
            "saveProfile" => Some(Self::SaveProfile),
            "configureRoutine" => Some(Self::Configure),
            "status" => Some(Self::Status),
            "evaluate" => Some(Self::Evaluate),
            "apply" => Some(Self::Apply),
            "stopRoutine" => Some(Self::Stop),
            _ => None,
        }
    }
    fn method(self) -> &'static str {
        match self {
            Self::Adapters => "adapters",
            Self::Inspect => "inspect",
            Self::SaveProfile => "saveProfile",
            Self::Configure => "configureRoutine",
            Self::Status => "status",
            Self::Evaluate => "evaluate",
            Self::Apply => "apply",
            Self::Stop => "stopRoutine",
        }
    }
}
/// Offloads blocking WMI/COM/UAC work to one owned service transaction.
pub async fn call(
    app: &AppHandle,
    _state: &AppState,
    owner: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    let app = app.clone();
    let owner = owner.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        crate::network_host::authorize_current(&app, &owner, op.method())?;
        let service = app.state::<crate::network_host::NetworkService>();
        match op {
            Op::Adapters => {
                let _: deck_core::caps::NoArgs = parse_args(args)?;
                to_value(&service.adapters(&owner)?)
            }
            Op::Inspect => {
                let args: NetworkInspectArgs = parse_args(args)?;
                to_value(&service.inspect(&owner, &args)?)
            }
            Op::SaveProfile => {
                let args: NetworkSaveProfileArgs = parse_args(args)?;
                to_value(&service.save_profile(&owner, &args)?)
            }
            Op::Configure => {
                let args: NetworkConfigureArgs = parse_args(args)?;
                to_value(&service.configure(&owner, &args)?)
            }
            Op::Status => {
                let args: NetworkStatusArgs = parse_args(args)?;
                to_value(&service.status(&owner, &args)?)
            }
            Op::Evaluate => {
                let args: NetworkRoutineArgs = parse_args(args)?;
                to_value(&service.evaluate(&owner, &args)?)
            }
            Op::Apply => {
                let args: NetworkApplyArgs = parse_args(args)?;
                to_value(&service.apply(&owner, &args)?)
            }
            Op::Stop => {
                let args: NetworkRoutineArgs = parse_args(args)?;
                to_value(&service.stop(&owner, &args)?)
            }
        }
    })
    .await
    .map_err(|_| {
        DeckError::new(
            ErrorCode::Internal,
            "네트워크 작업을 확인하지 못했어요. 도구를 다시 열어 주세요.",
        )
    })?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_only_eight_fixed_methods() {
        for method in [
            "adapters",
            "inspect",
            "saveProfile",
            "configureRoutine",
            "status",
            "evaluate",
            "apply",
            "stopRoutine",
        ] {
            assert!(Op::parse(method).is_some());
        }
        assert!(Op::parse("runCommand").is_none());
    }
}
