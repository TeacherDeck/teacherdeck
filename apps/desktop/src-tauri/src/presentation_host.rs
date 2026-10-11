// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Owner-isolated public-only presentation windows (ADR-0025).

use deck_core::caps::presentation::*;
use deck_core::{DeckError, ErrorCode};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Monitor, Webview, WebviewUrl, WebviewWindowBuilder};

const CHANGED: &str = "deck://presentation-changed";

#[derive(Clone, Debug, PartialEq)]
struct DisplayKey {
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}

impl From<&Monitor> for DisplayKey {
    fn from(m: &Monitor) -> Self {
        Self {
            name: m.name().cloned(),
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
        }
    }
}

struct OwnedDisplay {
    owner: String,
    display: DisplayKey,
}
struct Session {
    owner: String,
    label: String,
    topology: Vec<DisplayKey>,
    state: PresentationViewState,
}

#[derive(Default)]
struct Inner {
    displays: HashMap<String, OwnedDisplay>,
    sessions: HashMap<String, Session>,
    closed: bool,
}

impl Inner {
    fn unload(&mut self, owner: &str) -> Vec<String> {
        self.displays.retain(|_, display| display.owner != owner);
        let mut labels = Vec::new();
        self.sessions.retain(|_, session| {
            if session.owner == owner {
                labels.push(session.label.clone());
                false
            } else {
                true
            }
        });
        labels
    }
    fn shutdown(&mut self) -> Vec<String> {
        self.closed = true;
        self.displays.clear();
        self.sessions
            .drain()
            .map(|(_, session)| session.label)
            .collect()
    }
}

/// Host-owned presentation authority, never persisted to disk.
#[derive(Default)]
pub struct PresentationService {
    inner: Mutex<Inner>,
}

fn denied() -> DeckError {
    DeckError::new(ErrorCode::PermissionDenied, "학생 화면을 다시 열어 주세요.")
}
fn internal() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "학생 화면을 표시하지 못했어요. 모니터 연결을 확인해 주세요.",
    )
}
fn token() -> Result<String, DeckError> {
    let mut bytes = [0; 24];
    getrandom::fill(&mut bytes).map_err(|_| internal())?;
    Ok(format!("p_{}", deck_core::util::to_hex(&bytes)))
}
fn topology(app: &AppHandle) -> Result<Vec<DisplayKey>, DeckError> {
    let mut result: Vec<_> = app
        .available_monitors()
        .map_err(|_| internal())?
        .iter()
        .map(DisplayKey::from)
        .collect();
    result.sort_by(|a, b| {
        (a.x, a.y, a.width, a.height, &a.name).cmp(&(b.x, b.y, b.width, b.height, &b.name))
    });
    Ok(result)
}
fn live_owner(app: &AppHandle, owner: &str) -> Result<(), DeckError> {
    let state = app.state::<crate::state::AppState>();
    let modules = state.modules.read().map_err(|_| internal())?;
    crate::bridge::authorize(
        &modules,
        &state.host_caps,
        owner,
        "window",
        "openPresentation",
    )
    .map(|_| ())
}

/// Issues fresh, owner-scoped handles for the currently connected monitors.
pub fn list_displays(app: &AppHandle, owner: &str) -> Result<Vec<PresentationDisplay>, DeckError> {
    let monitors = app.available_monitors().map_err(|_| internal())?;
    if monitors.len() > 64 {
        return Err(internal());
    }
    let primary = app
        .primary_monitor()
        .map_err(|_| internal())?
        .as_ref()
        .map(DisplayKey::from);
    let mut records = Vec::new();
    for (index, monitor) in monitors.iter().enumerate() {
        let display = DisplayKey::from(monitor);
        let handle = token()?;
        let result = PresentationDisplay {
            display_handle: handle.clone(),
            label: format!(
                "화면 {} · {} × {}",
                index + 1,
                display.width,
                display.height
            ),
            primary: primary.as_ref() == Some(&display),
            width: display.width,
            height: display.height,
            scale_factor: display.scale,
        };
        records.push((
            handle,
            OwnedDisplay {
                owner: owner.into(),
                display,
            },
            result,
        ));
    }
    let service = app.state::<PresentationService>();
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    if inner.closed {
        return Err(denied());
    }
    inner.displays.retain(|_, value| value.owner != owner);
    let mut result = Vec::new();
    for (handle, record, description) in records {
        inner.displays.insert(handle, record);
        result.push(description);
    }
    Ok(result)
}

fn owner_session<'a>(
    inner: &'a mut Inner,
    owner: &str,
    handle: &str,
) -> Result<&'a mut Session, DeckError> {
    let session = inner.sessions.get_mut(handle).ok_or_else(denied)?;
    if session.owner != owner {
        return Err(denied());
    }
    Ok(session)
}

/// Creates one local shell window after validating the selected public snapshot.
pub fn open(
    app: &AppHandle,
    owner: &str,
    args: OpenPresentationArgs,
) -> Result<PresentationSession, DeckError> {
    args.payload.validate()?;
    let current = topology(app)?;
    let handle = token()?;
    let label = format!("presentation-{handle}");
    let display = {
        let service = app.state::<PresentationService>();
        let mut inner = service.inner.lock().map_err(|_| internal())?;
        if inner.closed {
            return Err(denied());
        }
        let selected = inner
            .displays
            .get(&args.display_handle)
            .ok_or_else(denied)?;
        if selected.owner != owner || !current.contains(&selected.display) {
            return Err(denied());
        }
        let display = selected.display.clone();
        if inner.sessions.len() >= 4
            || inner
                .sessions
                .values()
                .any(|session| session.owner == owner)
        {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "열려 있는 학생 화면을 먼저 닫아 주세요.",
            ));
        }
        inner.sessions.insert(
            handle.clone(),
            Session {
                owner: owner.into(),
                label: label.clone(),
                topology: current,
                state: PresentationViewState {
                    payload: Some(args.payload),
                    revision: 0,
                    disconnected: false,
                },
            },
        );
        display
    };
    let built = (|| {
        let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("presentation".into()))
            .title("TeacherDeck 학생 화면")
            .decorations(false)
            .visible(false)
            .build()
            .map_err(|_| internal())?;
        let configured = window
            .set_position(tauri::PhysicalPosition::new(display.x, display.y))
            .and_then(|()| window.set_size(tauri::PhysicalSize::new(display.width, display.height)))
            .and_then(|()| window.set_fullscreen(true));
        if configured.is_err() {
            let _ = window.destroy();
            return Err(internal());
        }
        let event_app = app.clone();
        let event_handle = handle.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                forget_window(&event_app, &event_handle);
            }
        });
        // unload removes the reserved session even if native window construction is still pending.
        let service = app.state::<PresentationService>();
        let pending = service.inner.lock().map_err(|_| internal())?;
        if !pending.sessions.contains_key(&handle) {
            drop(pending);
            let _ = window.destroy();
            return Err(denied());
        }
        drop(pending);
        window.show().map_err(|_| {
            let _ = window.destroy();
            internal()
        })?;
        // Cover an unload racing with show; a missing session must never leave an orphan fullscreen view.
        if !service
            .inner
            .lock()
            .map_err(|_| internal())?
            .sessions
            .contains_key(&handle)
        {
            let _ = window.destroy();
            return Err(denied());
        }
        Ok(())
    })();
    if let Err(error) = built {
        forget_window(app, &handle);
        return Err(error);
    }
    Ok(PresentationSession {
        presentation_handle: handle,
        revision: 0,
    })
}

fn apply_update(
    session: &mut Session,
    args: UpdatePresentationArgs,
) -> Result<PresentationSession, DeckError> {
    args.payload.validate()?;
    if session.state.disconnected || args.revision <= session.state.revision {
        return Err(denied());
    }
    session.state.payload = Some(args.payload);
    session.state.revision = args.revision;
    Ok(PresentationSession {
        presentation_handle: args.presentation_handle,
        revision: args.revision,
    })
}

/// Publishes only a newer explicit public result to the owner's window.
pub fn update(
    app: &AppHandle,
    owner: &str,
    args: UpdatePresentationArgs,
) -> Result<PresentationSession, DeckError> {
    refresh_monitors(app);
    let (label, result) = {
        let service = app.state::<PresentationService>();
        let mut inner = service.inner.lock().map_err(|_| internal())?;
        let session = owner_session(&mut inner, owner, &args.presentation_handle)?;
        let label = session.label.clone();
        let result = apply_update(session, args)?;
        (label, result)
    };
    if app.emit_to(&label, CHANGED, result.revision).is_err() {
        // A failed delivery must not strand the owner on an old revision or leave stale names visible.
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        forget_window(app, &result.presentation_handle);
        return Err(internal());
    }
    Ok(result)
}

fn forget_window(app: &AppHandle, handle: &str) {
    let service = app.state::<PresentationService>();
    let removed = service
        .inner
        .lock()
        .ok()
        .and_then(|mut inner| inner.sessions.remove(handle));
    if let Some(session) = removed {
        let _ = app.emit_to(crate::origins::MAIN_WINDOW, "deck://module-event", serde_json::json!({
            "moduleId":session.owner,"topic":"window.presentationClosed","payload":{"presentationHandle":handle}
        }));
    }
}

/// Closes an owned public window; foreign references are always refused.
pub fn close(app: &AppHandle, owner: &str, args: ClosePresentationArgs) -> Result<(), DeckError> {
    let label = {
        let service = app.state::<PresentationService>();
        let mut inner = service.inner.lock().map_err(|_| internal())?;
        owner_session(&mut inner, owner, &args.presentation_handle)?
            .label
            .clone()
    };
    if let Some(window) = app.get_webview_window(&label) {
        window.destroy().map_err(|_| internal())?;
    }
    forget_window(app, &args.presentation_handle);
    Ok(())
}

/// Clears data immediately when the module is removed; hidden modules may keep their public result.
pub fn unload(app: &AppHandle, owner: &str) {
    let labels = {
        let service = app.state::<PresentationService>();
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        inner.unload(owner)
    };
    dispose_views(app, labels);
}

/// Actual main-window destruction ends every public view, including pending creations.
/// Hiding the main window for background capture does not call this boundary.
pub fn shutdown(app: &AppHandle) {
    let service = app.state::<PresentationService>();
    let labels = match service.inner.lock() {
        Ok(mut inner) => inner.shutdown(),
        Err(_) => return,
    };
    dispose_views(app, labels);
}

fn dispose_views(app: &AppHandle, labels: Vec<String>) {
    for label in labels {
        // A view whose native close fails still refreshes to an empty, denied session.
        let _ = app.emit_to(&label, CHANGED, 0_u32);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.hide();
            let _ = window.destroy();
        }
    }
}

/// Fails closed on display changes or failed enumeration, called periodically by the host.
pub fn refresh_monitors(app: &AppHandle) {
    let service = app.state::<PresentationService>();
    if service
        .inner
        .lock()
        .is_ok_and(|inner| inner.sessions.is_empty())
    {
        return;
    }
    let current = topology(app).ok();
    let labels = {
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        inner
            .sessions
            .iter_mut()
            .filter_map(|(handle, session)| {
                if !session.state.disconnected && current.as_ref() != Some(&session.topology) {
                    session.state.payload = None;
                    session.state.disconnected = true;
                    Some((
                        session.label.clone(),
                        session.state.revision,
                        session.owner.clone(),
                        handle.clone(),
                    ))
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    };
    for (label, revision, owner, handle) in labels {
        if app.emit_to(&label, CHANGED, revision).is_err() {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
            forget_window(app, &handle);
        }
        let _ = app.emit_to(crate::origins::MAIN_WINDOW, "deck://module-event", serde_json::json!({
            "moduleId":owner,"topic":"window.presentationDisconnected","payload":{"presentationHandle":handle}
        }));
    }
}

fn trusted(app: &AppHandle, webview: &Webview) -> Result<(String, String), DeckError> {
    let url = webview.url().map_err(|_| denied())?;
    if url.path() != "/presentation"
        || !crate::origins::shell_origins().contains(&url.origin().ascii_serialization().as_str())
    {
        return Err(denied());
    }
    let service = app.state::<PresentationService>();
    let inner = service.inner.lock().map_err(|_| internal())?;
    let (handle, session) = inner
        .sessions
        .iter()
        .find(|(_, session)| session.label == webview.label())
        .ok_or_else(denied)?;
    let identity = (handle.clone(), session.owner.clone());
    drop(inner);
    live_owner(app, &identity.1)?;
    Ok(identity)
}

/// Only the fixed local presentation shell may read its own public snapshot.
#[tauri::command]
pub fn presentation_ui_state(
    app: AppHandle,
    webview: Webview,
) -> Result<PresentationViewState, DeckError> {
    let (handle, owner) = trusted(&app, &webview)?;
    refresh_monitors(&app);
    let service = app.state::<PresentationService>();
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    Ok(owner_session(&mut inner, &owner, &handle)?.state.clone())
}

/// Escape/close affects only the caller's verified local public window.
#[tauri::command]
pub fn presentation_ui_close(app: AppHandle, webview: Webview) -> Result<(), DeckError> {
    let (handle, owner) = trusted(&app, &webview)?;
    close(
        &app,
        &owner,
        ClosePresentationArgs {
            presentation_handle: handle,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload() -> PresentationPayload {
        PresentationPayload {
            kind: PresentationKind::Picker,
            title: "발표자".into(),
            columns: None,
            items: vec![PresentationItem {
                label: "1 학생가".into(),
                group: None,
                row: None,
                column: None,
            }],
        }
    }
    fn inner() -> Inner {
        let mut inner = Inner::default();
        inner.sessions.insert(
            "owned".into(),
            Session {
                owner: "picker".into(),
                label: "presentation-owned".into(),
                topology: vec![],
                state: PresentationViewState {
                    payload: Some(payload()),
                    revision: 3,
                    disconnected: false,
                },
            },
        );
        inner
    }
    #[test]
    fn rejects_foreign_and_missing_sessions() {
        let mut inner = inner();
        assert!(owner_session(&mut inner, "other", "owned").is_err());
        assert!(owner_session(&mut inner, "picker", "missing").is_err());
        assert!(owner_session(&mut inner, "picker", "owned").is_ok());
    }
    #[test]
    fn main_shutdown_releases_all_owners_and_pending_sessions() {
        let mut inner = inner();
        inner.sessions.insert(
            "pending".into(),
            Session {
                owner: "seats".into(),
                label: "presentation-pending".into(),
                topology: vec![],
                state: PresentationViewState {
                    payload: Some(payload()),
                    revision: 0,
                    disconnected: false,
                },
            },
        );
        inner.displays.insert(
            "display".into(),
            OwnedDisplay {
                owner: "picker".into(),
                display: DisplayKey {
                    name: None,
                    x: 0,
                    y: 0,
                    width: 1280,
                    height: 720,
                    scale: 1.0,
                },
            },
        );
        let mut labels = inner.shutdown();
        labels.sort();
        assert_eq!(labels, ["presentation-owned", "presentation-pending"]);
        assert!(inner.closed);
        assert!(inner.sessions.is_empty());
        assert!(inner.displays.is_empty());
        assert!(owner_session(&mut inner, "picker", "owned").is_err());
        assert!(inner.shutdown().is_empty());
    }
    #[test]
    fn unload_revokes_only_the_owner_before_native_destruction() {
        let mut inner = inner();
        assert!(inner.unload("other").is_empty());
        assert_eq!(inner.sessions.len(), 1);
        assert_eq!(inner.unload("picker"), ["presentation-owned"]);
        assert!(inner.sessions.is_empty());
        assert!(!inner.closed);
        assert!(owner_session(&mut inner, "picker", "owned").is_err());
    }
    #[test]
    fn stale_or_invalid_updates_keep_previous_public_data() {
        let mut inner = inner();
        let session = owner_session(&mut inner, "picker", "owned").expect("synthetic owner");
        let previous = session.state.clone();
        let args = UpdatePresentationArgs {
            presentation_handle: "owned".into(),
            revision: 3,
            payload: payload(),
        };
        assert!(apply_update(session, args.clone()).is_err());
        assert_eq!(session.state, previous);
        let mut invalid = args.clone();
        invalid.revision = 4;
        invalid.payload.items.clear();
        assert!(apply_update(session, invalid).is_err());
        assert_eq!(session.state, previous);
        let mut valid = args;
        valid.revision = 4;
        assert!(apply_update(session, valid.clone()).is_ok());
        session.state.payload = None;
        session.state.disconnected = true;
        valid.revision = 5;
        assert!(apply_update(session, valid).is_err());
        assert_eq!(session.state.payload, None);
    }
}
