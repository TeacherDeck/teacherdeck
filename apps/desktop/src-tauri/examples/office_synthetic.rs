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
            if stage == "activation-begin"
                && request
                    .output
                    .file_name()
                    .is_some_and(|name| name == "timeout-synthetic.pptx")
            {
                // Development-only fault injection after exact Child startup. Production
                // uses a no-op callback; parent timeout must terminate this owned job.
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
fn failure() -> DeckError {
    DeckError::new(ErrorCode::Internal, "합성 문서 검증을 완료하지 못했어요.")
}
fn fixture_failure(stage: &'static str) -> DeckError {
    DeckError::new(ErrorCode::Internal, stage)
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
        "document-check-begin",
        "add-begin",
        "text-begin",
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
    let office_image = if matches!(kind, OfficeProvider::Word | OfficeProvider::Powerpoint) {
        Some(native_automation::registered_office_image(kind)?)
    } else {
        None
    };
    if kind == OfficeProvider::Powerpoint {
        native_workers::require_powerpoint_absent()?;
    }
    let started = std::time::SystemTime::now();
    let mut launched = if kind == OfficeProvider::Powerpoint {
        Some(native_automation::LaunchedOffice::powerpoint(
            office_image.as_ref().ok_or_else(failure)?,
        )?)
    } else {
        None
    };
    record_stage("activation-begin")?;
    let app = Dispatch::create(native_automation::provider_class(kind)).map_err(|error| {
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
    if let Some(image) = office_image {
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
    record_stage("fixture-begin")?;
    let path = path.to_str().ok_or_else(failure)?;
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
                record_stage("visible-begin")?;
                app.get_object("XHwpWindows")?
                    .method_object("Item", vec![0i32.into()])?
                    .put("Visible", true.into())?;
                // HwpObject already supplies an empty document. Add(false) creates a
                // different edit window than the one verified and made visible above.
                // Keep the fixture in that single verified window instead.
                record_stage("document-check-begin")?;
                if number(&app.get_object("XHwpDocuments")?.get("Count")?)? != 1 {
                    return Err(fixture_failure("synthetic-document"));
                }
                record_stage("text-begin")?;
                if !boolean(
                    &app.invoke("SetTextFile", vec![text.into(), "TEXT".into(), "".into()])?,
                )? {
                    return Err(fixture_failure("synthetic-insert"));
                }
                record_stage("save-begin")?;
                if !boolean(&app.invoke("SaveAs", vec![path.into(), "HWP".into(), "".into()])?)? {
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
    let _ = kind;
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
    let mut pipe = child.stdin.take().ok_or_else(failure)?;
    pipe.write_all(group.name.as_bytes())
        .map_err(|_| failure())?;
    drop(pipe);
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(_status) = child.try_wait().map_err(|_| failure())? {
            let mut response = vec![];
            child
                .stdout
                .take()
                .ok_or_else(failure)?
                .take(1025)
                .read_to_end(&mut response)
                .map_err(|_| failure())?;
            if response.len() > 1024 {
                return Err(failure());
            }
            return serde_json::from_slice::<Result<(), DeckError>>(&response)
                .map_err(|_| failure())?;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DeckError::new(
                ErrorCode::Timeout,
                "합성 문서 작업 응답 시간이 지났어요. 열린 승인 창은 직접 확인해 주세요.",
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
        if part.name().ends_with(".xml") {
            if part.size() > 1024 * 1024 {
                return Err(failure());
            }
            part.read_to_string(&mut output).map_err(|_| failure())?;
        }
    }
    Ok(output)
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
            stage = "validation";
            if Sha256::digest(std::fs::read(&source).map_err(|_| failure())?) != hash {
                return Err(failure());
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
        let detail = result
            .as_ref()
            .err()
            .and_then(|e| match e.message.as_str() {
                "synthetic-insert"
                | "synthetic-document"
                | "synthetic-save"
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
        report.push(serde_json::json!({ "provider": name, "success": result.is_ok(), "stage": stage, "fixtureStage": fixture_stage, "detail":detail, "automationHresult": hresult, "errorCode": result.err().map(|e| e.code) }));
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
    Ok(())
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
