// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Code generator behind `pnpm gen` (GEN-006).
//!
//! Prints every generated file as JSON (`{ "files": [{ "path", "content" }] }`) on stdout.
//! `tools/scripts/gen` writes them to disk and `check-gen` compares them in memory, so this
//! binary never touches the file system. To generate a new type, add it to a group below.

use std::error::Error;
use std::io::Write as _;
use std::path::Path;

use deck_core::caps::capture::*;
use deck_core::caps::clipboard::{
    ClipboardBlock, ClipboardCell, ClipboardRun, ClipboardWriteRichTextArgs, ClipboardWriteTextArgs,
};
use deck_core::caps::file_ops::*;
use deck_core::caps::fs::{
    BatchIdArgs, BeginWriteArgs, CloseReadArgs, CreateOutputFolderArgs, DroppedFiles, FileFilter,
    FileHandleInfo, FileRead, FileWrite, FolderHandleInfo, HandleArgs, OpenOutputFolderArgs,
    OutputBatch, PickFilesArgs, WriteChunkArgs, WriteChunkResult, WriteIdArgs,
};
use deck_core::caps::fs::{
    DestinationArgs, DestinationGrant, DestinationStatusArgs, PickDestinationArgs,
};
use deck_core::caps::fs::{FilesPage, ListFilesArgs};
use deck_core::caps::global_shortcut::*;
use deck_core::caps::media_download::*;
use deck_core::caps::messaging::*;
use deck_core::caps::network::*;
use deck_core::caps::office::*;
use deck_core::caps::overlay::*;
use deck_core::caps::presentation::*;
use deck_core::caps::school_data::*;
use deck_core::caps::storage::{KeyArgs, SetArgs};
use deck_core::caps::system::{OsInfo, SystemInfo};
use deck_core::caps::timealert::*;
use deck_core::caps::window::*;
use deck_core::caps::{NoArgs, REGISTRY};
use deck_core::catalog::{CatalogIndex, IndexEntry};
use deck_core::error::{DeckError, ErrorCode};
use deck_core::manifest::{Author, Category, ModuleManifest, UiOptions};
use deck_core::resolver::{Picked, Resolution, ResolveState, Source, UnmetCap};
use deck_core::shell::{
    FsDroppedEvent, ModuleEntry, SchoolTimetableImageArgs, ShellInfo, UpdateStatus,
};
use schemars::JsonSchema;
use serde::Serialize;
use ts_rs::{Config, TS};

const NOTICE: &str = "생성물: `pnpm gen`(crates/deck-codegen). 손으로 고치지 마세요(GEN-006).";
/// TS types modules see through `@deck/sdk`.
const SDK_DIR: &str = "packages/sdk/src/generated";
/// TS types only the shell needs.
const SHELL_DIR: &str = "apps/desktop/src/generated";

#[derive(Serialize)]
struct Output {
    path: String,
    content: String,
}

#[derive(Serialize)]
struct Report {
    files: Vec<Output>,
}

fn schema<T: JsonSchema>(path: &str) -> Result<Output, Box<dyn Error>> {
    let mut value = serde_json::to_value(schemars::schema_for!(T))?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("$comment".into(), NOTICE.into());
    }
    Ok(Output {
        path: path.to_owned(),
        content: format!("{}\n", serde_json::to_string_pretty(&value)?),
    })
}

/// `module.schema.json` with `requires`/`optional` keys limited to registered caps, so a typo in
/// a cap name fails at authoring time (the resolver still treats unknown caps as "needs update").
fn module_schema() -> Result<Output, Box<dyn Error>> {
    let mut out = schema::<ModuleManifest>("schema/module.schema.json")?;
    let mut value: serde_json::Value = serde_json::from_str(&out.content)?;
    let names: Vec<&str> = REGISTRY.iter().map(|c| c.name).collect();
    for field in ["requires", "optional"] {
        if let Some(prop) = value
            .pointer_mut(&format!("/properties/{field}"))
            .and_then(serde_json::Value::as_object_mut)
        {
            prop.insert("propertyNames".into(), serde_json::json!({ "enum": names }));
        }
    }
    out.content = format!(
        "{}
",
        serde_json::to_string_pretty(&value)?
    );
    Ok(out)
}

/// `schema/capabilities.json`: the registry for tools and docs (CAP-010).
fn capabilities_json() -> Result<Output, Box<dyn Error>> {
    let value = serde_json::json!({ "$comment": NOTICE, "capabilities": REGISTRY });
    Ok(Output {
        path: "schema/capabilities.json".into(),
        content: format!(
            "{}
",
            serde_json::to_string_pretty(&value)?
        ),
    })
}

/// SDK registry constant: versions and `long` flags (BRG-004 timeouts).
fn registry_ts() -> Result<Output, Box<dyn Error>> {
    let mut body = String::from(
        "export const CAPABILITIES = {
",
    );
    for c in REGISTRY {
        body.push_str(&format!(
            "  {}: {{
    version: {},
    methods: {{
",
            serde_json::to_string(c.name)?,
            serde_json::to_string(c.version)?
        ));
        for m in c.methods {
            body.push_str(&format!(
                "      {}: {{ long: {} }},
",
                m.name, m.long
            ));
        }
        body.push_str(
            "    },
  },
",
        );
    }
    body.push_str(
        "} as const;

export type CapName = keyof typeof CAPABILITIES;
",
    );
    Ok(Output {
        path: format!("{SDK_DIR}/registry.ts"),
        content: format!(
            "// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// {NOTICE}
{body}"
        ),
    })
}

fn ts<T: TS + 'static>(dir: &str, cfg: &Config) -> Result<Output, Box<dyn Error>> {
    let file = T::output_path().ok_or("type cannot be exported")?;
    let body = T::export_to_string(cfg)?;
    Ok(Output {
        path: format!("{dir}/{}", file.to_string_lossy().replace('\\', "/")),
        content: format!(
            "// SPDX-License-Identifier: GPL-3.0-only\n// Additional terms: see LICENSE-ADDITIONAL-TERMS\n// {NOTICE}\n{body}"
        ),
    })
}

/// Every relative import in a generated group must point at a file of the same group.
fn check_imports(group: &[Output]) -> Result<(), Box<dyn Error>> {
    for out in group {
        let dir = Path::new(&out.path).parent().ok_or("no parent")?;
        for line in out.content.lines().filter(|l| l.starts_with("import ")) {
            let target = line
                .split('"')
                .nth(1)
                .ok_or_else(|| format!("unparsable import in {}", out.path))?;
            let resolved = dir.join(target).to_string_lossy().replace('\\', "/");
            let resolved = resolved.replace("/./", "/");
            if !group.iter().any(|o| o.path == resolved) {
                return Err(format!(
                    "{} imports {target}, which is not generated in the same group",
                    out.path
                )
                .into());
            }
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    // u64 fields (seq, size) are JSON numbers; `.ts` import extensions suit nodenext + bundlers.
    let cfg = Config::new()
        .with_large_int("number")
        .with_import_extension(Some("ts"));

    let mut sdk = vec![
        ts::<MediaDownloadStartArgs>(SDK_DIR, &cfg)?,
        ts::<MediaDownloadJob>(SDK_DIR, &cfg)?,
        ts::<MediaDownloadStage>(SDK_DIR, &cfg)?,
        ts::<MediaDownloadStatus>(SDK_DIR, &cfg)?,
        ts::<MediaDownloadCancelResult>(SDK_DIR, &cfg)?,
        ts::<MessagingProvider>(SDK_DIR, &cfg)?,
        ts::<MessagingMode>(SDK_DIR, &cfg)?,
        ts::<MessagingFeature>(SDK_DIR, &cfg)?,
        ts::<MessagingVersionSupport>(SDK_DIR, &cfg)?,
        ts::<MessagingResultConfirmation>(SDK_DIR, &cfg)?,
        ts::<MessagingStage>(SDK_DIR, &cfg)?,
        ts::<MessagingItemState>(SDK_DIR, &cfg)?,
        ts::<MessagingIssueCode>(SDK_DIR, &cfg)?,
        ts::<MessagingConnectArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingConnection>(SDK_DIR, &cfg)?,
        ts::<MessagingRecipientsArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingRecipient>(SDK_DIR, &cfg)?,
        ts::<ScheduledMessage>(SDK_DIR, &cfg)?,
        ts::<MessagingPlanArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingIssue>(SDK_DIR, &cfg)?,
        ts::<MessagingPreview>(SDK_DIR, &cfg)?,
        ts::<MessagingPlan>(SDK_DIR, &cfg)?,
        ts::<MessagingStartArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingRun>(SDK_DIR, &cfg)?,
        ts::<MessagingStatusArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingItemStatus>(SDK_DIR, &cfg)?,
        ts::<MessagingStatus>(SDK_DIR, &cfg)?,
        ts::<MessagingCancelArgs>(SDK_DIR, &cfg)?,
        ts::<MessagingCancelResult>(SDK_DIR, &cfg)?,
        ts::<MessagingApprovalRequest>(SDK_DIR, &cfg)?,
        ts::<MessagingApprovalResolution>(SDK_DIR, &cfg)?,
        ts::<OfficeProvider>(SDK_DIR, &cfg)?,
        ts::<OfficeFormat>(SDK_DIR, &cfg)?,
        ts::<OfficeProviderStatus>(SDK_DIR, &cfg)?,
        ts::<OfficeAvailability>(SDK_DIR, &cfg)?,
        ts::<OfficeConvertArgs>(SDK_DIR, &cfg)?,
        ts::<OfficeValidation>(SDK_DIR, &cfg)?,
        ts::<OfficeWarningCode>(SDK_DIR, &cfg)?,
        ts::<OfficeConvertResult>(SDK_DIR, &cfg)?,
        ts::<OfficeCancelResult>(SDK_DIR, &cfg)?,
        ts::<NetworkMode>(SDK_DIR, &cfg)?,
        ts::<NetworkDecisionMode>(SDK_DIR, &cfg)?,
        ts::<NetworkDaySchedule>(SDK_DIR, &cfg)?,
        ts::<NetworkRules>(SDK_DIR, &cfg)?,
        ts::<Ipv4Patch>(SDK_DIR, &cfg)?,
        ts::<NetworkExternalProfile>(SDK_DIR, &cfg)?,
        ts::<AdapterInfo>(SDK_DIR, &cfg)?,
        ts::<NetworkInspectArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkSnapshot>(SDK_DIR, &cfg)?,
        ts::<NetworkSaveProfileArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkProfileRef>(SDK_DIR, &cfg)?,
        ts::<NetworkConfigureArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkStatusArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkRoutineArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkApplyArgs>(SDK_DIR, &cfg)?,
        ts::<NetworkTriggerStatus>(SDK_DIR, &cfg)?,
        ts::<NetworkDecision>(SDK_DIR, &cfg)?,
        ts::<NetworkRoutineState>(SDK_DIR, &cfg)?,
        ts::<RoutineStatus>(SDK_DIR, &cfg)?,
        ts::<NetworkConfigureResult>(SDK_DIR, &cfg)?,
        ts::<NetworkApplyResult>(SDK_DIR, &cfg)?,
        ts::<NetworkStopResult>(SDK_DIR, &cfg)?,
        ts::<ListFilesArgs>(SDK_DIR, &cfg)?,
        ts::<FilesPage>(SDK_DIR, &cfg)?,
        ts::<RenameItem>(SDK_DIR, &cfg)?,
        ts::<PlanRenameArgs>(SDK_DIR, &cfg)?,
        ts::<RenameStatus>(SDK_DIR, &cfg)?,
        ts::<RenamePreview>(SDK_DIR, &cfg)?,
        ts::<RenamePlan>(SDK_DIR, &cfg)?,
        ts::<ExecuteRenameArgs>(SDK_DIR, &cfg)?,
        ts::<RenameOutcome>(SDK_DIR, &cfg)?,
        ts::<RenameResult>(SDK_DIR, &cfg)?,
        ts::<ListHistoryArgs>(SDK_DIR, &cfg)?,
        ts::<RenameHistoryState>(SDK_DIR, &cfg)?,
        ts::<RenameHistory>(SDK_DIR, &cfg)?,
        ts::<RenameHistoryPage>(SDK_DIR, &cfg)?,
        ts::<UndoRenameArgs>(SDK_DIR, &cfg)?,
        ts::<UndoRenameResult>(SDK_DIR, &cfg)?,
        ts::<SchoolContextKind>(SDK_DIR, &cfg)?,
        ts::<SchoolScope>(SDK_DIR, &cfg)?,
        ts::<SchoolEnrollmentStatus>(SDK_DIR, &cfg)?,
        ts::<SchoolDateChangeKind>(SDK_DIR, &cfg)?,
        ts::<SchoolSemester>(SDK_DIR, &cfg)?,
        ts::<SchoolStudent>(SDK_DIR, &cfg)?,
        ts::<SchoolEnrollment>(SDK_DIR, &cfg)?,
        ts::<SchoolContext>(SDK_DIR, &cfg)?,
        ts::<SchoolDaySlot>(SDK_DIR, &cfg)?,
        ts::<SchoolDayTemplate>(SDK_DIR, &cfg)?,
        ts::<SchoolWeeklySlot>(SDK_DIR, &cfg)?,
        ts::<SchoolWeeklyTable>(SDK_DIR, &cfg)?,
        ts::<SchoolDayOverride>(SDK_DIR, &cfg)?,
        ts::<SchoolDateChange>(SDK_DIR, &cfg)?,
        ts::<SchoolTimetable>(SDK_DIR, &cfg)?,
        ts::<SchoolPhotoInfo>(SDK_DIR, &cfg)?,
        ts::<SchoolDataDocument>(SDK_DIR, &cfg)?,
        ts::<SaveSchoolDataArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolContextSummary>(SDK_DIR, &cfg)?,
        ts::<SchoolRequestedAccess>(SDK_DIR, &cfg)?,
        ts::<SchoolAccessGrant>(SDK_DIR, &cfg)?,
        ts::<SchoolAccessStatus>(SDK_DIR, &cfg)?,
        ts::<SchoolGrantArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolReadRosterArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolReadTimetableArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolStudentSummary>(SDK_DIR, &cfg)?,
        ts::<SchoolRosterSnapshot>(SDK_DIR, &cfg)?,
        ts::<SchoolTimetableSnapshot>(SDK_DIR, &cfg)?,
        ts::<SchoolOpenPhotoArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolPhotoResource>(SDK_DIR, &cfg)?,
        ts::<SchoolClosePhotoArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolAccessRequest>(SDK_DIR, &cfg)?,
        ts::<SchoolAccessResolution>(SDK_DIR, &cfg)?,
        ts::<SchoolGrantRecord>(SDK_DIR, &cfg)?,
        ts::<SchoolImportPhotoArgs>(SDK_DIR, &cfg)?,
        ts::<SchoolWorkbookInput>(SDK_DIR, &cfg)?,
        ts::<SchoolWorkbookOutputArgs>(SDK_DIR, &cfg)?,
        ts::<ErrorCode>(SDK_DIR, &cfg)?,
        ts::<DeckError>(SDK_DIR, &cfg)?,
        ts::<NoArgs>(SDK_DIR, &cfg)?,
        ts::<SystemInfo>(SDK_DIR, &cfg)?,
        ts::<OsInfo>(SDK_DIR, &cfg)?,
        ts::<KeyArgs>(SDK_DIR, &cfg)?,
        ts::<SetArgs>(SDK_DIR, &cfg)?,
        ts::<FileFilter>(SDK_DIR, &cfg)?,
        ts::<PickFilesArgs>(SDK_DIR, &cfg)?,
        ts::<HandleArgs>(SDK_DIR, &cfg)?,
        ts::<CloseReadArgs>(SDK_DIR, &cfg)?,
        ts::<FileRead>(SDK_DIR, &cfg)?,
        ts::<CreateOutputFolderArgs>(SDK_DIR, &cfg)?,
        ts::<OpenOutputFolderArgs>(SDK_DIR, &cfg)?,
        ts::<OutputBatch>(SDK_DIR, &cfg)?,
        ts::<BeginWriteArgs>(SDK_DIR, &cfg)?,
        ts::<FileWrite>(SDK_DIR, &cfg)?,
        ts::<WriteChunkArgs>(SDK_DIR, &cfg)?,
        ts::<WriteChunkResult>(SDK_DIR, &cfg)?,
        ts::<WriteIdArgs>(SDK_DIR, &cfg)?,
        ts::<BatchIdArgs>(SDK_DIR, &cfg)?,
        ts::<FileHandleInfo>(SDK_DIR, &cfg)?,
        ts::<FolderHandleInfo>(SDK_DIR, &cfg)?,
        ts::<DroppedFiles>(SDK_DIR, &cfg)?,
        ts::<ToggleArgs>(SDK_DIR, &cfg)?,
        ts::<DocumentRegistration>(SDK_DIR, &cfg)?,
        ts::<DocumentState>(SDK_DIR, &cfg)?,
        ts::<DocumentSaveRequested>(SDK_DIR, &cfg)?,
        ts::<CompleteDocumentSaveArgs>(SDK_DIR, &cfg)?,
        ts::<PresentationKind>(SDK_DIR, &cfg)?,
        ts::<PresentationItem>(SDK_DIR, &cfg)?,
        ts::<PresentationPayload>(SDK_DIR, &cfg)?,
        ts::<PresentationDisplay>(SDK_DIR, &cfg)?,
        ts::<OpenPresentationArgs>(SDK_DIR, &cfg)?,
        ts::<PresentationSession>(SDK_DIR, &cfg)?,
        ts::<UpdatePresentationArgs>(SDK_DIR, &cfg)?,
        ts::<ClosePresentationArgs>(SDK_DIR, &cfg)?,
        ts::<PresentationViewState>(SDK_DIR, &cfg)?,
        ts::<ClipboardWriteTextArgs>(SDK_DIR, &cfg)?,
        ts::<ClipboardWriteRichTextArgs>(SDK_DIR, &cfg)?,
        ts::<ClipboardBlock>(SDK_DIR, &cfg)?,
        ts::<ClipboardCell>(SDK_DIR, &cfg)?,
        ts::<ClipboardRun>(SDK_DIR, &cfg)?,
        ts::<PhysicalRect>(SDK_DIR, &cfg)?,
        ts::<DisplayInfo>(SDK_DIR, &cfg)?,
        ts::<CaptureNaming>(SDK_DIR, &cfg)?,
        ts::<CaptureSettings>(SDK_DIR, &cfg)?,
        ts::<CaptureArgs>(SDK_DIR, &cfg)?,
        ts::<CaptureResult>(SDK_DIR, &cfg)?,
        ts::<CaptureArmArgs>(SDK_DIR, &cfg)?,
        ts::<CaptureSession>(SDK_DIR, &cfg)?,
        ts::<CaptureStatusArgs>(SDK_DIR, &cfg)?,
        ts::<CaptureSessionArgs>(SDK_DIR, &cfg)?,
        ts::<CaptureUpdateArgs>(SDK_DIR, &cfg)?,
        ts::<CaptureCompletedEvent>(SDK_DIR, &cfg)?,
        ts::<CaptureFailedEvent>(SDK_DIR, &cfg)?,
        ts::<CaptureFormat>(SDK_DIR, &cfg)?,
        ts::<CaptureNamingMode>(SDK_DIR, &cfg)?,
        ts::<OverlayStyle>(SDK_DIR, &cfg)?,
        ts::<OverlayInfo>(SDK_DIR, &cfg)?,
        ts::<OverlayCreateArgs>(SDK_DIR, &cfg)?,
        ts::<OverlayArgs>(SDK_DIR, &cfg)?,
        ts::<OverlayUpdateArgs>(SDK_DIR, &cfg)?,
        ts::<OverlayUiLayout>(SDK_DIR, &cfg)?,
        ts::<OverlayUiState>(SDK_DIR, &cfg)?,
        ts::<OverlayUiActionArgs>(SDK_DIR, &cfg)?,
        ts::<OverlayUiAction>(SDK_DIR, &cfg)?,
        ts::<ShortcutModifier>(SDK_DIR, &cfg)?,
        ts::<ShortcutRegisterArgs>(SDK_DIR, &cfg)?,
        ts::<ShortcutInfo>(SDK_DIR, &cfg)?,
        ts::<ShortcutArgs>(SDK_DIR, &cfg)?,
        ts::<ShortcutReplaceArgs>(SDK_DIR, &cfg)?,
        ts::<ShortcutTriggeredEvent>(SDK_DIR, &cfg)?,
        ts::<DestinationGrant>(SDK_DIR, &cfg)?,
        ts::<PickDestinationArgs>(SDK_DIR, &cfg)?,
        ts::<DestinationArgs>(SDK_DIR, &cfg)?,
        ts::<DestinationStatusArgs>(SDK_DIR, &cfg)?,
    ];
    sdk.push(registry_ts()?);
    let shell = vec![
        ts::<ModuleManifest>(SHELL_DIR, &cfg)?,
        ts::<Author>(SHELL_DIR, &cfg)?,
        ts::<Category>(SHELL_DIR, &cfg)?,
        ts::<UiOptions>(SHELL_DIR, &cfg)?,
        ts::<Resolution>(SHELL_DIR, &cfg)?,
        ts::<ResolveState>(SHELL_DIR, &cfg)?,
        ts::<Picked>(SHELL_DIR, &cfg)?,
        ts::<UnmetCap>(SHELL_DIR, &cfg)?,
        ts::<Source>(SHELL_DIR, &cfg)?,
        ts::<CatalogIndex>(SHELL_DIR, &cfg)?,
        ts::<IndexEntry>(SHELL_DIR, &cfg)?,
        ts::<ShellInfo>(SHELL_DIR, &cfg)?,
        ts::<SchoolTimetableImageArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertOpenArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertTableSummary>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertPreview>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertStudentLink>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertApplyArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertExportArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertCloseArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertRosterPhotoMatch>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertRosterPhotoKey>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertRosterPhotosArgs>(SHELL_DIR, &cfg)?,
        ts::<TimeAlertRosterPhotosPreview>(SHELL_DIR, &cfg)?,
        ts::<SchoolContextKind>(SHELL_DIR, &cfg)?,
        ts::<SchoolEnrollmentStatus>(SHELL_DIR, &cfg)?,
        ts::<SchoolDateChangeKind>(SHELL_DIR, &cfg)?,
        ts::<SchoolSemester>(SHELL_DIR, &cfg)?,
        ts::<SchoolStudent>(SHELL_DIR, &cfg)?,
        ts::<SchoolEnrollment>(SHELL_DIR, &cfg)?,
        ts::<SchoolContext>(SHELL_DIR, &cfg)?,
        ts::<SchoolDaySlot>(SHELL_DIR, &cfg)?,
        ts::<SchoolDayTemplate>(SHELL_DIR, &cfg)?,
        ts::<SchoolWeeklySlot>(SHELL_DIR, &cfg)?,
        ts::<SchoolWeeklyTable>(SHELL_DIR, &cfg)?,
        ts::<SchoolDayOverride>(SHELL_DIR, &cfg)?,
        ts::<SchoolDateChange>(SHELL_DIR, &cfg)?,
        ts::<SchoolTimetable>(SHELL_DIR, &cfg)?,
        ts::<SchoolPhotoInfo>(SHELL_DIR, &cfg)?,
        ts::<SchoolDataDocument>(SHELL_DIR, &cfg)?,
        ts::<SchoolWorkbookInput>(SHELL_DIR, &cfg)?,
        ts::<ModuleEntry>(SHELL_DIR, &cfg)?,
        ts::<FsDroppedEvent>(SHELL_DIR, &cfg)?,
        ts::<UpdateStatus>(SHELL_DIR, &cfg)?,
        ts::<DocumentState>(SHELL_DIR, &cfg)?,
        ts::<DocumentAction>(SHELL_DIR, &cfg)?,
        ts::<DocumentActionResult>(SHELL_DIR, &cfg)?,
        ts::<DocumentExitAction>(SHELL_DIR, &cfg)?,
        ts::<DocumentExitRequest>(SHELL_DIR, &cfg)?,
        // Shell-side copies of payload types it forwards to modules.
        ts::<DroppedFiles>(SHELL_DIR, &cfg)?,
        ts::<FileHandleInfo>(SHELL_DIR, &cfg)?,
    ];
    check_imports(&sdk)?;
    check_imports(&shell)?;

    let mut files = vec![
        module_schema()?,
        capabilities_json()?,
        schema::<CatalogIndex>("schema/catalog.schema.json")?,
    ];
    files.extend(sdk);
    files.extend(shell);
    files.sort_by(|a, b| a.path.cmp(&b.path));

    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &Report { files })?;
    writeln!(stdout)?;
    Ok(())
}
