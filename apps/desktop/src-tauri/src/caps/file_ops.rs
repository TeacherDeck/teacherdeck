// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Authorized file-ops routes. Confirmation is owned by the host, never the iframe.
use super::{internal, parse_args, to_value};
use crate::state::{AppState, FileHandleKind};
use deck_core::{DeckError, ErrorCode, caps::file_ops::*};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
/// File-ops methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    /// Plans a bounded exact-name batch.
    PlanRename,
    /// Advances one connected batch group.
    ExecuteRename,
    /// Lists opaque persistent summaries.
    ListHistory,
    /// Advances one protected restore group.
    UndoRename,
}
impl Op {
    /// Method name mapping used by route coverage tests.
    pub fn parse(method: &str) -> Option<Self> {
        Some(match method {
            "planRename" => Self::PlanRename,
            "executeRename" => Self::ExecuteRename,
            "listHistory" => Self::ListHistory,
            "undoRename" => Self::UndoRename,
            _ => return None,
        })
    }
    fn method(self) -> &'static str {
        match self {
            Self::PlanRename => "planRename",
            Self::ExecuteRename => "executeRename",
            Self::ListHistory => "listHistory",
            Self::UndoRename => "undoRename",
        }
    }
}
fn authorize(state: &AppState, owner: &str, op: Op, generation: u64) -> Result<(), DeckError> {
    let store = state.modules.read().map_err(|_| internal())?;
    crate::bridge::authorize(&store, &state.host_caps, owner, "file-ops", op.method())?;
    if state
        .transfers
        .lock()
        .map_err(|_| internal())?
        .generation(owner)
        != generation
    {
        return Err(DeckError::new(
            ErrorCode::Cancelled,
            "변경 작업의 권한이 종료됐어요. 도구를 다시 열어 주세요.",
        ));
    }
    Ok(())
}
/// Async outer adapter; native dialog and disk/hash work run away from the UI thread.
pub async fn call(
    app: &AppHandle,
    state: &AppState,
    owner: &str,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    let generation = state
        .transfers
        .lock()
        .map_err(|_| internal())?
        .generation(owner);
    authorize(state, owner, op, generation)?;
    let confirm = match op {
        Op::ExecuteRename => {
            let request: ExecuteRenameArgs = parse_args(args.clone())?;
            state
                .file_ops
                .lock()
                .map_err(|_| internal())?
                .needs_confirmation(owner, generation, &request.plan_handle)?
        }
        Op::UndoRename => {
            let request: UndoRenameArgs = parse_args(args.clone())?;
            state
                .file_ops
                .lock()
                .map_err(|_| internal())?
                .undo_needs_confirmation(owner, &request.history_handle)?
        }
        _ => false,
    };
    if confirm {
        let message = if op == Op::ExecuteRename {
            "계획한 원본 파일의 이름을 변경할까요? 같은 폴더 안에서만 바꾸며 기존 파일을 덮어쓰지 않아요. 변경·교체된 결과는 자동으로 되돌리지 않아요."
        } else {
            "확인한 원본 이름 변경을 되돌릴까요? 파일 ID·내용·수정 시각·기존 이름을 검사하며 바뀐 파일과 충돌한 파일은 보존해요."
        };
        let dialog = app
            .dialog()
            .message(message)
            .title("원본 파일 변경 확인")
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel);
        let accepted = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
            .await
            .map_err(|_| internal())?;
        if !accepted {
            return Err(DeckError::new(
                ErrorCode::Cancelled,
                "원본 이름 변경을 취소했어요.",
            ));
        }
        authorize(state, owner, op, generation)?;
        let mut service = state.file_ops.lock().map_err(|_| internal())?;
        match op {
            Op::ExecuteRename => {
                let request: ExecuteRenameArgs = parse_args(args.clone())?;
                service.confirm(owner, generation, &request.plan_handle)?;
            }
            Op::UndoRename => {
                let request: UndoRenameArgs = parse_args(args.clone())?;
                service.confirm_undo(owner, &request.history_handle)?;
            }
            _ => {}
        }
    }
    let app = app.clone();
    let owner = owner.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        authorize(&state, &owner, op, generation)?;
        invoke(&state, &owner, generation, op, args)
    })
    .await
    .map_err(|_| internal())?
}
/// Pure dispatch target used by scoped host tests, after the outer adapter authorizes.
pub(crate) fn invoke(
    state: &AppState,
    owner: &str,
    generation: u64,
    op: Op,
    args: Value,
) -> Result<Value, DeckError> {
    authorize(state, owner, op, generation)?;
    match op {
        Op::PlanRename => {
            let request: PlanRenameArgs = parse_args(args)?;
            if request.items.is_empty() || request.items.len() > 2000 {
                return Err(DeckError::new(
                    ErrorCode::InvalidArgs,
                    "계획할 파일은1~2,000개여야 해요.",
                ));
            }
            let inputs = request
                .items
                .into_iter()
                .map(|item| {
                    let path = super::fs::resolve(
                        state,
                        owner,
                        &item.source_handle,
                        generation,
                        Some(FileHandleKind::ReadFile),
                    )?;
                    Ok((item.source_handle, path, item.target_name))
                })
                .collect::<Result<Vec<_>, DeckError>>()?;
            to_value(
                &state
                    .file_ops
                    .lock()
                    .map_err(|_| internal())?
                    .plan(owner, generation, inputs)?,
            )
        }
        Op::ExecuteRename => {
            let request: ExecuteRenameArgs = parse_args(args)?;
            to_value(&state.file_ops.lock().map_err(|_| internal())?.execute(
                owner,
                generation,
                &request.plan_handle,
            )?)
        }
        Op::ListHistory => {
            let request: ListHistoryArgs = parse_args(args)?;
            to_value(
                &state
                    .file_ops
                    .lock()
                    .map_err(|_| internal())?
                    .history(owner, request)?,
            )
        }
        Op::UndoRename => {
            let request: UndoRenameArgs = parse_args(args)?;
            to_value(
                &state
                    .file_ops
                    .lock()
                    .map_err(|_| internal())?
                    .undo(owner, &request.history_handle)?,
            )
        }
    }
}
