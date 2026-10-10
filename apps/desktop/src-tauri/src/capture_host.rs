// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Host-owned capture handles survive iframe visibility changes, never app restart.
use crate::caps::{internal, parse_args, to_value};
use crate::platform::{OsRng, TempDir};
use crate::state::AppState;
use deck_core::caps::capture::*;
use deck_core::caps::global_shortcut::*;
use deck_core::caps::overlay::*;
use deck_core::handles::{HANDLE_BYTES, RandomSource};
use deck_core::{DeckError, ErrorCode};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};
struct Owned<T> {
    owner: String,
    value: T,
}
struct Overlay {
    info: OverlayInfo,
    label: String,
    toolbar: String,
}
struct Session {
    info: CaptureSession,
    last_trigger: Option<Instant>,
}
struct Shortcut {
    info: ShortcutInfo,
    _edge: Arc<ShortcutEdge>,
}
#[derive(Default)]
struct Inner {
    overlays: HashMap<String, Owned<Overlay>>,
    sessions: HashMap<String, Owned<Session>>,
    shortcuts: HashMap<String, Owned<Shortcut>>,
    temps: Vec<(TempDir, Instant)>,
    results: VecDeque<(String, String)>,
}
/// Serialized session/handle metadata, independent of a module iframe.
#[derive(Default)]
pub struct CaptureService {
    inner: Mutex<Inner>,
    busy: Arc<AtomicBool>,
    tray_ready: AtomicBool,
}
fn denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 도구가 받은 캡처 핸들이 아니에요.",
    )
}
fn invalid() -> DeckError {
    DeckError::new(ErrorCode::InvalidArgs, "캡처 설정이 올바르지 않아요.")
}
fn busy() -> DeckError {
    DeckError::new(ErrorCode::Busy, "캡처 작업을 처리하고 있어요.")
}
fn token() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    OsRng.fill(&mut bytes);
    format!("h_{}", deck_core::util::to_hex(&bytes))
}
fn owned<'a, T>(
    map: &'a HashMap<String, Owned<T>>,
    owner: &str,
    key: &str,
) -> Result<&'a T, DeckError> {
    let slot = map.get(key).ok_or_else(denied)?;
    if slot.owner != owner {
        return Err(denied());
    }
    Ok(&slot.value)
}
fn owned_mut<'a, T>(
    map: &'a mut HashMap<String, Owned<T>>,
    owner: &str,
    key: &str,
) -> Result<&'a mut T, DeckError> {
    let slot = map.get_mut(key).ok_or_else(denied)?;
    if slot.owner != owner {
        return Err(denied());
    }
    Ok(&mut slot.value)
}
fn validate_settings(settings: &CaptureSettings) -> Result<(), DeckError> {
    deck_core::caps::capture::validate_settings(settings)
}
fn validate_style(style: &OverlayStyle) -> Result<(), DeckError> {
    deck_core::caps::overlay::validate_style(style)
}
fn check_rect(rect: &PhysicalRect) -> Result<(), DeckError> {
    crate::capture_native::validate_rect(rect.x, rect.y, rect.width, rect.height)
}
fn ui_for(inner: &Inner, overlay: &Overlay, toolbar: bool) -> OverlayUiState {
    OverlayUiState {
        toolbar,
        overlay: overlay.info.clone(),
        session: inner
            .sessions
            .values()
            .find(|s| s.value.info.overlay_handle == overlay.info.overlay_handle)
            .map(|s| s.value.info.clone()),
    }
}
fn emit_state(app: &AppHandle, inner: &Inner, overlay: &Overlay) {
    let _ = app.emit_to(
        &overlay.label,
        "deck://overlay-state",
        ui_for(inner, overlay, false),
    );
    let _ = app.emit_to(
        &overlay.toolbar,
        "deck://overlay-state",
        ui_for(inner, overlay, true),
    );
}
fn windows(app: &AppHandle, overlay: &Overlay) -> Vec<tauri::WebviewWindow> {
    [&overlay.label, &overlay.toolbar]
        .into_iter()
        .filter_map(|l| app.get_webview_window(l))
        .collect()
}
fn set_visibility(app: &AppHandle, overlay: &Overlay) -> Result<(), DeckError> {
    for window in windows(app, overlay) {
        if overlay.info.visible {
            window.show().map_err(|_| internal())?;
        } else {
            window.hide().map_err(|_| internal())?;
        }
    }
    Ok(())
}
fn position_toolbar(app: &AppHandle, overlay: &Overlay) -> Result<(), DeckError> {
    let Some(toolbar) = app.get_webview_window(&overlay.toolbar) else {
        return Err(internal());
    };
    let rect = &overlay.info.rect;
    let size = toolbar.outer_size().map_err(|_| internal())?;
    let monitors = toolbar.available_monitors().map_err(|_| internal())?;
    let monitor = monitors.iter().find(|m| {
        let p = m.position();
        let s = m.size();
        i64::from(rect.x) >= i64::from(p.x)
            && i64::from(rect.x) < i64::from(p.x) + i64::from(s.width)
            && i64::from(rect.y) >= i64::from(p.y)
            && i64::from(rect.y) < i64::from(p.y) + i64::from(s.height)
    });
    let mut x = i64::from(rect.x);
    let mut y = i64::from(rect.y) - i64::from(size.height) - 8;
    if let Some(m) = monitor {
        let p = m.position();
        let s = m.size();
        if y < i64::from(p.y) {
            y = i64::from(rect.y) + i64::from(rect.height) + 8;
        }
        x = x.clamp(
            i64::from(p.x),
            (i64::from(p.x) + i64::from(s.width) - i64::from(size.width)).max(i64::from(p.x)),
        );
        y = y.clamp(
            i64::from(p.y),
            (i64::from(p.y) + i64::from(s.height) - i64::from(size.height)).max(i64::from(p.y)),
        );
    }
    toolbar
        .set_position(PhysicalPosition::new(
            i32::try_from(x).map_err(|_| invalid())?,
            i32::try_from(y).map_err(|_| invalid())?,
        ))
        .map_err(|_| internal())
}
/// Shell commands identify owner from the trusted native label, never payload fields.
#[tauri::command]
pub async fn overlay_ui_state(
    app: AppHandle,
    webview: tauri::Webview,
) -> Result<OverlayUiState, DeckError> {
    let service = app.state::<CaptureService>();
    let inner = service.inner.lock().map_err(|_| internal())?;
    let overlay = inner
        .overlays
        .values()
        .find(|o| o.value.label == webview.label() || o.value.toolbar == webview.label())
        .ok_or_else(denied)?;
    Ok(ui_for(
        &inner,
        &overlay.value,
        overlay.value.toolbar == webview.label(),
    ))
}
/// Called by native window movement; rect always comes from actual physical client geometry.
pub fn window_changed(app: &AppHandle, label: &str) {
    let service = app.state::<CaptureService>();
    let Ok(mut inner) = service.inner.try_lock() else {
        return;
    };
    let Some(slot) = inner.overlays.values_mut().find(|o| o.value.label == label) else {
        return;
    };
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let (Ok(position), Ok(size)) = (window.inner_position(), window.inner_size()) else {
        return;
    };
    let rect = PhysicalRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    if check_rect(&rect).is_err() {
        return;
    }
    slot.value.info.rect = rect;
    let key = slot.value.info.overlay_handle.clone();
    if let Some(slot) = inner.overlays.get(&key) {
        let _ = position_toolbar(app, &slot.value);
        emit_state(app, &inner, &slot.value);
        if let Ok(payload) = to_value(&slot.value.info) {
            module_event(app, &slot.owner, "overlay.changed", payload);
        }
    }
}
/// Validated overlay routing; window content is always the bundled shell route.
pub fn overlay_call(
    app: &AppHandle,
    owner: &str,
    method: &str,
    args: Value,
) -> Result<Value, DeckError> {
    let service = app.state::<CaptureService>();
    if method == "create" {
        let a: OverlayCreateArgs = parse_args(args)?;
        check_rect(&a.rect)?;
        validate_style(&a.style)?;
        let mut inner = service.inner.lock().map_err(|_| internal())?;
        if inner.overlays.values().any(|s| s.owner == owner) {
            return Err(busy());
        }
        let handle = token();
        let suffix = handle.strip_prefix("h_").ok_or_else(internal)?;
        let label = format!("capture-overlay-{suffix}");
        let toolbar = format!("capture-toolbar-{suffix}");
        let info = OverlayInfo {
            overlay_handle: handle.clone(),
            rect: a.rect.clone(),
            style: a.style,
            visible: true,
            always_on_top: a.always_on_top,
        };
        let region = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay".into()))
            .title("캡처 영역")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(a.always_on_top)
            .visible(false)
            .build()
            .map_err(|_| internal())?;
        let mut transaction = WindowTransaction {
            windows: vec![region.clone()],
            committed: false,
        };
        region
            .set_position(PhysicalPosition::new(a.rect.x, a.rect.y))
            .map_err(|_| internal())?;
        region
            .set_size(PhysicalSize::new(a.rect.width, a.rect.height))
            .map_err(|_| internal())?;
        let bar = match WebviewWindowBuilder::new(app, &toolbar, WebviewUrl::App("overlay".into()))
            .title("캡처 도구")
            .decorations(false)
            .skip_taskbar(true)
            .always_on_top(a.always_on_top)
            .inner_size(360.0, 128.0)
            .resizable(false)
            .visible(false)
            .build()
        {
            Ok(w) => w,
            Err(_) => {
                let _ = region.close();
                return Err(internal());
            }
        };
        transaction.windows.push(bar.clone());
        let overlay = Overlay {
            info,
            label,
            toolbar,
        };
        position_toolbar(app, &overlay)?;
        let callback_app = app.clone();
        let callback_label = overlay.label.clone();
        region.on_window_event(move |event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                window_changed(&callback_app, &callback_label);
            }
        });
        let _ = bar;
        inner.overlays.insert(
            handle.clone(),
            Owned {
                owner: owner.into(),
                value: overlay,
            },
        );
        let overlay = owned(&inner.overlays, owner, &handle)?;
        if let Err(error) = set_visibility(app, overlay) {
            inner.overlays.remove(&handle);
            return Err(error);
        }
        transaction.committed = true;
        let overlay = owned(&inner.overlays, owner, &handle)?;
        emit_state(app, &inner, overlay);
        module_event(app, owner, "overlay.changed", to_value(&overlay.info)?);
        return to_value(&overlay.info);
    }
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    if method != "close"
        && method != "status"
        && inner
            .sessions
            .values()
            .any(|s| s.owner == owner && s.value.info.busy)
    {
        return Err(busy());
    }
    if method == "update" {
        let a: OverlayUpdateArgs = parse_args(args)?;
        if let Some(rect) = &a.rect {
            check_rect(rect)?;
        }
        if let Some(style) = &a.style {
            validate_style(style)?;
        }
        let overlay = owned_mut(&mut inner.overlays, owner, &a.overlay_handle)?;
        if let Some(rect) = a.rect {
            if let Some(w) = app.get_webview_window(&overlay.label) {
                w.set_position(PhysicalPosition::new(rect.x, rect.y))
                    .map_err(|_| internal())?;
                w.set_size(PhysicalSize::new(rect.width, rect.height))
                    .map_err(|_| internal())?;
            }
            overlay.info.rect = rect;
        }
        if let Some(style) = a.style {
            overlay.info.style = style;
        }
        if let Some(top) = a.always_on_top {
            for w in windows(app, overlay) {
                w.set_always_on_top(top).map_err(|_| internal())?;
            }
            overlay.info.always_on_top = top;
        }
        let key = a.overlay_handle;
        let overlay = owned(&inner.overlays, owner, &key)?;
        position_toolbar(app, overlay)?;
        emit_state(app, &inner, overlay);
        module_event(app, owner, "overlay.changed", to_value(&overlay.info)?);
        return to_value(&overlay.info);
    }
    let a: OverlayArgs = parse_args(args)?;
    if method == "status" {
        return to_value(&owned(&inner.overlays, owner, &a.overlay_handle)?.info);
    }
    if method == "close" {
        owned(&inner.overlays, owner, &a.overlay_handle)?;
        drop(inner);
        stop_owner(app, owner);
        return Ok(Value::Null);
    }
    let overlay = owned_mut(&mut inner.overlays, owner, &a.overlay_handle)?;
    match method {
        "show" => overlay.info.visible = true,
        "hide" => overlay.info.visible = false,
        _ => return Err(invalid()),
    };
    set_visibility(app, overlay)?;
    let overlay = owned(&inner.overlays, owner, &a.overlay_handle)?;
    emit_state(app, &inner, overlay);
    module_event(app, owner, "overlay.changed", to_value(&overlay.info)?);
    to_value(&overlay.info)
}
#[cfg(windows)]
fn native_shortcut(
    modifiers: &[ShortcutModifier],
    key: &str,
) -> Result<tauri_plugin_global_shortcut::Shortcut, DeckError> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    if modifiers.is_empty() || modifiers.len() > 4 {
        return Err(invalid());
    }
    let upper = key.to_ascii_uppercase();
    let code_text = if upper.len() == 1 && upper.chars().all(|c| c.is_ascii_alphabetic()) {
        format!("Key{upper}")
    } else if upper.len() == 1 && upper.chars().all(|c| c.is_ascii_digit()) {
        format!("Digit{upper}")
    } else if upper.starts_with('F')
        && upper
            .get(1..)
            .and_then(|v| v.parse::<u8>().ok())
            .is_some_and(|v| (1..=24).contains(&v))
    {
        upper
    } else {
        match key {
            "Space" | "Enter" | "Escape" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" => {
                key.into()
            }
            _ => return Err(invalid()),
        }
    };
    let code = Code::from_str(&code_text).map_err(|_| invalid())?;
    let mut flags = Modifiers::empty();
    for modifier in modifiers {
        let flag = match modifier {
            ShortcutModifier::Control => Modifiers::CONTROL,
            ShortcutModifier::Shift => Modifiers::SHIFT,
            ShortcutModifier::Alt => Modifiers::ALT,
            ShortcutModifier::Meta => Modifiers::META,
        };
        if flags.contains(flag) {
            return Err(invalid());
        }
        flags.insert(flag);
    }
    Ok(Shortcut::new(Some(flags), code))
}
/// Host-only hotkey registration; no frontend plugin permission is granted.
#[cfg(windows)]
pub fn shortcut_call(
    app: &AppHandle,
    owner: &str,
    method: &str,
    args: Value,
) -> Result<Value, DeckError> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let service = app.state::<CaptureService>();
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    if method == "status" {
        let a: ShortcutArgs = parse_args(args)?;
        return to_value(&owned(&inner.shortcuts, owner, &a.shortcut_handle)?.info);
    }
    if method == "unregister" {
        let a: ShortcutArgs = parse_args(args)?;
        let old = owned(&inner.shortcuts, owner, &a.shortcut_handle)?;
        let native = native_shortcut(&old.info.modifiers, &old.info.key)?;
        app.global_shortcut()
            .unregister(native)
            .map_err(|_| internal())?;
        inner.shortcuts.remove(&a.shortcut_handle);
        for slot in inner.sessions.values_mut() {
            if slot.value.info.shortcut_handle.as_deref() == Some(&a.shortcut_handle) {
                slot.value.info.shortcut_handle = None;
            }
        }
        return Ok(Value::Null);
    }
    let (handle, modifiers, key, old) = if method == "replace" {
        let a: ShortcutReplaceArgs = parse_args(args)?;
        let old = owned(&inner.shortcuts, owner, &a.shortcut_handle)?;
        let old_native = native_shortcut(&old.info.modifiers, &old.info.key)?;
        (a.shortcut_handle, a.modifiers, a.key, Some(old_native))
    } else if method == "register" {
        let a: ShortcutRegisterArgs = parse_args(args)?;
        if inner
            .shortcuts
            .values()
            .filter(|s| s.owner == owner)
            .count()
            >= 4
        {
            return Err(busy());
        }
        (token(), a.modifiers, a.key, None)
    } else {
        return Err(invalid());
    };
    let native = native_shortcut(&modifiers, &key)?;
    if old == Some(native) {
        return to_value(&owned(&inner.shortcuts, owner, &handle)?.info);
    }
    // Register new before releasing old: conflict preserves the existing key unchanged.
    let callback_handle = handle.clone();
    let callback_owner = owner.to_owned();
    let edge = Arc::new(ShortcutEdge::default());
    let callback_edge = edge.clone();
    app.global_shortcut()
        .on_shortcut(native, move |app, _, event| {
            shortcut_event(
                app,
                &callback_owner,
                &callback_handle,
                event.state == ShortcutState::Pressed,
                callback_edge.clone(),
            )
        })
        .map_err(|_| {
            DeckError::new(
                ErrorCode::Busy,
                "이 단축키를 사용할 수 없어요. 다른 조합을 선택해 주세요.",
            )
        })?;
    if let Some(old) = old
        && app.global_shortcut().unregister(old).is_err()
    {
        let _ = app.global_shortcut().unregister(native);
        return Err(internal());
    }
    let info = ShortcutInfo {
        shortcut_handle: handle.clone(),
        modifiers,
        key,
    };
    inner.shortcuts.insert(
        handle,
        Owned {
            owner: owner.into(),
            value: Shortcut {
                info: info.clone(),
                _edge: edge,
            },
        },
    );
    to_value(&info)
}
/// Non-Windows builds retain the same unavailable capability error.
#[cfg(not(windows))]
pub fn shortcut_call(
    _app: &AppHandle,
    _owner: &str,
    _method: &str,
    _args: Value,
) -> Result<Value, DeckError> {
    Err(DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "전역 단축키는 Windows에서 사용할 수 있어요.",
    ))
}
#[derive(Default)]
struct ShortcutEdge {
    pressed: AtomicBool,
    pending: AtomicBool,
}
impl ShortcutEdge {
    fn transition(&self, pressed: bool) -> bool {
        if !pressed {
            self.pressed.store(false, Ordering::Release);
            return false;
        }
        !self.pressed.swap(true, Ordering::AcqRel)
    }
}
struct PendingEdge(Arc<ShortcutEdge>);
impl Drop for PendingEdge {
    fn drop(&mut self) {
        self.0.pending.store(false, Ordering::Release);
    }
}
fn shortcut_event(
    app: &AppHandle,
    owner: &str,
    handle: &str,
    pressed: bool,
    edge: Arc<ShortcutEdge>,
) {
    // Release updates are independent of publication/registration metadata locks.
    if !edge.transition(pressed) || edge.pending.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let owner = owner.to_owned();
    let handle = handle.to_owned();
    tauri::async_runtime::spawn(async move {
        let _pending = PendingEdge(edge);
        let key = {
            let service = app.state::<CaptureService>();
            let Ok(inner) = service.inner.lock() else {
                return;
            };
            if owned(&inner.shortcuts, &owner, &handle).is_err() {
                return;
            }
            inner
                .sessions
                .iter()
                .find(|(_, s)| {
                    s.owner == owner && s.value.info.shortcut_handle.as_deref() == Some(&handle)
                })
                .map(|(k, _)| k.clone())
        };
        module_event(
            &app,
            &owner,
            "shortcut.triggered",
            serde_json::json!({"shortcutHandle":handle}),
        );
        if let Some(key) = key {
            let _ = trigger(&app, &owner, &key).await;
        }
    });
}
fn authorize_session(
    state: &AppState,
    owner: &str,
    session: &CaptureSession,
) -> Result<(), DeckError> {
    let modules = state.modules.read().map_err(|_| internal())?;
    for (cap, method) in [
        ("capture", "arm"),
        ("overlay", "create"),
        ("fs", "pickDestination"),
    ] {
        crate::bridge::authorize(&modules, &state.host_caps, owner, cap, method)?;
    }
    if session.shortcut_handle.is_some() {
        crate::bridge::authorize(
            &modules,
            &state.host_caps,
            owner,
            "global-shortcut",
            "register",
        )?;
    }
    drop(modules);
    crate::destination::validate(state, owner, &session.destination_grant)
}
fn module_event(app: &AppHandle, owner: &str, topic: &str, payload: Value) {
    let _ = app.emit_to(
        crate::origins::MAIN_WINDOW,
        "deck://module-event",
        serde_json::json!({"moduleId":owner,"topic":topic,"payload":payload}),
    );
}
/// Captures exactly one armed frame; all trigger paths share this bounded path.
async fn trigger_inner(
    app: &AppHandle,
    owner: &str,
    key: &str,
) -> Result<CaptureResult, DeckError> {
    let state = app.state::<AppState>();
    let service = app.state::<CaptureService>();
    let _job = Job::acquire(service.busy.clone())?;
    let (session, rect, labels) = {
        let mut inner = service.inner.lock().map_err(|_| internal())?;
        let slot = owned(&inner.sessions, owner, key)?;
        authorize_session(&state, owner, &slot.info)?;
        if slot.info.busy
            || slot
                .last_trigger
                .is_some_and(|last| last.elapsed() < std::time::Duration::from_millis(300))
        {
            return Err(busy());
        }
        let info = slot.info.clone();
        let overlay = owned(&inner.overlays, owner, &info.overlay_handle)?;
        let rect = overlay.info.rect.clone();
        let labels = vec![overlay.label.clone(), overlay.toolbar.clone()];
        let slot = owned_mut(&mut inner.sessions, owner, key)?;
        slot.info.busy = true;
        slot.last_trigger = Some(Instant::now());
        if let Ok(overlay) = owned(&inner.overlays, owner, &info.overlay_handle) {
            emit_state(app, &inner, overlay);
        }
        (info, rect, labels)
    };
    let hidden = labels
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .map(|w| {
            let shown = w.is_visible().unwrap_or(false);
            (w, shown)
        })
        .collect::<Vec<_>>();
    let overlay_key = session.overlay_handle.clone();
    let result = async {
        for (w, _) in &hidden {
            w.hide().map_err(|_| internal())?;
        }
        // Bounded compositor settling; actual overlay exclusion is verified in native QA.
        let settings = session.settings.clone();
        let capture_app = app.clone();
        let capture_owner = owner.to_owned();
        let grant = session.destination_grant.clone();
        let sequence = session.sequence.checked_add(1).ok_or_else(invalid)?;
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(std::time::Duration::from_millis(80));
            let frame = crate::capture_native::capture(
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                settings.format == CaptureFormat::Jpeg,
                settings.quality,
            )?;
            let state = capture_app.state::<AppState>();
            let service = capture_app.state::<CaptureService>();
            let lease = service.inner.lock().map_err(|_| internal())?;
            owned(&lease.sessions, &capture_owner, &session.session_handle)
                .map_err(|_| DeckError::new(ErrorCode::Cancelled, "캡처 작업을 종료했어요."))?;
            // Re-authorize after encoding, before irreversible new-file publication.
            authorize_session(&state, &capture_owner, &session)?;
            let name = output_filename(&settings, current_clock()?, sequence, 0)?;
            let file =
                crate::destination::save(&state, &capture_owner, &grant, &name, &frame.bytes)?;
            Ok::<_, DeckError>(CaptureResult {
                file,
                width: frame.width,
                height: frame.height,
                sequence,
            })
        })
        .await
        .map_err(|_| internal())?
    }
    .await;
    let restore = service
        .inner
        .lock()
        .ok()
        .and_then(|inner| {
            inner
                .overlays
                .get(&overlay_key)
                .map(|o| o.value.info.visible)
        })
        .unwrap_or(false);
    for (w, shown) in hidden {
        if shown && restore {
            let _ = w.show();
        }
    }
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    if let Ok(result) = &result {
        inner
            .results
            .push_back((owner.into(), result.file.handle.clone()));
        if inner.results.len() > 64
            && let Some((old_owner, old_handle)) = inner.results.pop_front()
            && let Ok(mut handles) = state.handles.lock()
        {
            let _ = handles.release(&old_owner, &old_handle);
        }
    }
    if let Ok(slot) = owned_mut(&mut inner.sessions, owner, key) {
        slot.info.busy = false;
        match &result {
            Ok(result) => {
                slot.info.sequence = result.sequence;
                slot.info.last_result = Some(result.clone());
                slot.info.last_error = None;
            }
            Err(error) => slot.info.last_error = Some(error.clone()),
        }
        let overlay_key = slot.info.overlay_handle.clone();
        if let Ok(overlay) = owned(&inner.overlays, owner, &overlay_key) {
            emit_state(app, &inner, overlay);
        }
    }
    match &result {
        Ok(result) => module_event(
            app,
            owner,
            "capture.completed",
            to_value(&CaptureCompletedEvent {
                session_handle: key.into(),
                result: result.clone(),
            })?,
        ),
        Err(error) => module_event(
            app,
            owner,
            "capture.failed",
            to_value(&CaptureFailedEvent {
                session_handle: key.into(),
                error: error.clone(),
            })?,
        ),
    }
    result
}
/// Module capture operations are already authorized by host_invoke.
pub async fn capture_call(
    app: &AppHandle,
    owner: &str,
    method: &str,
    args: Value,
) -> Result<Value, DeckError> {
    let state = app.state::<AppState>();
    let service = app.state::<CaptureService>();
    if method == "trigger" {
        let a: CaptureSessionArgs = parse_args(args)?;
        return to_value(&trigger(app, owner, &a.session_handle).await?);
    }
    if method == "capture" {
        let a: CaptureArgs = parse_args(args)?;
        check_rect(&a.rect)?;
        validate_settings(&a.settings)?;
        let job = Job::acquire(service.busy.clone())?;
        let cloned = app.clone();
        let owner = owner.to_owned();
        return tauri::async_runtime::spawn_blocking(move || {
            let _job = job;
            let service = cloned.state::<CaptureService>();
            {
                let mut inner = service.inner.lock().map_err(|_| internal())?;
                inner
                    .temps
                    .retain(|(_, created)| created.elapsed() < std::time::Duration::from_secs(300));
                if inner.temps.len() >= 16 {
                    return Err(busy());
                }
            }
            let frame = crate::capture_native::capture(
                a.rect.x,
                a.rect.y,
                a.rect.width,
                a.rect.height,
                a.settings.format == CaptureFormat::Jpeg,
                a.settings.quality,
            )?;
            let state = cloned.state::<AppState>();
            let store = state.modules.read().map_err(|_| internal())?;
            crate::bridge::authorize(&store, &state.host_caps, &owner, "capture", "capture")?;
            drop(store);
            let temp = state
                .temp
                .as_ref()
                .ok_or_else(internal)?
                .create_dir(&mut OsRng)
                .map_err(|_| internal())?;
            let name = output_filename(&a.settings, current_clock()?, 1, 0)?;
            let path = temp.path().join(&name);
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .map_err(|_| internal())?;
            file.write_all(&frame.bytes).map_err(|_| internal())?;
            file.sync_all().map_err(|_| internal())?;
            drop(file);
            let transfers = state.transfers.lock().map_err(|_| internal())?;
            let generation = transfers.generation(&owner);
            let handle = state.handles.lock().map_err(|_| internal())?.issue(
                &owner,
                crate::state::FileHandleTarget {
                    path,
                    kind: crate::state::FileHandleKind::ReadFile,
                    generation,
                },
            );
            drop(transfers);
            service
                .inner
                .lock()
                .map_err(|_| internal())?
                .temps
                .push((temp, Instant::now()));
            to_value(&CaptureResult {
                file: deck_core::caps::fs::FileHandleInfo {
                    handle,
                    name,
                    ext: if a.settings.format == CaptureFormat::Jpeg {
                        "jpg"
                    } else {
                        "png"
                    }
                    .into(),
                    size: frame.bytes.len() as u64,
                    modified_at: 0,
                },
                width: frame.width,
                height: frame.height,
                sequence: 1,
            })
        })
        .await
        .map_err(|_| internal())?;
    }
    if method == "displays" {
        return displays(app, owner);
    }
    let mut inner = service.inner.lock().map_err(|_| internal())?;
    if method == "arm" {
        if !service.tray_ready.load(Ordering::Acquire) {
            return Err(DeckError::new(
                ErrorCode::CapabilityUnavailable,
                "캡처 트레이를 사용할 수 없어요. 앱을 다시 실행해 주세요.",
            ));
        }
        let a: CaptureArmArgs = parse_args(args)?;
        validate_settings(&a.settings)?;
        owned(&inner.overlays, owner, &a.overlay_handle)?;
        if let Some(handle) = &a.shortcut_handle {
            owned(&inner.shortcuts, owner, handle)?;
        }
        if inner.sessions.values().any(|s| s.owner == owner) {
            return Err(busy());
        }
        crate::destination::validate(&state, owner, &a.destination_grant)?;
        let handle = token();
        let info = CaptureSession {
            session_handle: handle.clone(),
            overlay_handle: a.overlay_handle.clone(),
            destination_grant: a.destination_grant,
            shortcut_handle: a.shortcut_handle,
            settings: a.settings,
            sequence: 0,
            busy: false,
            last_result: None,
            last_error: None,
        };
        inner.sessions.insert(
            handle,
            Owned {
                owner: owner.into(),
                value: Session {
                    info: info.clone(),
                    last_trigger: None,
                },
            },
        );
        let overlay = owned(&inner.overlays, owner, &a.overlay_handle)?;
        emit_state(app, &inner, overlay);
        drop(inner);
        update_tray(app);
        return to_value(&info);
    }
    if method == "status" {
        let a: CaptureStatusArgs = parse_args(args)?;
        let session = if let Some(key) = a.session_handle {
            Some(owned(&inner.sessions, owner, &key)?.info.clone())
        } else {
            inner
                .sessions
                .values()
                .find(|s| s.owner == owner)
                .map(|s| s.value.info.clone())
        };
        return to_value(&session);
    }
    if method == "update" {
        let a: CaptureUpdateArgs = parse_args(args)?;
        if let Some(settings) = &a.settings {
            validate_settings(settings)?;
        }
        if let Some(grant) = &a.destination_grant {
            crate::destination::validate(&state, owner, grant)?;
        }
        if let Some(key) = &a.shortcut_handle {
            owned(&inner.shortcuts, owner, key)?;
        }
        let session = owned_mut(&mut inner.sessions, owner, &a.session_handle)?;
        if session.info.busy {
            return Err(busy());
        }
        if let Some(settings) = a.settings {
            session.info.settings = settings;
        }
        if let Some(grant) = a.destination_grant {
            session.info.destination_grant = grant;
        }
        if let Some(key) = a.shortcut_handle {
            session.info.shortcut_handle = Some(key);
        }
        let info = session.info.clone();
        if let Ok(overlay) = owned(&inner.overlays, owner, &info.overlay_handle) {
            emit_state(app, &inner, overlay);
        }
        return to_value(&info);
    }
    let a: CaptureSessionArgs = parse_args(args)?;
    if method == "stop" {
        owned(&inner.sessions, owner, &a.session_handle)?;
        drop(inner);
        stop_owner(app, owner);
        return Ok(Value::Null);
    }
    let session = owned_mut(&mut inner.sessions, owner, &a.session_handle)?;
    if session.info.busy {
        return Err(busy());
    }
    if method == "resetSequence" {
        session.info.sequence = 0;
        let info = session.info.clone();
        if let Ok(overlay) = owned(&inner.overlays, owner, &info.overlay_handle) {
            emit_state(app, &inner, overlay);
        }
        return to_value(&info);
    }
    Err(invalid())
}
#[cfg(windows)]
fn displays(_app: &AppHandle, _owner: &str) -> Result<Value, DeckError> {
    let displays = xcap::Monitor::all()
        .map_err(|_| internal())?
        .into_iter()
        .map(|m| {
            Ok(DisplayInfo {
                display_handle: token(),
                bounds: PhysicalRect {
                    x: m.x().map_err(|_| internal())?,
                    y: m.y().map_err(|_| internal())?,
                    width: m.width().map_err(|_| internal())?,
                    height: m.height().map_err(|_| internal())?,
                },
                scale: f64::from(m.scale_factor().map_err(|_| internal())?),
                primary: m.is_primary().map_err(|_| internal())?,
            })
        })
        .collect::<Result<Vec<_>, DeckError>>()?;
    to_value(&displays)
}
#[cfg(not(windows))]
fn displays(_app: &AppHandle, _owner: &str) -> Result<Value, DeckError> {
    Err(DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "화면 캡처는 Windows에서 사용할 수 있어요.",
    ))
}
fn current_clock() -> Result<CaptureClock, DeckError> {
    #[cfg(windows)]
    {
        use chrono::{Datelike, Timelike};
        let now = chrono::Local::now();
        Ok(CaptureClock {
            year: u16::try_from(now.year()).map_err(|_| internal())?,
            month: u8::try_from(now.month()).map_err(|_| internal())?,
            day: u8::try_from(now.day()).map_err(|_| internal())?,
            hour: u8::try_from(now.hour()).map_err(|_| internal())?,
            minute: u8::try_from(now.minute()).map_err(|_| internal())?,
            second: u8::try_from(now.second()).map_err(|_| internal())?,
        })
    }
    #[cfg(not(windows))]
    {
        Err(DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "화면 캡처는 Windows에서 사용할 수 있어요.",
        ))
    }
}
/// Only trusted overlay windows may request these six fixed actions.
#[tauri::command]
pub async fn overlay_ui_action(
    app: AppHandle,
    webview: tauri::Webview,
    args: OverlayUiActionArgs,
) -> Result<(), DeckError> {
    let (owner, overlay, session) = {
        let service = app.state::<CaptureService>();
        let inner = service.inner.lock().map_err(|_| internal())?;
        let slot = inner
            .overlays
            .values()
            .find(|o| o.value.label == webview.label() || o.value.toolbar == webview.label())
            .ok_or_else(denied)?;
        let session = inner
            .sessions
            .values()
            .find(|s| {
                s.owner == slot.owner
                    && s.value.info.overlay_handle == slot.value.info.overlay_handle
            })
            .map(|s| s.value.info.clone());
        (slot.owner.clone(), slot.value.info.clone(), session)
    };
    let state = app.state::<AppState>();

    match args.action {
        OverlayUiAction::Capture => {
            let session = session.ok_or_else(invalid)?;
            trigger(&app, &owner, &session.session_handle).await?;
        }
        OverlayUiAction::ShowSettings => {
            show_settings(&app, &owner);
        }
        OverlayUiAction::OpenFolder => {
            let session = session.ok_or_else(invalid)?;
            crate::destination::reveal(&state, &owner, &session.destination_grant)?;
        }
        OverlayUiAction::ToggleOnTop => {
            overlay_call(
                &app,
                &owner,
                "update",
                serde_json::json!({"overlayHandle":overlay.overlay_handle,"alwaysOnTop":!overlay.always_on_top}),
            )?;
        }
        OverlayUiAction::ToggleVisible => {
            overlay_call(
                &app,
                &owner,
                if overlay.visible { "hide" } else { "show" },
                serde_json::json!({"overlayHandle":overlay.overlay_handle}),
            )?;
        }
        OverlayUiAction::Stop => {
            if let Some(session) = session {
                capture_call(
                    &app,
                    &owner,
                    "stop",
                    serde_json::json!({"sessionHandle":session.session_handle}),
                )
                .await?;
            } else {
                overlay_call(
                    &app,
                    &owner,
                    "close",
                    serde_json::json!({"overlayHandle":overlay.overlay_handle}),
                )?;
            }
        }
    }
    Ok(())
}
fn show_settings(app: &AppHandle, owner: &str) {
    if let Some(window) = app.get_webview_window(crate::origins::MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit_to(
        crate::origins::MAIN_WINDOW,
        "deck://show-module",
        serde_json::json!({"moduleId":owner}),
    );
}
/// Stops native resources for a module; called only when module becomes non-runnable.
pub fn stop_owner(app: &AppHandle, owner: &str) {
    let service = app.state::<CaptureService>();
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    let keys = inner
        .overlays
        .iter()
        .filter(|(_, s)| s.owner == owner)
        .map(|(k, _)| k.clone())
        .collect::<Vec<_>>();
    for key in keys {
        if let Some(slot) = inner.overlays.remove(&key) {
            for w in windows(app, &slot.value) {
                let _ = w.close();
            }
        }
    }
    inner.sessions.retain(|_, s| s.owner != owner);
    #[cfg(windows)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        for slot in inner.shortcuts.values().filter(|s| s.owner == owner) {
            if let Ok(shortcut) = native_shortcut(&slot.value.info.modifiers, &slot.value.info.key)
            {
                let _ = app.global_shortcut().unregister(shortcut);
            }
        }
    }
    inner.shortcuts.retain(|_, s| s.owner != owner);
    drop(inner);
    update_tray(app);
}
/// Installs only the Rust-side global shortcut backend on Windows.
pub fn configure(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(windows)]
    {
        builder.plugin(tauri_plugin_global_shortcut::Builder::new().build())
    }
    #[cfg(not(windows))]
    {
        builder
    }
}
struct Job(Arc<AtomicBool>);
impl Job {
    fn acquire(flag: Arc<AtomicBool>) -> Result<Self, DeckError> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| busy())?;
        Ok(Self(flag))
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
struct WindowTransaction {
    windows: Vec<tauri::WebviewWindow>,
    committed: bool,
}
impl Drop for WindowTransaction {
    fn drop(&mut self) {
        if !self.committed {
            for window in &self.windows {
                let _ = window.close();
            }
        }
    }
}
/// Whether closing settings should retain a user-started background session.
pub fn background_active(app: &AppHandle) -> bool {
    app.try_state::<CaptureService>().is_some_and(|s| {
        s.tray_ready.load(Ordering::Acquire) && s.inner.lock().is_ok_and(|i| !i.sessions.is_empty())
    })
}
fn tray_target(app: &AppHandle) -> Option<(String, String, String)> {
    let service = app.state::<CaptureService>();
    let inner = service.inner.lock().ok()?;
    let (handle, slot) = inner
        .sessions
        .iter()
        .min_by_key(|(_, slot)| slot.owner.clone())?;
    Some((
        slot.owner.clone(),
        handle.clone(),
        slot.value.info.overlay_handle.clone(),
    ))
}
fn tray_action(app: &AppHandle, id: &str) {
    if id == "capture-exit" {
        app.exit(0);
        return;
    }
    let Some((owner, session, overlay)) = tray_target(app) else {
        return;
    };
    match id {
        "capture-settings" => show_settings(app, &owner),
        "capture-stop" => stop_owner(app, &owner),
        "capture-now" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = trigger(&app, &owner, &session).await;
            });
        }
        "capture-show" => {
            let visible = {
                let service = app.state::<CaptureService>();
                service
                    .inner
                    .lock()
                    .ok()
                    .and_then(|inner| inner.overlays.get(&overlay).map(|o| o.value.info.visible))
                    .unwrap_or(false)
            };
            let _ = overlay_call(
                app,
                &owner,
                if visible { "hide" } else { "show" },
                serde_json::json!({"overlayHandle":overlay}),
            );
        }
        _ => {}
    }
}
/// Builds the fixed native tray; no path or command is accepted from a module.
pub fn setup_tray(app: &AppHandle) -> Result<(), DeckError> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
    let capture = MenuItem::with_id(app, "capture-now", "즉시 캡처", true, None::<&str>)
        .map_err(|_| internal())?;
    let show = MenuItem::with_id(app, "capture-show", "영역 표시/숨기기", true, None::<&str>)
        .map_err(|_| internal())?;
    let settings = MenuItem::with_id(
        app,
        "capture-settings",
        "캡처 설정 열기",
        true,
        None::<&str>,
    )
    .map_err(|_| internal())?;
    let stop = MenuItem::with_id(app, "capture-stop", "캡처 세션 종료", true, None::<&str>)
        .map_err(|_| internal())?;
    let exit = MenuItem::with_id(app, "capture-exit", "TeacherDeck 종료", true, None::<&str>)
        .map_err(|_| internal())?;
    let menu = Menu::with_items(app, &[&capture, &show, &settings, &stop, &exit])
        .map_err(|_| internal())?;
    let mut builder = TrayIconBuilder::with_id("capture")
        .menu(&menu)
        .tooltip("TeacherDeck 캡처")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| tray_action(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                tray_action(tray.app_handle(), "capture-settings");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app).map_err(|_| internal())?;
    tray.set_visible(false).map_err(|_| internal())?;
    app.state::<CaptureService>()
        .tray_ready
        .store(true, Ordering::Release);
    let cleanup = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let Some(service) = cleanup.try_state::<CaptureService>() else {
                break;
            };
            let Some(state) = cleanup.try_state::<AppState>() else {
                break;
            };
            let sessions = service
                .inner
                .lock()
                .map(|i| {
                    i.sessions
                        .values()
                        .map(|s| (s.owner.clone(), s.value.info.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for (owner, session) in sessions {
                if let Err(error) = authorize_session(&state, &owner, &session) {
                    report_failure(&cleanup, &owner, &session.session_handle, &error);
                }
            }
            let owners = service
                .inner
                .lock()
                .map(|i| {
                    i.overlays
                        .values()
                        .map(|o| o.owner.clone())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for owner in owners {
                let allowed = state.modules.read().is_ok_and(|store| {
                    crate::bridge::authorize(&store, &state.host_caps, &owner, "overlay", "create")
                        .is_ok()
                });
                if !allowed {
                    stop_owner(&cleanup, &owner);
                }
            }
        }
    });
    Ok(())
}
fn update_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("capture") {
        let _ = tray.set_visible(background_active(app));
    }
}
/// All user triggers report actionable errors even before encoding starts.
pub async fn trigger(app: &AppHandle, owner: &str, key: &str) -> Result<CaptureResult, DeckError> {
    let result = trigger_inner(app, owner, key).await;
    if let Err(error) = &result
        && error.code != ErrorCode::Busy
        && error.code != ErrorCode::Cancelled
    {
        report_failure(app, owner, key, error);
    }
    result
}
fn report_failure(app: &AppHandle, owner: &str, key: &str, error: &DeckError) {
    let service = app.state::<CaptureService>();
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    let Ok(slot) = owned_mut(&mut inner.sessions, owner, key) else {
        return;
    };
    if slot
        .info
        .last_error
        .as_ref()
        .is_some_and(|old| old.code == error.code && old.message == error.message)
    {
        return;
    }
    slot.info.last_error = Some(error.clone());
    let overlay = slot.info.overlay_handle.clone();
    if let Ok(overlay) = owned(&inner.overlays, owner, &overlay) {
        emit_state(app, &inner, overlay);
    }
    if let Ok(payload) = to_value(&CaptureFailedEvent {
        session_handle: key.into(),
        error: error.clone(),
    }) {
        module_event(app, owner, "capture.failed", payload);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_frame_lease_bounds_all_modules_and_releases_on_error() {
        let flag = Arc::new(AtomicBool::new(false));
        let first = Job::acquire(flag.clone()).unwrap();
        let other = flag.clone();
        assert_eq!(
            std::thread::spawn(move || Job::acquire(other).err().unwrap().code)
                .join()
                .unwrap(),
            ErrorCode::Busy
        );
        drop(first);
        assert!(Job::acquire(flag).is_ok());
    }
    #[test]
    fn native_metadata_getters_cannot_cross_module_ownership() {
        let mut map = HashMap::new();
        map.insert(
            "opaque".into(),
            Owned {
                owner: "module-a".into(),
                value: 7,
            },
        );
        assert_eq!(*owned(&map, "module-a", "opaque").unwrap(), 7);
        assert_eq!(
            owned(&map, "module-b", "opaque").unwrap_err().code,
            ErrorCode::PermissionDenied
        );
        assert!(owned_mut(&mut map, "module-b", "opaque").is_err());
        assert!(owned(&map, "module-a", "unknown").is_err());
    }
    #[test]
    fn release_edge_is_preserved_while_capture_metadata_is_locked() {
        let metadata = Arc::new(Mutex::new(()));
        let held = metadata.lock().unwrap();
        let edge = Arc::new(ShortcutEdge::default());
        assert!(edge.transition(true));
        assert!(!edge.transition(true));
        let other = edge.clone();
        let (sent, received) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            assert!(!other.transition(false));
            sent.send(()).unwrap();
        });
        // OS callback can finish even while an in-flight publication owns metadata.
        received
            .recv_timeout(std::time::Duration::from_secs(1))
            .unwrap();
        drop(held);
        worker.join().unwrap();
        assert!(edge.transition(true));
    }
    #[cfg(windows)]
    #[test]
    fn shortcut_whitelist_rejects_arbitrary_code_and_duplicate_modifiers() {
        assert!(
            native_shortcut(&[ShortcutModifier::Control, ShortcutModifier::Shift], "C").is_ok()
        );
        assert!(native_shortcut(&[], "C").is_err());
        assert!(
            native_shortcut(&[ShortcutModifier::Control, ShortcutModifier::Control], "C").is_err()
        );
        for key in ["F25", "x.exe", "PrintScreen", "KeyUnknown", ""] {
            assert!(native_shortcut(&[ShortcutModifier::Alt], key).is_err());
        }
    }
}
