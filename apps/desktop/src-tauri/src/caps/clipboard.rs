// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Output-only OS clipboard, serialized on one dedicated thread (ADR-0016).
use super::parse_args;
use deck_core::caps::clipboard::{
    ClipboardWriteRichTextArgs, ClipboardWriteTextArgs, MAX_JSON_BYTES, RichOutput, prepare_rich,
    prepare_text,
};
use deck_core::error::{DeckError, ErrorCode};
use serde_json::Value;
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use tauri::{AppHandle, Manager};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Output methods from the capability registry.
pub enum Op {
    /// Plain UTF-8 text.
    Text,
    /// Escaped structured HTML with plain alternative.
    Rich,
}
impl Op {
    /// Select a known method name.
    pub fn parse(method: &str) -> Option<Self> {
        match method {
            "writeText" => Some(Self::Text),
            "writeRichText" => Some(Self::Rich),
            _ => None,
        }
    }
}
enum Output {
    Text(String),
    Rich(RichOutput),
}
struct Request {
    output: Output,
    reply: mpsc::Sender<Result<(), DeckError>>,
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "클립보드를 사용할 수 없어요. 잠시 후 다시 복사해 주세요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "이 PC에서 클립보드 출력을 사용할 수 없어요.",
    )
}
/// Bounded application-owned worker service. It never reads or logs clipboard contents.
pub struct ClipboardService {
    sender: SyncSender<Request>,
}
impl ClipboardService {
    /// Starts one OS worker; the channel holds at most one waiting output.
    pub fn new() -> Result<Self, DeckError> {
        Self::with_writer(write_native)
    }
    fn with_writer(
        mut write: impl FnMut(Output) -> Result<(), DeckError> + Send + 'static,
    ) -> Result<Self, DeckError> {
        let (sender, receiver) = mpsc::sync_channel::<Request>(1);
        std::thread::Builder::new()
            .name("deck-clipboard".into())
            .spawn(move || {
                while let Ok(request) = receiver.recv() {
                    let result = write(request.output);
                    let _ = request.reply.send(result);
                }
            })
            .map_err(|_| unavailable())?;
        Ok(Self { sender })
    }
    fn submit(&self, output: Output) -> Result<Receiver<Result<(), DeckError>>, DeckError> {
        let (reply, response) = mpsc::channel();
        self.sender
            .try_send(Request { output, reply })
            .map_err(|error| match error {
                TrySendError::Full(_) => busy(),
                TrySendError::Disconnected(_) => unavailable(),
            })?;
        Ok(response)
    }
}
fn prepare(op: Op, args: Value) -> Result<Output, DeckError> {
    if serde_json::to_vec(&args).map_or(usize::MAX, |v| v.len()) > MAX_JSON_BYTES {
        return Err(DeckError::new(
            ErrorCode::InvalidArgs,
            "복사할 내용이 너무 커요. 파일로 저장하거나 범위를 줄여 주세요.",
        ));
    }
    match op {
        Op::Text => prepare_text(parse_args::<ClipboardWriteTextArgs>(args)?).map(Output::Text),
        Op::Rich => prepare_rich(parse_args::<ClipboardWriteRichTextArgs>(args)?).map(Output::Rich),
    }
}
/// Runs an already-authorized clipboard request through the bounded worker.
pub async fn call(app: &AppHandle, op: Op, args: Value) -> Result<Value, DeckError> {
    let output = prepare(op, args)?;
    let service = app
        .try_state::<ClipboardService>()
        .ok_or_else(unavailable)?;
    let response = service.submit(output)?;
    tauri::async_runtime::spawn_blocking(move || response.recv().map_err(|_| unavailable())?)
        .await
        .map_err(|_| unavailable())??;
    Ok(Value::Null)
}
#[cfg(windows)]
fn write_native(output: Output) -> Result<(), DeckError> {
    use arboard::SetExtWindows;
    let mut clipboard = arboard::Clipboard::new().map_err(native_error)?;
    // Fixed privacy policy; modules cannot opt into Windows cloud/history retention.
    let setter = clipboard.set().exclude_from_cloud().exclude_from_history();
    match output {
        Output::Text(text) => setter.text(text),
        Output::Rich(RichOutput { html, plain_text }) => setter.html(html, Some(plain_text)),
    }
    .map_err(native_error)
}
#[cfg(windows)]
fn native_error(error: arboard::Error) -> DeckError {
    match error {
        arboard::Error::ClipboardOccupied => busy(),
        _ => DeckError::new(
            ErrorCode::Internal,
            "클립보드에 기록하지 못했어요. 다시 복사해 주세요.",
        ),
    }
}
#[cfg(not(windows))]
fn write_native(output: Output) -> Result<(), DeckError> {
    // Consume without exposing content; Windows is the supported product platform.
    match output {
        Output::Text(text) => drop(text),
        Output::Rich(rich) => drop(rich),
    }
    Err(unavailable())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_before_any_worker_submission() {
        assert!(prepare(Op::Text, serde_json::json!({"text":"\0"})).is_err());
        assert!(
            prepare(
                Op::Rich,
                serde_json::json!({"plainText":"","blocks":[{"kind":"html","html":"<script>"}]})
            )
            .is_err()
        );
        assert!(
            prepare(
                Op::Text,
                serde_json::json!({"text":"a".repeat(MAX_JSON_BYTES)})
            )
            .is_err()
        );
    }
    #[test]
    fn serializes_outputs_on_one_thread_and_reports_backend_errors() {
        let (events, received) = mpsc::channel();
        let service = ClipboardService::with_writer(move |output| {
            events.send(std::thread::current().id()).unwrap();
            match output {
                Output::Text(text) if text == "fail" => Err(busy()),
                _ => Ok(()),
            }
        })
        .unwrap();
        for text in ["one", "two"] {
            service
                .submit(Output::Text(text.into()))
                .unwrap()
                .recv()
                .unwrap()
                .unwrap();
        }
        assert_eq!(received.recv().unwrap(), received.recv().unwrap());
        assert_eq!(
            service
                .submit(Output::Text("fail".into()))
                .unwrap()
                .recv()
                .unwrap()
                .unwrap_err()
                .code,
            ErrorCode::Busy
        );
    }
    #[test]
    fn rejects_a_full_queue_without_unbounded_content_retention() {
        let (started, running) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let service = ClipboardService::with_writer(move |_| {
            started.send(()).unwrap();
            wait.recv().unwrap();
            Ok(())
        })
        .unwrap();
        let first = service.submit(Output::Text("one".into())).unwrap();
        running.recv().unwrap();
        let second = service.submit(Output::Text("two".into())).unwrap();
        assert_eq!(
            service
                .submit(Output::Text("three".into()))
                .unwrap_err()
                .code,
            ErrorCode::Busy
        );
        release.send(()).unwrap();
        first.recv().unwrap().unwrap();
        running.recv().unwrap();
        release.send(()).unwrap();
        second.recv().unwrap().unwrap();
    }
}
