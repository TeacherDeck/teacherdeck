// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Development-only installed-Office proof. Uses production workers and synthetic files only.
#[path = "../src/native_automation.rs"]
mod automation_boundary;
mod native_automation {
    pub(crate) use crate::automation_boundary::*;

    #[cfg(windows)]
    pub(crate) fn convert(
        request: &crate::native_workers::OfficeJob,
    ) -> Result<(), deck_core::DeckError> {
        let _production_entry = crate::automation_boundary::convert;
        crate::automation_boundary::convert_with_progress(request, |stage| {
            // Developer proof only: immutable labels, no provider response or document content.
            if let Ok(mut events) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(request.output.with_extension("stages.log"))
            {
                let _ = std::io::Write::write_all(&mut events, format!("{stage}\n").as_bytes());
            }
            if request.output.file_name().is_some_and(|name| {
                (stage == "activation-begin"
                    && (name == "timeout-synthetic.pptx" || name == "timeout-synthetic.hwpx"))
                    || (stage == "guards-begin" && name == "cancel-synthetic.hwpx")
            }) {
                // Development-only faults: timeout after Child startup; cancellation after
                // COM helper binding. Production uses a no-op callback. Both owned processes
                // must be terminated by their Job even while this callback is suspended.
                std::thread::sleep(std::time::Duration::from_secs(120));
            }
        })
    }
}
#[path = "../src/native_workers.rs"]
mod native_workers;
mod network_host {
    pub(crate) fn run_elevated_request(_: &str) -> Result<(), deck_core::DeckError> {
        Err(crate::failure())
    }
    pub(crate) fn run_saved_routine(_: &str) -> Result<(), deck_core::DeckError> {
        Err(crate::failure())
    }
}
use deck_core::caps::office::{OfficeFormat, OfficeProvider};
use deck_core::{DeckError, ErrorCode};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};
const HANCOM_PARAGRAPHS: [&str; 3] = [
    "SYNTHETIC OFFICE QA",
    "합성 변환 검증 문서",
    "SYNTHETIC SECOND PARAGRAPH",
];
fn failure() -> DeckError {
    DeckError::new(ErrorCode::Internal, "합성 문서 검증을 완료하지 못했어요.")
}
fn fixture_failure(stage: &'static str) -> DeckError {
    DeckError::new(ErrorCode::Internal, stage)
}
fn fixture_response(status: std::process::ExitStatus, response: &[u8]) -> Result<(), DeckError> {
    if response.len() > 1024 {
        return Err(failure());
    }
    match serde_json::from_slice::<Result<(), DeckError>>(response).map_err(|_| failure())? {
        // A worker reports its normal error with exit 1. Preserve bounded diagnostic
        // details, while an Ok payload never overrides an abnormal process exit.
        Err(error) => Err(error),
        Ok(()) if status.success() => Ok(()),
        Ok(()) => Err(failure()),
    }
}
fn hancom_gate_stage(error: &DeckError) -> Option<&str> {
    let stage = error.details.as_ref()?.get("hancomGateStage")?.as_str()?;
    [
        "loaded-registration-rejected",
        "module-not-loaded",
        "module-load-unknown",
    ]
    .contains(&stage)
    .then_some(stage)
}
fn fixture_stage(kind: OfficeProvider, events: &str) -> Option<&str> {
    let prefix = format!("{kind:?} ");
    let stage = events.lines().last()?.strip_prefix(&prefix)?;
    // A corrupt or foreign log never becomes diagnostic text in the report.
    [
        "apartment-begin",
        "snapshot-begin",
        "activation-begin",
        "guards-begin",
        "image-bind-begin",
        "window-bind-begin",
        "fixture-begin",
        "visible-begin",
        "hidden-begin",
        "document-check-begin",
        "add-begin",
        "text-begin",
        "style-begin",
        "gate-begin",
        "security-begin",
        "presentation-begin",
        "slide-begin",
        "textbox-begin",
        "table-begin",
        "save-begin",
        "close-begin",
        "saved",
    ]
    .contains(&stage)
    .then_some(stage)
}
fn hancom_conversion_stage(events: &str) -> Option<&str> {
    let stage = events.lines().last()?;
    [
        "apartment-begin",
        "snapshot-begin",
        "absence-begin",
        "hancom-registration-begin",
        "child-begin",
        "activation-begin",
        "guards-begin",
        "window-bind-begin",
        "secure-options-begin",
        "hancom-gate-begin",
        "hancom-hidden-begin",
        "hancom-open-begin",
        "hancom-save-begin",
        "hancom-reopen-begin",
        "complete",
    ]
    .contains(&stage)
    .then_some(stage)
}
fn root(id: &str) -> Result<PathBuf, DeckError> {
    if id.len() != 32 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(failure());
    }
    Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .ok_or_else(failure)?
        .join("target/next-tools/office-qa")
        .join(id))
}
fn provider(value: &str) -> Result<OfficeProvider, DeckError> {
    match value {
        "hancom" => Ok(OfficeProvider::Hancom),
        "excel" => Ok(OfficeProvider::Excel),
        "powerpoint" => Ok(OfficeProvider::Powerpoint),
        "word" => Ok(OfficeProvider::Word),
        _ => Err(failure()),
    }
}
fn formats(provider: OfficeProvider) -> (&'static str, OfficeFormat) {
    match provider {
        OfficeProvider::Hancom => ("hwp", OfficeFormat::Hwpx),
        OfficeProvider::Excel => ("xls", OfficeFormat::Xlsx),
        OfficeProvider::Powerpoint => ("ppt", OfficeFormat::Pptx),
        OfficeProvider::Word => ("doc", OfficeFormat::Docx),
    }
}
#[cfg(windows)]
fn fixture_worker(kind: OfficeProvider, id: &str) -> Result<(), DeckError> {
    use native_automation::{Apartment, Dispatch, boolean, number};
    let mut job = String::new();
    std::io::stdin()
        .take(129)
        .read_to_string(&mut job)
        .map_err(|_| failure())?;
    if job.len() > 128 {
        return Err(failure());
    }
    let directory = root(id)?;
    if !directory.is_dir() {
        return Err(failure());
    }
    let (extension, _) = formats(kind);
    let path = directory.join(format!("synthetic.{extension}"));
    if path.exists() {
        return Err(failure());
    }
    let record_stage = |stage: &str| -> Result<(), DeckError> {
        // Fixed fixture-stage labels only; never record COM errors or document data.
        let mut events = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(directory.join("fixture-stages.log"))
            .map_err(|_| failure())?;
        writeln!(events, "{kind:?} {stage}").map_err(|_| failure())?;
        events.sync_all().map_err(|_| failure())
    };
    record_stage("apartment-begin")?;
    let _sta = Apartment::enter()?;
    record_stage("snapshot-begin")?;
    let existing = native_workers::process_snapshot()?;
    let office_image = if matches!(
        kind,
        OfficeProvider::Word | OfficeProvider::Powerpoint | OfficeProvider::Hancom
    ) {
        Some(native_automation::registered_office_image(kind)?)
    } else {
        None
    };
    if kind == OfficeProvider::Powerpoint {
        native_workers::require_powerpoint_absent()?;
    }
    if kind == OfficeProvider::Hancom {
        native_workers::require_hancom_absent()?;
    }
    // Prepare the unique file-access registration before the owned Hancom server starts.
    let mut hancom_prepared = if kind == OfficeProvider::Hancom {
        Some(native_automation::HancomPreparedRegistration::new(
            &job, None, &path,
        )?)
    } else {
        None
    };
    let started = std::time::SystemTime::now();
    let mut launched = match kind {
        OfficeProvider::Powerpoint => Some(native_automation::LaunchedOffice::powerpoint(
            office_image.as_ref().ok_or_else(failure)?,
        )?),
        OfficeProvider::Hancom => Some(native_automation::LaunchedOffice::hancom(
            office_image.as_ref().ok_or_else(failure)?,
            &job,
        )?),
        _ => None,
    };
    record_stage("activation-begin")?;
    let activated = if kind == OfficeProvider::Hancom {
        Dispatch::activate_owned_hancom(
            &job,
            office_image.as_ref().ok_or_else(failure)?,
            launched.as_mut().ok_or_else(failure)?.live_pid()?,
        )
    } else {
        Dispatch::create(native_automation::provider_class(kind))
    };
    let app = activated.map_err(|error| {
        launched.as_mut().map_or_else(
            || error.clone(),
            |child| child.annotate_failure(error.clone()),
        )
    })?;
    record_stage("guards-begin")?;
    if kind == OfficeProvider::Word && boolean(&app.get("UserControl")?)? {
        return Err(failure());
    }
    if kind == OfficeProvider::Powerpoint
        && (number(&app.get("Visible")?)? != 0
            || number(&app.get_object("Presentations")?.get("Count")?)? != 0)
    {
        return Err(failure());
    }
    if kind == OfficeProvider::Hancom {
        record_stage("window-bind-begin")?;
        let hwnd = number(
            &app.get_object("XHwpWindows")?
                .method_object("Item", vec![0i32.into()])?
                .get("WindowHandle")?,
        )?;
        native_workers::bind_owned_office_process(
            &job,
            hwnd,
            &existing,
            launched.as_mut().ok_or_else(failure)?.live_pid()?,
        )?;
    } else if let Some(image) = office_image {
        record_stage("image-bind-begin")?;
        native_workers::bind_new_office_process(
            &job,
            &existing,
            started,
            &image,
            launched
                .as_mut()
                .map(native_automation::LaunchedOffice::live_pid)
                .transpose()?,
        )?;
    } else {
        record_stage("window-bind-begin")?;
        let hwnd = match kind {
            OfficeProvider::Word | OfficeProvider::Powerpoint => {
                app.ole_window().or_else(|_| app.command_bar_window())?
            }
            OfficeProvider::Hancom => number(
                &app.get_object("XHwpWindows")?
                    .method_object("Item", vec![0i32.into()])?
                    .get("WindowHandle")?,
            )?,
            OfficeProvider::Excel => number(&app.get("Hwnd")?)?,
        };
        native_workers::bind_office_process(&job, hwnd, &existing)?;
    }
    let text = "SYNTHETIC OFFICE QA";
    let mut _hancom_gate = None;
    record_stage("fixture-begin")?;
    let normalized_path = path.to_str().ok_or_else(failure)?.replace('/', "\\");
    let path = normalized_path.as_str();
    let result = (|| {
        match kind {
            OfficeProvider::Excel => {
                app.put("AutomationSecurity", 3i32.into())?;
                app.put("DisplayAlerts", false.into())?;
                let book = app.get_object("Workbooks")?.method_object("Add", vec![])?;
                let sheet = book
                    .get_object("Worksheets")?
                    .method_object("Item", vec![1i32.into()])?;
                let cell = sheet.method_object("Range", vec!["A1".into()])?;
                cell.put("Value2", text.into())?;
                cell.invoke("AddComment", vec!["SYNTHETIC COMMENT".into()])?;
                sheet
                    .method_object("Range", vec!["B2".into()])?
                    .put("Formula", "=SUM(1,2)".into())?;
                book.invoke("SaveAs", vec![path.into(), 56i32.into()])?;
                book.invoke("Close", vec![false.into()])?;
            }
            OfficeProvider::Word => {
                app.put("AutomationSecurity", 3i32.into())?;
                app.put("DisplayAlerts", 0i32.into())?;
                let document = app.get_object("Documents")?.method_object("Add", vec![])?;
                document.get_object("Content")?.put(
                    "Text",
                    format!("{text}\rSYNTHETIC SECOND PARAGRAPH\r")
                        .as_str()
                        .into(),
                )?;
                let range = document.method_object("Range", vec![0i32.into(), 0i32.into()])?;
                let table = document.get_object("Tables")?.method_object(
                    "Add",
                    vec![
                        document.invoke("Range", vec![0i32.into(), 0i32.into()])?,
                        2i32.into(),
                        2i32.into(),
                    ],
                )?;
                table
                    .method_object("Cell", vec![1i32.into(), 1i32.into()])?
                    .get_object("Range")?
                    .put("Text", "SYNTHETIC TABLE".into())?;
                let _ = range;
                document.invoke("SaveAs2", vec![path.into(), 0i32.into()])?;
                document.invoke("Close", vec![0i32.into()])?;
            }
            OfficeProvider::Powerpoint => {
                record_stage("security-begin")?;
                app.put("AutomationSecurity", 3i32.into())?;
                record_stage("presentation-begin")?;
                let presentation = app
                    .get_object("Presentations")?
                    .method_object("Add", vec![false.into()])?;
                record_stage("slide-begin")?;
                let slide = presentation
                    .get_object("Slides")?
                    .method_object("Add", vec![1i32.into(), 12i32.into()])?;
                record_stage("textbox-begin")?;
                let shape = slide.get_object("Shapes")?.method_object(
                    "AddTextbox",
                    vec![
                        1i32.into(),
                        20i32.into(),
                        20i32.into(),
                        400i32.into(),
                        60i32.into(),
                    ],
                )?;
                shape
                    .get_object("TextFrame")?
                    .get_object("TextRange")?
                    .put("Text", text.into())?;
                record_stage("table-begin")?;
                let table = slide
                    .get_object("Shapes")?
                    .method_object(
                        "AddTable",
                        vec![
                            2i32.into(),
                            2i32.into(),
                            20i32.into(),
                            120i32.into(),
                            400i32.into(),
                            120i32.into(),
                        ],
                    )?
                    .get_object("Table")?;
                table
                    .method_object("Cell", vec![1i32.into(), 1i32.into()])?
                    .get_object("Shape")?
                    .get_object("TextFrame")?
                    .get_object("TextRange")?
                    .put("Text", "SYNTHETIC TABLE".into())?;
                record_stage("save-begin")?;
                presentation.invoke("SaveAs", vec![path.into(), 1i32.into()])?;
                record_stage("close-begin")?;
                presentation.invoke("Close", vec![])?;
            }
            OfficeProvider::Hancom => {
                record_stage("gate-begin")?;
                let hwnd = number(
                    &app.get_object("XHwpWindows")?
                        .method_object("Item", vec![0i32.into()])?
                        .get("WindowHandle")?,
                )?;
                let gate = hancom_prepared
                    .take()
                    .ok_or_else(failure)?
                    .bind(&job, hwnd)?;
                if !boolean(&app.invoke(
                    "RegisterModule",
                    vec!["FilePathCheckDLL".into(), gate.module_name.as_str().into()],
                )?)? {
                    let mut error = fixture_failure(match gate.module_loaded() {
                        Ok(true) => "synthetic-gate-loaded-rejected",
                        Ok(false) => "synthetic-gate-not-loaded",
                        Err(_) => "synthetic-gate-load-unknown",
                    });
                    if let Ok((machine, native)) = gate.process_machines() {
                        error.details = Some(
                            serde_json::json!({"processMachine": machine, "nativeMachine": native}),
                        );
                    }
                    if let Ok((intact, signature, image)) = gate.registration_diagnostics()
                        && let Some(details) = error
                            .details
                            .as_mut()
                            .and_then(|value| value.as_object_mut())
                    {
                        details.insert("registrationIntact".into(), intact.into());
                        details.insert("signaturePolicy".into(), signature.into());
                        details.insert("imageLoadPolicy".into(), image.into());
                    }
                    return Err(error);
                }
                _hancom_gate = Some(gate);
                record_stage("hidden-begin")?;
                app.get_object("XHwpWindows")?
                    .method_object("Item", vec![0i32.into()])?
                    .put("Visible", false.into())?;
                // HwpObject already supplies an empty document. Add(false) creates a
                // different edit window than the one verified and made visible above.
                // Keep the fixture in that single verified window instead.
                record_stage("document-check-begin")?;
                if number(&app.get_object("XHwpDocuments")?.get("Count")?)? != 1 {
                    return Err(fixture_failure("synthetic-document"));
                }
                record_stage("text-begin")?;
                if !boolean(&app.invoke(
                    "SetTextFile",
                    vec![
                        HANCOM_PARAGRAPHS.join("\n").as_str().into(),
                        "TEXT".into(),
                        "".into(),
                    ],
                )?)? {
                    return Err(fixture_failure("synthetic-insert"));
                }
                record_stage("style-begin")?;
                let action = app.get_object("HAction")?;
                if !boolean(&action.invoke("Run", vec!["SelectAll".into()])?)? {
                    return Err(fixture_failure("synthetic-select"));
                }
                let shape = app.get_object("HParameterSet")?.get_object("HCharShape")?;
                let parameters = shape.get("HSet")?;
                action.invoke("GetDefault", vec!["CharShape".into(), parameters.clone()])?;
                shape.put("Bold", true.into())?;
                shape.put("Height", 1800i32.into())?;
                if !boolean(&action.invoke("Execute", vec!["CharShape".into(), parameters])?)? {
                    return Err(fixture_failure("synthetic-style"));
                }
                action.invoke("Run", vec!["Cancel".into()])?;
                record_stage("save-begin")?;
                if !boolean(&app.invoke(
                    "SaveAs",
                    vec![path.into(), "HWP".into(), native_automation::missing()],
                )?)? {
                    return Err(fixture_failure("synthetic-save"));
                }
                record_stage("saved")?;
            }
        }
        Ok(())
    })();
    // Only reached after this new COM PID was verified and assigned to the owned job.
    let _ = app.invoke("Quit", vec![]);
    result
}
#[cfg(not(windows))]
fn fixture_worker(_: OfficeProvider, _: &str) -> Result<(), DeckError> {
    Err(failure())
}
#[cfg(windows)]
fn generate(kind: OfficeProvider, name: &str, id: &str) -> Result<(), DeckError> {
    use std::os::windows::process::CommandExt;
    let group = native_workers::OfficeProcessGroup::new()?;
    let mut child = std::process::Command::new(std::env::current_exe().map_err(|_| failure())?)
        .args(["--fixture-worker", name, id])
        .creation_flags(0x08000000)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|_| failure())?;
    if let Err(error) = group.assign_child(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    let _hancom_registration = if kind == OfficeProvider::Hancom {
        let output = root(id)?.join("synthetic.hwp");
        Some(native_automation::HancomRegistrationCleanup::new(
            &group.name,
            &output,
            child.id(),
        )?)
    } else {
        None
    };
    let mut pipe = child.stdin.take().ok_or_else(failure)?;
    pipe.write_all(group.name.as_bytes())
        .map_err(|_| failure())?;
    drop(pipe);
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(status) = child.try_wait().map_err(|_| failure())? {
            if kind == OfficeProvider::Hancom {
                group.finish()?;
            }
            let mut response = vec![];
            child
                .stdout
                .take()
                .ok_or_else(failure)?
                .take(1025)
                .read_to_end(&mut response)
                .map_err(|_| failure())?;
            return fixture_response(status, &response);
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            if kind == OfficeProvider::Hancom {
                group.finish()?;
            }
            return Err(DeckError::new(
                ErrorCode::Timeout,
                if kind == OfficeProvider::Hancom {
                    "응답 시간이 지나 합성 한글 작업을 중지하고 작업 창을 정리했어요. 한글에서 직접 변환해 주세요."
                } else {
                    "응답 시간이 지나 합성 문서 작업을 중지했어요. 다시 시도할 때 문서 접근 승인을 확인해 주세요."
                },
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
#[cfg(not(windows))]
fn generate(_: OfficeProvider, _: &str, _: &str) -> Result<(), DeckError> {
    Err(failure())
}
fn contents(path: &Path) -> Result<String, DeckError> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    if archive.len() > 1000 {
        return Err(failure());
    }
    let mut output = String::new();
    for index in 0..archive.len() {
        let mut part = archive.by_index(index).map_err(|_| failure())?;
        if part.name().map_err(|_| failure())?.ends_with(".xml") {
            if part.size() > 1024 * 1024 {
                return Err(failure());
            }
            part.read_to_string(&mut output).map_err(|_| failure())?;
        }
    }
    Ok(output)
}
const HWP_HEAD_NS: &str = "http://www.hancom.co.kr/hwpml/2011/head";
const HWP_PARA_NS: &str = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const HWP_OPF_NS: &str = "http://www.idpf.org/2007/opf/";
#[derive(Default)]
struct XmlNode {
    namespace: String,
    name: String,
    attributes: std::collections::HashMap<String, String>,
    children: Vec<XmlNode>,
    text: String,
}
impl XmlNode {
    fn is(&self, namespace: &str, name: &str) -> bool {
        self.namespace == namespace && self.name == name
    }
    fn descendants<'a>(&'a self, namespace: &str, name: &str, output: &mut Vec<&'a Self>) {
        if self.is(namespace, name) {
            output.push(self);
        }
        for child in &self.children {
            child.descendants(namespace, name, output);
        }
    }
}
fn xml_namespace(value: quick_xml::name::ResolveResult<'_>) -> Result<String, DeckError> {
    match value {
        quick_xml::name::ResolveResult::Bound(namespace) => {
            quick_xml::escape::unescape(namespace.as_ref())
                .map(std::borrow::Cow::into_owned)
                .map_err(|_| failure())
        }
        quick_xml::name::ResolveResult::Unbound => Ok(String::new()),
        quick_xml::name::ResolveResult::Unknown(_) => Err(failure()),
    }
}
fn parse_fixture_xml(text: &str) -> Result<XmlNode, DeckError> {
    use quick_xml::{XmlVersion, events::Event, reader::NsReader};
    let mut reader = NsReader::from_str(text);
    reader.config_mut().check_comments = true;
    let mut stack: Vec<XmlNode> = vec![];
    let mut root = None;
    let mut nodes = 0;
    loop {
        match reader.read_event().map_err(|_| failure())? {
            event @ (Event::Start(_) | Event::Empty(_)) => {
                let empty = matches!(event, Event::Empty(_));
                let start = match event {
                    Event::Start(start) | Event::Empty(start) => start,
                    _ => return Err(failure()),
                };
                nodes += 1;
                if nodes > 10000 || stack.len() >= 64 || stack.is_empty() && root.is_some() {
                    return Err(failure());
                }
                let (namespace, name) = reader.resolver().resolve_element(start.name());
                let mut node = XmlNode {
                    namespace: xml_namespace(namespace)?,
                    name: name.as_ref().to_owned(),
                    ..XmlNode::default()
                };
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|_| failure())?;
                    if attribute.key.as_ref() == "xmlns"
                        || attribute.key.as_ref().starts_with("xmlns:")
                    {
                        continue;
                    }
                    let (namespace, name) = reader.resolver().resolve_attribute(attribute.key);
                    let namespace = xml_namespace(namespace)?;
                    // HWPX compatibility metadata uses qualified attributes such as
                    // hp:required-namespace. Preserve their expanded names so they
                    // cannot alias the unqualified id/height/charPrIDRef we verify.
                    let key = if namespace.is_empty() {
                        name.as_ref().to_owned()
                    } else {
                        format!("{{{namespace}}}{}", name.as_ref())
                    };
                    let value = attribute
                        .normalized_value(XmlVersion::Implicit1_0)
                        .map_err(|_| failure())?
                        .into_owned();
                    if node.attributes.insert(key, value).is_some() {
                        return Err(failure());
                    }
                }
                if empty {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root = Some(node);
                    }
                } else {
                    stack.push(node);
                }
            }
            Event::End(_) => {
                let node = stack.pop().ok_or_else(failure)?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    root = Some(node);
                }
            }
            Event::Text(content) => {
                if let Some(node) = stack.last_mut() {
                    node.text.push_str(&content.xml10_content());
                } else if !content.as_ref().trim().is_empty() {
                    return Err(failure());
                }
            }
            Event::CData(content) => stack
                .last_mut()
                .ok_or_else(failure)?
                .text
                .push_str(&content.xml10_content()),
            Event::GeneralRef(reference) => {
                let encoded = format!("&{};", reference.as_ref());
                let decoded = quick_xml::escape::unescape(&encoded).map_err(|_| failure())?;
                stack
                    .last_mut()
                    .ok_or_else(failure)?
                    .text
                    .push_str(&decoded);
            }
            Event::DocType(_) => return Err(failure()),
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err(failure());
    }
    root.ok_or_else(failure)
}
fn validate_hancom_xml(header: &str, section: &str) -> Result<(), DeckError> {
    let header = parse_fixture_xml(header)?;
    let section = parse_fixture_xml(section)?;
    let mut shapes = vec![];
    header.descendants(HWP_HEAD_NS, "charPr", &mut shapes);
    let mut styles = std::collections::HashMap::new();
    for shape in shapes {
        let id = shape.attributes.get("id").ok_or_else(failure)?;
        if styles.insert(id.as_str(), shape).is_some() {
            return Err(failure());
        }
    }
    let mut paragraphs = vec![];
    section.descendants(HWP_PARA_NS, "p", &mut paragraphs);
    if paragraphs.len() != HANCOM_PARAGRAPHS.len() {
        return Err(failure());
    }
    for (paragraph, expected) in paragraphs.into_iter().zip(HANCOM_PARAGRAPHS) {
        let mut text = String::new();
        for run in paragraph
            .children
            .iter()
            .filter(|node| node.is(HWP_PARA_NS, "run"))
        {
            let mut parts = vec![];
            run.descendants(HWP_PARA_NS, "t", &mut parts);
            let run_text: String = parts.iter().map(|part| part.text.as_str()).collect();
            if !run_text.is_empty() {
                let style = run
                    .attributes
                    .get("charPrIDRef")
                    .and_then(|id| styles.get(id.as_str()))
                    .ok_or_else(failure)?;
                if style.attributes.get("height").map(String::as_str) != Some("1800")
                    || !style
                        .children
                        .iter()
                        .any(|node| node.is(HWP_HEAD_NS, "bold"))
                {
                    return Err(failure());
                }
            }
            text.push_str(&run_text);
        }
        if text != expected {
            return Err(failure());
        }
    }
    Ok(())
}
fn validate_hancom_manifest(
    text: &str,
    names: &std::collections::HashSet<String>,
) -> Result<(), DeckError> {
    let sections: Vec<_> = names
        .iter()
        .filter(|name| name.starts_with("Contents/section") && name.ends_with(".xml"))
        .collect();
    if !matches!(sections.as_slice(), [section] if section.as_str() == "Contents/section0.xml") {
        return Err(failure());
    }
    let package = parse_fixture_xml(text)?;
    if !package.is(HWP_OPF_NS, "package") {
        return Err(failure());
    }
    let manifests: Vec<_> = package
        .children
        .iter()
        .filter(|node| node.is(HWP_OPF_NS, "manifest"))
        .collect();
    let spines: Vec<_> = package
        .children
        .iter()
        .filter(|node| node.is(HWP_OPF_NS, "spine"))
        .collect();
    let [manifest] = manifests.as_slice() else {
        return Err(failure());
    };
    let [spine] = spines.as_slice() else {
        return Err(failure());
    };
    let mut items = std::collections::HashMap::new();
    let mut hrefs = std::collections::HashSet::new();
    for item in manifest
        .children
        .iter()
        .filter(|node| node.is(HWP_OPF_NS, "item"))
    {
        let id = item.attributes.get("id").ok_or_else(failure)?;
        let href = item.attributes.get("href").ok_or_else(failure)?;
        if id.is_empty()
            || !names.contains(href)
            || items.insert(id.as_str(), href.as_str()).is_some()
            || !hrefs.insert(href.as_str())
        {
            return Err(failure());
        }
    }
    let mut references = std::collections::HashSet::new();
    let mut section_references = 0;
    for item in spine
        .children
        .iter()
        .filter(|node| node.is(HWP_OPF_NS, "itemref"))
    {
        let id = item.attributes.get("idref").ok_or_else(failure)?;
        let href = *items.get(id.as_str()).ok_or_else(failure)?;
        if !references.insert(id.as_str()) {
            return Err(failure());
        }
        match href {
            "Contents/header.xml" => (),
            "Contents/section0.xml" => section_references += 1,
            _ => return Err(failure()),
        }
    }
    if section_references != 1 {
        return Err(failure());
    }
    Ok(())
}
fn validate_hancom_package(path: &Path) -> Result<(), DeckError> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    if archive.len() > 1000 {
        return Err(failure());
    }
    let mut names = std::collections::HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| failure())?;
        let name = entry.name().map_err(|_| failure())?.into_owned();
        if entry.size() > 1024 * 1024
            || entry.enclosed_name().is_none()
            || !names.insert(name.clone())
        {
            return Err(failure());
        }
        // Reading every entry also verifies decompression and CRC before accepting it.
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|_| failure())?;
        if name.ends_with(".xml") || name.ends_with(".hpf") {
            parse_fixture_xml(std::str::from_utf8(&data).map_err(|_| failure())?)?;
        }
    }
    let mut read = |name: &str| -> Result<String, DeckError> {
        let mut data = String::new();
        archive
            .by_name(name)
            .map_err(|_| failure())?
            .read_to_string(&mut data)
            .map_err(|_| failure())?;
        Ok(data)
    };
    if read("mimetype")?.trim() != "application/hwp+zip" {
        return Err(failure());
    }
    validate_hancom_manifest(&read("Contents/content.hpf")?, &names)?;
    let header = read("Contents/header.xml")?;
    let section = read("Contents/section0.xml")?;
    validate_hancom_xml(&header, &section)
}
#[cfg(windows)]
fn timeout_cleanup(source: &Path, directory: &Path) -> Result<(), DeckError> {
    use std::sync::{Arc, atomic::Ordering};
    native_workers::require_powerpoint_absent()?;
    let observed = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let observed_by_thread = observed.clone();
    let finished_by_thread = finished.clone();
    let observer = std::thread::spawn(move || {
        while !finished_by_thread.load(Ordering::Acquire) {
            if native_workers::require_powerpoint_absent()
                .is_err_and(|error| error.code == ErrorCode::Busy)
            {
                observed_by_thread.store(true, Ordering::Release);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    });
    let result = native_workers::run_office_with_timeout(
        native_workers::OfficeJob {
            source: source.to_path_buf(),
            output: directory.join("timeout-synthetic.pptx"),
            format: OfficeFormat::Pptx,
            job_name: String::new(),
        },
        &AtomicBool::new(false),
        Duration::from_secs(2),
    );
    finished.store(true, Ordering::Release);
    observer.join().map_err(|_| failure())?;
    if !result.is_err_and(|error| error.code == ErrorCode::Timeout)
        || !observed.load(Ordering::Acquire)
    {
        return Err(fixture_failure("timeout-not-observed"));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if native_workers::require_powerpoint_absent().is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(fixture_failure("timeout-cleanup"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
#[cfg(windows)]
fn fresh_hancom_proof_stages(output: &Path) -> Result<PathBuf, DeckError> {
    let stages = output.with_extension("stages.log");
    if output.try_exists().map_err(|_| failure())? || stages.try_exists().map_err(|_| failure())? {
        return Err(fixture_failure("hancom-stop-not-fresh"));
    }
    Ok(stages)
}
#[cfg(windows)]
fn hancom_stop_cleanup(
    source: &Path,
    directory: &Path,
    cancel_proof: bool,
) -> Result<(), DeckError> {
    use std::sync::{Arc, atomic::Ordering};
    native_workers::require_hancom_absent()?;
    let output = directory.join(if cancel_proof {
        "cancel-synthetic.hwpx"
    } else {
        "timeout-synthetic.hwpx"
    });
    // A previous activation marker must never certify this new worker attempt.
    let stages = fresh_hancom_proof_stages(&output)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let observed = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    let cancel_by_thread = cancel.clone();
    let observed_by_thread = observed.clone();
    let finished_by_thread = finished.clone();
    let observer = std::thread::spawn(move || {
        while !finished_by_thread.load(Ordering::Acquire) {
            // Cancellation must exercise the later stage with the COM helper bound too.
            let activated = std::fs::File::open(&stages).ok().is_some_and(|file| {
                let mut text = String::new();
                file.take(4097).read_to_string(&mut text).is_ok()
                    && text.len() <= 4096
                    && text.lines().last()
                        == Some(if cancel_proof {
                            "guards-begin"
                        } else {
                            "activation-begin"
                        })
            });
            if activated
                && native_workers::require_hancom_absent()
                    .is_err_and(|error| error.code == ErrorCode::Busy)
            {
                observed_by_thread.store(true, Ordering::Release);
                if cancel_proof {
                    cancel_by_thread.store(true, Ordering::Release);
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    });
    let result = native_workers::run_office_with_timeout(
        native_workers::OfficeJob {
            source: source.to_path_buf(),
            output,
            format: OfficeFormat::Hwpx,
            job_name: String::new(),
        },
        &cancel,
        Duration::from_secs(if cancel_proof { 30 } else { 5 }),
    );
    finished.store(true, Ordering::Release);
    observer.join().map_err(|_| failure())?;
    let expected = if cancel_proof {
        ErrorCode::Cancelled
    } else {
        ErrorCode::Timeout
    };
    if !result.is_err_and(|error| error.code == expected) || !observed.load(Ordering::Acquire) {
        return Err(fixture_failure("hancom-stop-not-observed"));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if native_workers::require_hancom_absent().is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(fixture_failure("hancom-stop-cleanup"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}
fn run(selected: Option<&str>) -> Result<(), DeckError> {
    // These reusable boundary helpers are exercised only by the network adapter in production.
    #[cfg(windows)]
    let _empty_variant = native_automation::Value::default();
    #[cfg(windows)]
    let _network_helpers = (
        native_automation::strings,
        native_automation::read_strings,
        native_automation::null,
        native_workers::run_elevated,
        native_workers::current_sid,
    );
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| failure())?;
    let id = deck_core::util::to_hex(&bytes);
    let directory = root(&id)?;
    std::fs::create_dir_all(&directory).map_err(|_| failure())?;
    let availability = native_automation::availability()?;
    let mut report = vec![];
    let mut all_succeeded = true;
    for name in ["excel", "word", "powerpoint", "hancom"] {
        if selected.is_some_and(|selected| selected != name) {
            continue;
        }
        let kind = provider(name)?;
        let (extension, format) = formats(kind);
        let mut stage = "registration";
        let result = (|| {
            if !availability
                .providers
                .iter()
                .any(|p| p.provider == kind && p.registered)
            {
                return Err(native_automation::failed());
            }
            stage = "fixture";
            generate(kind, name, &id)?;
            if kind == OfficeProvider::Hancom {
                stage = "fixture-cleanup";
                // A finished fixture must leave no extra Hwp server for conversion.
                native_workers::require_hancom_absent()?;
            }
            let source = directory.join(format!("synthetic.{extension}"));
            let original = std::fs::read(&source).map_err(|_| failure())?;
            let hash = Sha256::digest(&original);
            let output = directory.join(format!("synthetic.{}", format.extension()));
            stage = "conversion";
            native_workers::run_office(
                native_workers::OfficeJob {
                    source: source.clone(),
                    output: output.clone(),
                    format,
                    job_name: String::new(),
                },
                &AtomicBool::new(false),
            )?;
            if kind == OfficeProvider::Hancom {
                stage = "conversion-cleanup";
                // Successful content alone cannot certify an orphaned native proof.
                native_workers::require_hancom_absent()?;
            }
            stage = "validation";
            if Sha256::digest(std::fs::read(&source).map_err(|_| failure())?) != hash {
                return Err(failure());
            }
            if kind == OfficeProvider::Hancom {
                validate_hancom_package(&output)?;
            }
            let xml = contents(&output)?;
            if !xml.contains("SYNTHETIC OFFICE QA")
                || matches!(kind, OfficeProvider::Word | OfficeProvider::Powerpoint)
                    && !xml.contains("SYNTHETIC TABLE")
                || kind == OfficeProvider::Excel
                    && (!xml.contains("SUM(1,2)") || !xml.contains("SYNTHETIC COMMENT"))
            {
                return Err(failure());
            }
            #[cfg(windows)]
            if kind == OfficeProvider::Powerpoint {
                stage = "timeout-cleanup";
                timeout_cleanup(&source, &directory)?;
                if Sha256::digest(std::fs::read(&source).map_err(|_| failure())?) != hash {
                    return Err(failure());
                }
            }
            Ok(())
        })();
        all_succeeded &= result.is_ok();
        let detail = result
            .as_ref()
            .err()
            .and_then(|e| match e.message.as_str() {
                "synthetic-insert"
                | "synthetic-document"
                | "synthetic-save"
                | "synthetic-gate-loaded-rejected"
                | "synthetic-gate-not-loaded"
                | "synthetic-gate-load-unknown"
                | "synthetic-select"
                | "synthetic-style"
                | "timeout-not-observed"
                | "timeout-cleanup" => Some(e.message.clone()),
                _ => None,
            });
        let hresult = result
            .as_ref()
            .err()
            .and_then(|error| error.details.as_ref())
            .and_then(|details| details.get("automationHresult"))
            .and_then(serde_json::Value::as_i64);
        let machines = result.as_ref().err().and_then(|e| e.details.as_ref()).map(|details| {
            serde_json::json!({"processMachine": details.get("processMachine"), "nativeMachine": details.get("nativeMachine")})
        });
        let load_diagnostics =
            result
                .as_ref()
                .err()
                .and_then(|e| e.details.as_ref())
                .map(|details| {
                    serde_json::json!({"registrationIntact": details.get("registrationIntact"),
                "signaturePolicy": details.get("signaturePolicy"),
                "imageLoadPolicy": details.get("imageLoadPolicy")})
                });
        let fixture_stage = if stage == "fixture" {
            std::fs::File::open(directory.join("fixture-stages.log"))
                .ok()
                .and_then(|file| {
                    let mut events = String::new();
                    file.take(4097).read_to_string(&mut events).ok()?;
                    if events.len() > 4096 {
                        return None;
                    }
                    fixture_stage(kind, &events).map(str::to_owned)
                })
        } else {
            None
        };
        let gate_stage = result.as_ref().err().and_then(hancom_gate_stage);
        report.push(serde_json::json!({ "provider": name, "success": result.is_ok(), "stage": stage, "fixtureStage": fixture_stage, "hancomGateStage": gate_stage, "detail":detail, "automationHresult": hresult, "machines":machines, "loadDiagnostics":load_diagnostics, "errorCode": result.as_ref().err().map(|e| e.code) }));
    }
    let report = serde_json::to_vec_pretty(&report).map_err(|_| failure())?;
    std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(directory.join("report.json"))
        .map_err(|_| failure())?
        .write_all(&report)
        .map_err(|_| failure())?;
    // Bounded developer report contains only provider names, booleans and generic error codes.
    std::io::stdout()
        .write_all(&report)
        .map_err(|_| failure())?;
    if all_succeeded {
        Ok(())
    } else {
        Err(failure())
    }
}
#[cfg(windows)]
fn run_timeout_proof(id: &str) -> Result<(), DeckError> {
    let directory = root(id)?;
    let source = directory.join("synthetic.ppt");
    let original = Sha256::digest(std::fs::read(&source).map_err(|_| failure())?);
    let started = Instant::now();
    let result = timeout_cleanup(&source, &directory);
    let preserved = Sha256::digest(std::fs::read(&source).map_err(|_| failure())?) == original;
    let report = serde_json::json!({"timeoutCleanup":result.is_ok(),"sourcePreserved":preserved,
        "elapsedMs": started.elapsed().as_millis(), "errorCode":result.as_ref().err().map(|error| error.code)});
    std::io::stdout()
        .write_all(
            serde_json::to_string(&report)
                .map_err(|_| failure())?
                .as_bytes(),
        )
        .map_err(|_| failure())?;
    result?;
    if !preserved {
        return Err(failure());
    }
    Ok(())
}
#[cfg(windows)]
fn run_hancom_stop_proof(id: &str) -> Result<(), DeckError> {
    let directory = root(id)?;
    let source = directory.join("synthetic.hwp");
    let original = Sha256::digest(std::fs::read(&source).map_err(|_| failure())?);
    let started = Instant::now();
    let timeout = hancom_stop_cleanup(&source, &directory, false);
    let cancellation = if timeout.is_ok() {
        hancom_stop_cleanup(&source, &directory, true)
    } else {
        Err(fixture_failure("hancom-stop-not-observed"))
    };
    let preserved = Sha256::digest(std::fs::read(&source).map_err(|_| failure())?) == original;
    let report = serde_json::json!({"provider":"hancom", "timeoutCleanup":timeout.is_ok(),
        "cancellationCleanup":cancellation.is_ok(), "sourcePreserved":preserved,
        "elapsedMs":started.elapsed().as_millis(), "timeoutErrorCode":timeout.as_ref().err().map(|error| error.code),
        "cancellationErrorCode":cancellation.as_ref().err().map(|error| error.code)});
    std::io::stdout()
        .write_all(
            serde_json::to_string(&report)
                .map_err(|_| failure())?
                .as_bytes(),
        )
        .map_err(|_| failure())?;
    timeout?;
    cancellation?;
    if !preserved {
        return Err(failure());
    }
    Ok(())
}
#[cfg(windows)]
fn run_hancom_convert_proof(id: &str) -> Result<(), DeckError> {
    // Reuse only the fixed synthetic fixture in a validated developer-owned ID.
    // No fixture regeneration, arbitrary input path, or existing output is accepted.
    let directory = root(id)?;
    let source = directory.join("synthetic.hwp");
    let output = directory.join("synthetic.hwpx");
    let stages = fresh_hancom_proof_stages(&output)?;
    if !std::fs::metadata(&source).map_err(|_| failure())?.is_file() {
        return Err(failure());
    }
    let original = Sha256::digest(std::fs::read(&source).map_err(|_| failure())?);
    let mut report_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(directory.join("conversion-proof.json"))
        .map_err(|_| failure())?;
    let conversion = native_workers::run_office(
        native_workers::OfficeJob {
            source: source.clone(),
            output: output.clone(),
            format: OfficeFormat::Hwpx,
            job_name: String::new(),
        },
        &AtomicBool::new(false),
    );
    // Keep validation and cleanup independent so a valid artifact never hides an orphan.
    let validation = validate_hancom_package(&output);
    let preserved = std::fs::read(&source)
        .map(|bytes| Sha256::digest(bytes) == original)
        .unwrap_or(false);
    let cleanup = native_workers::require_hancom_absent();
    let validated = validation.is_ok();
    let success = conversion.is_ok() && validated && preserved && cleanup.is_ok();
    let stage = if conversion.is_err() {
        "conversion"
    } else if !validated {
        "validation"
    } else if !preserved {
        "source-preservation"
    } else if cleanup.is_err() {
        "cleanup"
    } else {
        "complete"
    };
    let worker_stage = std::fs::File::open(stages).ok().and_then(|file| {
        let mut events = String::new();
        file.take(4097).read_to_string(&mut events).ok()?;
        if events.len() > 4096 {
            return None;
        }
        hancom_conversion_stage(&events).map(str::to_owned)
    });
    let report = serde_json::json!({
        "provider": "hancom", "success": success, "stage": stage,
        "conversionSucceeded": conversion.is_ok(), "conversionStage": worker_stage,
        "validationAttempted": true, "validationSucceeded": validated,
        "cleanupSucceeded": cleanup.is_ok(), "sourcePreserved": preserved,
        "inputSha256": deck_core::util::to_hex(&original),
        "conversionErrorCode": conversion.as_ref().err().map(|error| error.code),
        "hancomGateStage": conversion.as_ref().err().and_then(hancom_gate_stage),
        "validationErrorCode": validation.as_ref().err().map(|error| error.code),
        "cleanupErrorCode": cleanup.as_ref().err().map(|error| error.code),
    });
    let payload = serde_json::to_vec_pretty(&report).map_err(|_| failure())?;
    report_file.write_all(&payload).map_err(|_| failure())?;
    report_file.sync_all().map_err(|_| failure())?;
    std::io::stdout()
        .write_all(&payload)
        .map_err(|_| failure())?;
    conversion?;
    validation?;
    cleanup?;
    if !preserved {
        return Err(failure());
    }
    Ok(())
}
fn main() {
    if let Some(code) = native_workers::dispatch_worker_mode() {
        std::process::exit(code);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let is_fixture = matches!(args.as_slice(), [mode, _, _] if mode == "--fixture-worker");
    let result = match args.as_slice() {
        [mode, name, id] if mode == "--fixture-worker" => {
            provider(name).and_then(|kind| fixture_worker(kind, id))
        }
        [] => run(None),
        [mode, name] if mode == "--provider" => provider(name).and_then(|_| run(Some(name))),
        #[cfg(windows)]
        [mode, id] if mode == "--timeout-proof" => run_timeout_proof(id),
        #[cfg(windows)]
        [mode, id] if mode == "--hancom-stop-proof" => run_hancom_stop_proof(id),
        #[cfg(windows)]
        [mode, id] if mode == "--hancom-convert-proof" => run_hancom_convert_proof(id),
        _ => Err(failure()),
    };
    if is_fixture && let Ok(response) = serde_json::to_vec(&result) {
        let _ = std::io::stdout().write_all(&response);
    }
    if result.is_err() {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_only_known_last_hancom_conversion_stage() {
        assert_eq!(
            hancom_conversion_stage("hancom-open-begin\nhancom-save-begin\n"),
            Some("hancom-save-begin")
        );
        assert_eq!(hancom_conversion_stage("complete\n"), Some("complete"));
        for events in ["", "foreign", "complete\nforeign\n", "Hancom complete\n"] {
            assert_eq!(hancom_conversion_stage(events), None);
        }
    }
    #[cfg(windows)]
    #[test]
    fn fixture_response_rejects_nonzero_exit_even_with_success_payload() {
        use std::os::windows::process::ExitStatusExt;
        let success = serde_json::to_vec(&Ok::<(), DeckError>(())).unwrap();
        assert!(fixture_response(std::process::ExitStatus::from_raw(0), &success).is_ok());
        for code in [1, 0xc0000409] {
            assert!(fixture_response(std::process::ExitStatus::from_raw(code), &success).is_err());
        }
        let failure_payload = serde_json::to_vec(&Err::<(), DeckError>(failure())).unwrap();
        assert!(fixture_response(std::process::ExitStatus::from_raw(0), &failure_payload).is_err());
        let mut diagnostic = DeckError::new(
            ErrorCode::CapabilityUnavailable,
            "synthetic-gate-not-loaded",
        );
        diagnostic.details = Some(serde_json::json!({"hancomGateStage": "module-not-loaded"}));
        let failure_payload =
            serde_json::to_vec(&Err::<(), DeckError>(diagnostic.clone())).unwrap();
        for code in [0, 1, 0xc0000409] {
            assert_eq!(
                fixture_response(std::process::ExitStatus::from_raw(code), &failure_payload),
                Err(diagnostic.clone())
            );
        }
        for code in [0, 1] {
            assert!(
                fixture_response(std::process::ExitStatus::from_raw(code), b"invalid").is_err()
            );
            assert!(
                fixture_response(std::process::ExitStatus::from_raw(code), &[b' '; 1025]).is_err()
            );
        }
    }
    #[test]
    fn reports_only_known_hancom_gate_stage() {
        for stage in [
            "loaded-registration-rejected",
            "module-not-loaded",
            "module-load-unknown",
        ] {
            let mut error = failure();
            error.details = Some(serde_json::json!({"hancomGateStage": stage}));
            assert_eq!(hancom_gate_stage(&error), Some(stage));
        }
        for value in [
            serde_json::json!("foreign"),
            serde_json::json!(123),
            serde_json::Value::Null,
        ] {
            let mut error = failure();
            error.details = Some(serde_json::json!({"hancomGateStage": value}));
            assert_eq!(hancom_gate_stage(&error), None);
        }
    }
    #[cfg(windows)]
    #[test]
    fn hancom_stop_proof_rejects_previous_activation_log_or_output() {
        let mut token = [0u8; 16];
        getrandom::fill(&mut token).unwrap();
        let directory = std::env::temp_dir().join(format!(
            "teacherdeck-synthetic-proof-{}",
            deck_core::util::to_hex(&token)
        ));
        std::fs::create_dir(&directory).unwrap();
        let output = directory.join("timeout-synthetic.hwpx");
        let stages = fresh_hancom_proof_stages(&output).unwrap();
        std::fs::write(&stages, "activation-begin\n").unwrap();
        assert!(fresh_hancom_proof_stages(&output).is_err());
        std::fs::remove_file(&stages).unwrap();
        std::fs::write(&output, b"SYNTHETIC PREVIOUS OUTPUT").unwrap();
        assert!(fresh_hancom_proof_stages(&output).is_err());
        std::fs::remove_file(&output).unwrap();
        std::fs::remove_dir(&directory).unwrap();
    }
    fn hancom_header(height: &str, bold: bool) -> String {
        format!(
            "<hh:head xmlns:hh='{HWP_HEAD_NS}'><hh:charProperties><hh:charPr id='7' height='{height}'>{}</hh:charPr><hh:charPr id='8' height='1000'/></hh:charProperties></hh:head>",
            if bold { "<hh:bold/>" } else { "" }
        )
    }
    fn hancom_section(paragraphs: &[&str], reference: &str) -> String {
        let body: String = paragraphs
            .iter()
            .map(|text| {
                format!(
                    "<hp:p><hp:run charPrIDRef='{reference}'><hp:t>{text}</hp:t></hp:run></hp:p>"
                )
            })
            .collect();
        format!(
            "<hs:sec xmlns:hs='http://www.hancom.co.kr/hwpml/2011/section' xmlns:hp='{HWP_PARA_NS}'>{body}</hs:sec>"
        )
    }
    #[test]
    fn hancom_conversion_preserves_ordered_korean_english_paragraphs_and_bold_18pt() {
        let header = hancom_header("1800", true);
        let section = hancom_section(&HANCOM_PARAGRAPHS, "7");
        assert!(validate_hancom_xml(&header, &section).is_ok());
        // Provider versions can split a paragraph into several runs of the same style.
        let split = section.replace(
            "SYNTHETIC OFFICE QA",
            "SYNTHETIC </hp:t></hp:run><hp:run charPrIDRef='7'><hp:t>OFFICE QA",
        );
        assert!(validate_hancom_xml(&header, &split).is_ok());
    }
    #[test]
    fn hancom_conversion_accepts_qualified_compatibility_metadata_without_style_aliases() {
        let section = hancom_section(&HANCOM_PARAGRAPHS, "7");
        let header = hancom_header("1800", true).replace(
            "<hh:charProperties>",
            &format!("<hp:case xmlns:hp='{HWP_PARA_NS}' hp:required-namespace='http://www.hancom.co.kr/hwpml/2016/HwpUnitChar'/><hh:charProperties>"),
        );
        assert!(validate_hancom_xml(&header, &section).is_ok());
        let decorated = header.replace(
            "height='1800'",
            "height='1800' xmlns:x='urn:synthetic-metadata' x:height='1000'",
        );
        assert!(validate_hancom_xml(&decorated, &section).is_ok());
        // A same-name qualified attribute cannot replace the actual style property.
        let substituted = header.replace(
            "height='1800'",
            "xmlns:x='urn:synthetic-metadata' x:height='1800'",
        );
        assert!(validate_hancom_xml(&substituted, &section).is_err());
        let substituted_reference = section.replace(
            "charPrIDRef='7'",
            "xmlns:x='urn:synthetic-metadata' x:charPrIDRef='7'",
        );
        assert!(validate_hancom_xml(&header, &substituted_reference).is_err());
    }
    #[test]
    fn fixture_xml_rejects_duplicate_expanded_attributes_and_unknown_prefixes() {
        assert!(
            parse_fixture_xml(
                "<root xmlns:a='urn:synthetic' xmlns:b='urn:synthetic' a:id='1' b:id='2'/>"
            )
            .is_err()
        );
        assert!(parse_fixture_xml("<root a:id='1'/>").is_err());
        assert!(
            parse_fixture_xml(
                "<root xmlns:a='urn:synthetic-a' xmlns:b='urn:synthetic-b' a:id='1' b:id='2'/>"
            )
            .is_ok()
        );
    }
    #[test]
    fn hancom_package_requires_one_manifest_section_without_hidden_extra_content() {
        let manifest = format!(
            "<opf:package xmlns:opf='{HWP_OPF_NS}'><opf:manifest><opf:item id='header' href='Contents/header.xml'/><opf:item id='section0' href='Contents/section0.xml'/></opf:manifest><opf:spine><opf:itemref idref='header'/><opf:itemref idref='section0'/></opf:spine></opf:package>"
        );
        let names = std::collections::HashSet::from([
            "Contents/header.xml".to_owned(),
            "Contents/section0.xml".to_owned(),
        ]);
        assert!(validate_hancom_manifest(&manifest, &names).is_ok());
        let mut extra_names = names.clone();
        extra_names.insert("Contents/section1.xml".to_owned());
        // An unreferenced section is rejected too, rather than certifying only section0.
        assert!(validate_hancom_manifest(&manifest, &extra_names).is_err());
        let extra = manifest
            .replace(
                "</opf:manifest>",
                "<opf:item id='section1' href='Contents/section1.xml'/></opf:manifest>",
            )
            .replace(
                "</opf:spine>",
                "<opf:itemref idref='section1'/></opf:spine>",
            );
        assert!(validate_hancom_manifest(&extra, &extra_names).is_err());
        let duplicate = manifest.replace(
            "</opf:spine>",
            "<opf:itemref idref='section0'/></opf:spine>",
        );
        assert!(validate_hancom_manifest(&duplicate, &names).is_err());
        assert!(
            validate_hancom_manifest(
                &manifest.replace("<opf:itemref idref='section0'/>", ""),
                &names
            )
            .is_err()
        );
        assert!(
            validate_hancom_manifest(
                &manifest.replace("idref='section0'", "idref='missing'"),
                &names
            )
            .is_err()
        );
        let mut redirected_names = names.clone();
        redirected_names.insert("Contents/other.xml".to_owned());
        assert!(
            validate_hancom_manifest(
                &manifest.replace("href='Contents/section0.xml'", "href='Contents/other.xml'"),
                &redirected_names
            )
            .is_err()
        );
        assert!(
            validate_hancom_manifest(
                &manifest.replace(HWP_OPF_NS, "urn:synthetic-foreign"),
                &names
            )
            .is_err()
        );
    }
    #[test]
    fn hancom_conversion_rejects_changed_font_size_or_missing_bold() {
        let section = hancom_section(&HANCOM_PARAGRAPHS, "7");
        assert!(validate_hancom_xml(&hancom_header("1000", true), &section).is_err());
        assert!(validate_hancom_xml(&hancom_header("1800", false), &section).is_err());
    }
    #[test]
    fn hancom_conversion_rejects_unrelated_or_missing_character_style_references() {
        let header = hancom_header("1800", true);
        // A valid bold style elsewhere in the header cannot certify unstyled text.
        for reference in ["8", "999"] {
            assert!(
                validate_hancom_xml(&header, &hancom_section(&HANCOM_PARAGRAPHS, reference))
                    .is_err()
            );
        }
    }
    #[test]
    fn hancom_conversion_rejects_missing_reordered_or_replaced_paragraphs() {
        let header = hancom_header("1800", true);
        let [first, second, third] = HANCOM_PARAGRAPHS;
        assert!(validate_hancom_xml(&header, &hancom_section(&[first, second], "7")).is_err());
        let reordered = [second, first, third];
        assert!(validate_hancom_xml(&header, &hancom_section(&reordered, "7")).is_err());
        let replaced = [first, "SYNTHETIC REPLACEMENT", third];
        assert!(validate_hancom_xml(&header, &hancom_section(&replaced, "7")).is_err());
    }
    #[test]
    fn hancom_conversion_rejects_foreign_style_namespace_and_malformed_xml() {
        let header = hancom_header("1800", true);
        let section = hancom_section(&HANCOM_PARAGRAPHS, "7");
        let foreign = header.replace(HWP_HEAD_NS, "urn:synthetic-foreign-namespace");
        assert!(validate_hancom_xml(&foreign, &section).is_err());
        assert!(validate_hancom_xml(&header, &section.replace("</hp:p>", "</hp:run>")).is_err());
        assert!(parse_fixture_xml("<!DOCTYPE sec [<!ENTITY synthetic 'text'>]><sec/>").is_err());
    }
    #[test]
    fn reports_only_known_final_fixture_stage_for_the_selected_provider() {
        assert_eq!(
            fixture_stage(
                OfficeProvider::Hancom,
                "Hancom visible-begin\nHancom save-begin\n"
            ),
            Some("save-begin")
        );
        assert_eq!(
            fixture_stage(OfficeProvider::Hancom, "Hancom document-check-begin\n"),
            Some("document-check-begin")
        );
        for events in [
            "",
            "Excel save-begin",
            "Hancom synthetic-user-value",
            "Hancom save-begin\nforeign text",
        ] {
            assert_eq!(fixture_stage(OfficeProvider::Hancom, events), None);
        }
    }
}
