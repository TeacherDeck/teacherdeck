// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Typed messaging bridge. Provider paths, selectors, account bindings and confirmation stay private.
use super::{parse_args, to_value};
use crate::messaging_host::{AttachmentInput, MessagingService};
use crate::state::{AppState, FileHandleKind};
use deck_core::caps::messaging::*;
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, Webview};

/// Exactly six registered public methods.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Connect,
    Recipients,
    Plan,
    Start,
    Status,
    Cancel,
}
impl Op {
    /// Reject arbitrary native application methods.
    pub fn parse(method: &str) -> Option<Self> {
        match method {
            "connect" => Some(Self::Connect),
            "recipients" => Some(Self::Recipients),
            "plan" => Some(Self::Plan),
            "start" => Some(Self::Start),
            "status" => Some(Self::Status),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Connect => "connect",
            Self::Recipients => "recipients",
            Self::Plan => "plan",
            Self::Start => "start",
            Self::Status => "status",
            Self::Cancel => "cancel",
        }
    }
}
fn failure() -> DeckError {
    DeckError::new(ErrorCode::Internal, "메신저 연동 상태를 확인하지 못했어요.")
}
fn authorize(
    app: &AppHandle,
    owner: &str,
    op: Op,
    expected: Option<u64>,
) -> Result<u64, DeckError> {
    let state = app.state::<AppState>();
    let generation = state
        .transfers
        .lock()
        .map_err(|_| failure())?
        .generation(owner);
    if expected.is_some_and(|g| g != generation) {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "도구 연결이 바뀌었어요. 다시 연결해 주세요.",
        ));
    }
    let modules = state.modules.read().map_err(|_| failure())?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "messaging", op.name())?;
    Ok(generation)
}
fn attachments(
    app: &AppHandle,
    owner: &str,
    generation: u64,
    args: &MessagingPlanArgs,
) -> Result<Vec<AttachmentInput>, DeckError> {
    let handles: HashSet<_> = args
        .messages
        .iter()
        .flat_map(|m| &m.attachment_handles)
        .collect();
    if handles.is_empty() {
        return Ok(vec![]);
    }
    let state = app.state::<AppState>();
    let modules = state.modules.read().map_err(|_| failure())?;
    crate::bridge::authorize(&modules, &state.host_caps, owner, "fs", "openRead")?;
    drop(modules);
    let mut inputs = Vec::with_capacity(handles.len());
    for handle in handles {
        let path = super::fs::resolve(
            &state,
            owner,
            handle,
            generation,
            Some(FileHandleKind::ReadFile),
        )?;
        let info = super::fs::file_info(handle.clone(), &path).map_err(|_| failure())?;
        inputs.push(AttachmentInput {
            handle: handle.clone(),
            path,
            label: info.name,
        });
    }
    Ok(inputs)
}
/// Each call is authorized by both the bridge and this route; start is reconfirmed after dialog.
pub async fn route(app: &AppHandle, owner: &str, op: Op, args: Value) -> Result<Value, DeckError> {
    let generation = authorize(app, owner, op, None)?;
    if op == Op::Start {
        let request: MessagingStartArgs = parse_args(args)?;
        reject_module_confirmation(&request)?;
        let worker_app = app.clone();
        let worker_owner = owner.to_owned();
        let handle = request.plan_handle.clone();
        let name = {
            let state = app.state::<AppState>();
            let modules = state.modules.read().map_err(|_| failure())?;
            modules
                .runnable(owner)
                .ok_or_else(failure)?
                .manifest
                .name
                .clone()
        };
        let pending = tauri::async_runtime::spawn_blocking(move || {
            worker_app.state::<MessagingService>().request_confirmation(
                &worker_owner,
                &name,
                generation,
                &handle,
            )
        })
        .await
        .map_err(|_| failure())??;
        let confirmed = if let Some(wait) = pending {
            let id = wait.id;
            let answer = tauri::async_runtime::spawn_blocking(move || {
                wait.answer.recv_timeout(wait.remaining)
            })
            .await
            .map_err(|_| failure())?;
            app.state::<MessagingService>().cancel_confirmation(&id);
            let accepted = answer.map_err(|_| {
                DeckError::new(
                    ErrorCode::Timeout,
                    "등록 확인 시간이 지났어요. 미리보기를 다시 확인해 주세요.",
                )
            })?;
            if !accepted {
                return Err(DeckError::new(
                    ErrorCode::Cancelled,
                    "예약 등록을 취소했어요. 미리보기를 다시 확인할 수 있어요.",
                ));
            }
            true
        } else {
            false
        };
        authorize(app, owner, op, Some(generation))?;
        let worker_app = app.clone();
        let worker_owner = owner.to_owned();
        let started = tauri::async_runtime::spawn_blocking(move || {
            authorize(&worker_app, &worker_owner, Op::Start, Some(generation))?;
            worker_app.state::<MessagingService>().start(
                &worker_owner,
                generation,
                &request.plan_handle,
                confirmed,
            )
        })
        .await
        .map_err(|_| failure())??;
        let guard_app = app.clone();
        let guard_owner = owner.to_owned();
        let stop = started.stop;
        let finished = started.finished;
        // The worker's original engine also binds the live self-account before every action.
        // A separate own-child handle cancels even when a private request is blocked.
        std::thread::spawn(move || {
            while !finished.load(Ordering::Acquire) {
                if authorize(&guard_app, &guard_owner, Op::Start, Some(generation)).is_err() {
                    stop.stop();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        });
        return to_value(&started.run);
    }
    let worker_app = app.clone();
    let worker_owner = owner.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        authorize(&worker_app, &worker_owner, op, Some(generation))?;
        let service = worker_app.state::<MessagingService>();
        match op {
            Op::Connect => {
                let _: MessagingConnectArgs = parse_args(args)?;
                to_value(&service.connect(&worker_owner, generation)?)
            }
            Op::Recipients => {
                let request: MessagingRecipientsArgs = parse_args(args)?;
                to_value(&service.recipients(
                    &worker_owner,
                    generation,
                    &request.connection_handle,
                )?)
            }
            Op::Plan => {
                let request: MessagingPlanArgs = parse_args(args)?;
                request.validate()?;
                let inputs = attachments(&worker_app, &worker_owner, generation, &request)?;
                to_value(&service.plan(&worker_owner, generation, request, inputs)?)
            }
            Op::Status => {
                let request: MessagingStatusArgs = parse_args(args)?;
                to_value(&service.status(&worker_owner, generation, &request.run_handle)?)
            }
            Op::Cancel => {
                let request: MessagingCancelArgs = parse_args(args)?;
                to_value(&service.cancel(&worker_owner, generation, &request.run_handle)?)
            }
            Op::Start => Err(failure()),
        }
    })
    .await
    .map_err(|_| failure())?
}
fn trusted(webview: &Webview) -> Result<(), DeckError> {
    let url = webview.url().map_err(|_| failure())?;
    if webview.label() != crate::origins::MAIN_WINDOW
        || !crate::origins::shell_origins().contains(&url.origin().ascii_serialization().as_str())
    {
        return Err(DeckError::new(
            ErrorCode::PermissionDenied,
            "호스트 확인 창에서만 사용할 수 있어요.",
        ));
    }
    Ok(())
}
/// Main-shell-only full immutable message previews; iframe IPC cannot read this channel.
#[tauri::command]
pub fn messaging_pending_confirmations(
    webview: Webview,
    app: AppHandle,
) -> Result<Vec<MessagingApprovalRequest>, DeckError> {
    trusted(&webview)?;
    app.state::<MessagingService>().pending_confirmations()
}
/// Main-shell-only single-use decision, bound again to installed/granted module and generation.
#[tauri::command]
pub fn messaging_resolve_confirmation(
    webview: Webview,
    app: AppHandle,
    args: MessagingApprovalResolution,
) -> Result<(), DeckError> {
    trusted(&webview)?;
    let service = app.state::<MessagingService>();
    let (owner, generation) = service.confirmation_owner(&args.confirmation_id)?;
    if args.allow {
        authorize(&app, &owner, Op::Start, Some(generation))?;
    }
    service.resolve_confirmation(args)
}
fn reject_module_confirmation(args: &MessagingStartArgs) -> Result<(), DeckError> {
    if args.confirmation.is_some() {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "등록 확인은 호스트 확인 창에서 진행해 주세요.",
        ));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn arbitrary_provider_commands_and_iframe_confirmation_are_rejected() {
        assert!(Op::parse("executePython").is_none());
        assert!(
            reject_module_confirmation(&MessagingStartArgs {
                plan_handle: "synthetic".into(),
                confirmation: Some("예약 등록".into())
            })
            .is_err()
        );
        assert!(
            reject_module_confirmation(&MessagingStartArgs {
                plan_handle: "synthetic".into(),
                confirmation: None
            })
            .is_ok()
        );
    }
}
