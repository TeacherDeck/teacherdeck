// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Owner/session handles and immutable plans around the unchanged CoolReserve engine.
use crate::file_read::{DirectoryGuard, FileReadSession};
use crate::messaging_worker::{PackageLease, StopToken, Worker, hash_file};
use crate::platform::OsRng;
use deck_core::caps::messaging::*;
use deck_core::handles::HandleTable;
use deck_core::{DeckError, ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_HANDLES: usize = 20_000;

fn failure() -> DeckError {
    DeckError::new(ErrorCode::Internal, "메신저 연동 상태를 확인하지 못했어요.")
}
fn expired() -> DeckError {
    DeckError::new(
        ErrorCode::NotFound,
        "미리보기가 만료됐어요. 다시 확인해 주세요.",
    )
}
fn invalid_handle() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 연결에서 사용할 수 있는 핸들이 아니에요.",
    )
}
fn busy() -> DeckError {
    DeckError::new(
        ErrorCode::Busy,
        "메신저 작업이 진행 중이에요. 완료하거나 중지한 뒤 다시 확인해 주세요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::CapabilityUnavailable,
        "메신저 연동 저장소를 사용할 수 없어요.",
    )
}

#[derive(Serialize)]
struct Empty {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connection {
    connection_id: String,
    account_binding: String,
    capabilities: Vec<MessagingFeature>,
    ready: bool,
    version_support: MessagingVersionSupport,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionArgs<'a> {
    connection_id: &'a str,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recipient {
    recipient_id: String,
    display_name: String,
    department: String,
    account_label: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Message<'a> {
    id: &'a str,
    recipient_ids: Vec<String>,
    title: &'a Option<String>,
    body: &'a str,
    scheduled_at: &'a str,
    attachment_paths: Vec<String>,
    content_revision: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanArgs<'a> {
    connection_id: &'a str,
    messages: Vec<Message<'a>>,
    mode: MessagingMode,
    result_confirmation: Option<MessagingResultConfirmation>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlanReply {
    plan_id: String,
    expires_at: String,
    issues: Vec<MessagingIssue>,
    items: Vec<MessagingItemStatus>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartArgs<'a> {
    plan_id: &'a str,
    confirmed: bool,
    account_binding: &'a str,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunReply {
    run_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunArgs<'a> {
    run_id: &'a str,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusReply {
    active: bool,
    mode: MessagingMode,
    stage: MessagingStage,
    progress: u32,
    total: u32,
    items: Vec<MessagingItemStatus>,
    issue: Option<MessagingIssueCode>,
}

enum Target {
    Connection(String),
    Recipient(Recipient),
    Plan(String),
    Run(String),
}
struct Attachment {
    file: FileReadSession,
    hash: String,
}
impl Attachment {
    fn check(&mut self) -> Result<(), DeckError> {
        if hash_file(&mut self.file)? != self.hash {
            return Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "첨부 파일이 바뀌었어요. 미리보기를 다시 확인해 주세요.",
            ));
        }
        Ok(())
    }
}
struct Plan {
    public_handle: String,
    private_id: String,
    account_binding: String,
    at: Instant,
    mode: MessagingMode,
    preview: Vec<MessagingPreview>,
    issues: Vec<MessagingIssue>,
    attachments: Vec<Attachment>,
    expires_at: String,
}
struct Pending {
    request: MessagingApprovalRequest,
    generation: u64,
    plan_handle: String,
    at: Instant,
    lifetime: Duration,
    answer: SyncSender<bool>,
}
struct Run {
    public_handle: String,
    private_id: String,
    mode: MessagingMode,
    ids: Vec<String>,
    attachments: Vec<Attachment>,
    finished: Arc<AtomicBool>,
    at: Instant,
}
struct Session {
    worker: Worker,
    handles: HandleTable<Target, OsRng>,
    connection: Option<Connection>,
    plans: HashMap<String, Plan>,
    runs: HashMap<String, Run>,
    _directory: DirectoryGuard,
    _ledger_lock: File,
}
struct SessionSlot {
    session: Arc<Mutex<Session>>,
    generation: u64,
    stop: StopToken,
}
impl Drop for Session {
    fn drop(&mut self) {
        for run in self.runs.values() {
            run.finished.store(true, Ordering::Release);
        }
        self.worker.stop();
    }
}
/// Prepared readonly attachment inputs resolved by the fs handle table, never a module path.
pub struct AttachmentInput {
    pub handle: String,
    pub path: PathBuf,
    pub label: String,
}
/// A bounded trusted-shell wait tied to the immutable plan's remaining lifetime.
pub struct ConfirmationWait {
    pub id: String,
    pub answer: Receiver<bool>,
    pub remaining: Duration,
}
/// Started private run and an independent owner-only cancellation guard.
pub struct StartedRun {
    pub run: MessagingRun,
    pub stop: StopToken,
    pub finished: Arc<AtomicBool>,
}
/// Per-owner helpers, durable original ledgers, and session-only private handles.
pub struct MessagingService {
    resource: Option<PathBuf>,
    data: Option<PathBuf>,
    _directory: Option<DirectoryGuard>,
    sessions: Mutex<HashMap<String, SessionSlot>>,
    pending: Mutex<HashMap<String, Pending>>,
}
impl MessagingService {
    /// Open an app-owned data root. Failures must not prevent the main app from starting.
    pub fn open(resource: PathBuf, data: PathBuf) -> Result<Self, DeckError> {
        std::fs::create_dir_all(&data).map_err(|_| unavailable())?;
        let directory = DirectoryGuard::open(&data).map_err(|_| unavailable())?;
        Ok(Self {
            resource: Some(resource),
            data: Some(data),
            _directory: Some(directory),
            sessions: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        })
    }
    /// A blocked optional service still allows every other tool to start.
    pub fn unavailable() -> Self {
        Self {
            resource: None,
            data: None,
            _directory: None,
            sessions: Mutex::new(HashMap::new()),
            pending: Mutex::new(HashMap::new()),
        }
    }
    fn session(
        &self,
        owner: &str,
        generation: u64,
        create: bool,
    ) -> Result<Arc<Mutex<Session>>, DeckError> {
        let mut sessions = self.sessions.lock().map_err(|_| failure())?;
        if let Some(slot) = sessions.get(owner) {
            let dead = slot
                .session
                .try_lock()
                .is_ok_and(|session| session.worker.is_dead());
            if slot.generation == generation && !dead {
                return Ok(slot.session.clone());
            }
            if let Some(old) = sessions.remove(owner) {
                old.stop.stop();
            }
            self.pending
                .lock()
                .map_err(|_| failure())?
                .retain(|_, p| p.request.module_id != owner);
        }
        if !create {
            return Err(invalid_handle());
        }
        if sessions.len() >= 4 {
            return Err(busy());
        }
        let resource = self.resource.as_ref().ok_or_else(unavailable)?;
        let data = self.data.as_ref().ok_or_else(unavailable)?;
        let directory = data.join(deck_core::util::to_hex(&sha2::Sha256::digest(
            owner.as_bytes(),
        )));
        std::fs::create_dir_all(&directory).map_err(|_| unavailable())?;
        let guard = DirectoryGuard::open(&directory).map_err(|_| unavailable())?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0).custom_flags(0x0020_0000);
        }
        let lock_path = directory.join("teacherdeck-owner.lock");
        if std::fs::symlink_metadata(&lock_path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(unavailable());
        }
        let ledger_lock = options.open(lock_path).map_err(|_| busy())?;
        let metadata = ledger_lock.metadata().map_err(|_| unavailable())?;
        if !metadata.is_file() {
            return Err(unavailable());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(unavailable());
            }
        }
        for filename in [
            "reservations.sqlite3",
            "reservations.sqlite3-wal",
            "reservations.sqlite3-shm",
            "reservations.sqlite3-journal",
        ] {
            if let Ok(metadata) = std::fs::symlink_metadata(directory.join(filename)) {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err(unavailable());
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 {
                        return Err(unavailable());
                    }
                }
            }
        }
        let worker = Worker::spawn(PackageLease::open(resource)?, &directory)?;
        let stop = worker.stop_token();
        let session = Arc::new(Mutex::new(Session {
            worker,
            handles: HandleTable::new(OsRng),
            connection: None,
            plans: HashMap::new(),
            runs: HashMap::new(),
            _directory: guard,
            _ledger_lock: ledger_lock,
        }));
        sessions.insert(
            owner.into(),
            SessionSlot {
                session: session.clone(),
                generation,
                stop,
            },
        );
        Ok(session)
    }
    /// Stop only this owner's helper. Its durable original retry ledger is kept.
    pub fn cancel_owner(&self, owner: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, p| p.request.module_id != owner);
        }
        if let Ok(mut sessions) = self.sessions.lock()
            && let Some(slot) = sessions.remove(owner)
        {
            slot.stop.stop();
        }
    }
    /// Fixed-provider connection, with a private fingerprint of verified self-account evidence.
    pub fn connect(&self, owner: &str, generation: u64) -> Result<MessagingConnection, DeckError> {
        let session = self.session(owner, generation, true)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let reply: Connection = session.worker.call("connect", &Empty {})?;
        if reply.connection_id.is_empty()
            || reply.connection_id.len() > 160
            || reply.account_binding.len() != 64
            || !reply.account_binding.bytes().all(|b| b.is_ascii_hexdigit())
            || reply.capabilities.len() > 3
        {
            return Err(failure());
        }
        session.handles.release_module(owner);
        session.plans.clear();
        for (_, run) in session.runs.drain() {
            run.finished.store(true, Ordering::Release);
        }
        self.pending
            .lock()
            .map_err(|_| failure())?
            .retain(|_, p| p.request.module_id != owner);
        let handle = session
            .handles
            .issue(owner, Target::Connection(reply.connection_id.clone()));
        let result = MessagingConnection {
            connection_handle: handle,
            capabilities: reply.capabilities.clone(),
            ready: reply.ready,
            version_support: reply.version_support,
        };
        session.connection = Some(reply);
        Ok(result)
    }
    /// Snapshot verified account recipients, replacing private selectors with opaque handles.
    pub fn recipients(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<Vec<MessagingRecipient>, DeckError> {
        let session = self.session(owner, generation, false)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let connection = connection_id(&session, owner, handle)?;
        let recipients: Vec<Recipient> = session.worker.call(
            "recipients",
            &ConnectionArgs {
                connection_id: &connection,
            },
        )?;
        if recipients.len() > 10_000 {
            return Err(failure());
        }
        if session.handles.len() + recipients.len() > MAX_HANDLES {
            return Err(busy());
        }
        let mut result = Vec::with_capacity(recipients.len());
        for recipient in recipients {
            if recipient.recipient_id.is_empty()
                || recipient.recipient_id.len() > 160
                || [
                    &recipient.display_name,
                    &recipient.department,
                    &recipient.account_label,
                ]
                .iter()
                .any(|s| s.len() > 2048 || s.contains('\0'))
            {
                return Err(failure());
            }
            let recipient_handle = session
                .handles
                .issue(owner, Target::Recipient(recipient.clone()));
            result.push(MessagingRecipient {
                recipient_handle,
                display_name: recipient.display_name,
                department: recipient.department,
                account_label: recipient.account_label,
            });
        }
        Ok(result)
    }
    /// Freeze all messages, receiver identities and locked attachment hashes before preview.
    pub fn plan(
        &self,
        owner: &str,
        generation: u64,
        args: MessagingPlanArgs,
        inputs: Vec<AttachmentInput>,
    ) -> Result<MessagingPlan, DeckError> {
        args.validate()?;
        let session = self.session(owner, generation, false)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let Session { handles, plans, .. } = &mut *session;
        prune_plans(handles, plans, owner);
        if session.plans.len() >= 16 || session.handles.len() >= MAX_HANDLES {
            return Err(busy());
        }
        let retained = session
            .plans
            .values()
            .map(|p| p.attachments.len())
            .chain(session.runs.values().map(|r| r.attachments.len()))
            .sum::<usize>();
        if retained + inputs.len() > 5000 {
            return Err(busy());
        }
        let connection = connection_id(&session, owner, &args.connection_handle)?;
        let account_binding = session
            .connection
            .as_ref()
            .ok_or_else(invalid_handle)?
            .account_binding
            .clone();
        let mut sources = HashMap::new();
        let mut attachments = Vec::new();
        for input in inputs {
            let mut file = FileReadSession::open(&input.path)?;
            let hash = hash_file(&mut file)?;
            let path = input.path.to_str().ok_or_else(invalid_handle)?.to_owned();
            if sources.insert(input.handle, (path, input.label)).is_some() {
                return Err(invalid_handle());
            }
            attachments.push(Attachment { file, hash });
        }
        let mut messages = Vec::with_capacity(args.messages.len());
        let mut preview = Vec::with_capacity(args.messages.len());
        for message in &args.messages {
            let mut ids = Vec::new();
            let mut labels = Vec::new();
            for handle in &message.recipients {
                let Target::Recipient(recipient) = session
                    .handles
                    .resolve(owner, handle)
                    .map_err(|_| invalid_handle())?
                else {
                    return Err(invalid_handle());
                };
                ids.push(recipient.recipient_id.clone());
                labels.push(format!(
                    "{} · {} · {}",
                    recipient.display_name, recipient.department, recipient.account_label
                ));
            }
            let mut paths = Vec::new();
            let mut attachment_labels = Vec::new();
            for handle in &message.attachment_handles {
                let (path, label) = sources.get(handle).ok_or_else(invalid_handle)?;
                paths.push(path.clone());
                attachment_labels.push(label.clone());
            }
            messages.push(Message {
                id: &message.id,
                recipient_ids: ids,
                title: &message.title,
                body: &message.body,
                scheduled_at: &message.scheduled_at,
                attachment_paths: paths,
                content_revision: message.content_revision,
            });
            preview.push(MessagingPreview {
                message: message.clone(),
                recipient_labels: labels,
                attachment_labels,
                retry_locked: false,
            });
        }
        if serde_json::to_vec(&preview).map_err(|_| failure())?.len() > 960 * 1024 {
            return Err(DeckError::new(
                ErrorCode::InvalidArgs,
                "미리보기의 전체 내용이 너무 커요. 메시지를 나누어 확인해 주세요.",
            ));
        }
        let reply: PlanReply = session.worker.call(
            "plan",
            &PlanArgs {
                connection_id: &connection,
                messages,
                mode: args.mode,
                result_confirmation: args.result_confirmation,
            },
        )?;
        let ids: Vec<String> = preview.iter().map(|p| p.message.id.clone()).collect();
        validate_items(&reply.items, &ids)?;
        if reply.plan_id.is_empty()
            || reply.plan_id.len() > 160
            || reply.expires_at.len() > 64
            || reply.issues.len() > 1000
            || reply
                .issues
                .iter()
                .any(|i| i.message_id.as_ref().is_some_and(|id| !ids.contains(id)))
        {
            return Err(failure());
        }
        for item in reply.items {
            let entry = preview
                .iter_mut()
                .find(|p| p.message.id == item.message_id)
                .ok_or_else(failure)?;
            entry.retry_locked = item.retry_locked;
        }
        let private_key = reply.plan_id.clone();
        let plan_handle = session
            .handles
            .issue(owner, Target::Plan(private_key.clone()));
        let result = MessagingPlan {
            plan_handle: plan_handle.clone(),
            preview: preview.clone(),
            expires_at: reply.expires_at,
            issues: reply.issues.clone(),
        };
        session.plans.insert(
            private_key,
            Plan {
                public_handle: plan_handle,
                private_id: reply.plan_id,
                account_binding,
                at: Instant::now(),
                mode: args.mode,
                preview,
                issues: reply.issues,
                attachments,
                expires_at: result.expires_at.clone(),
            },
        );
        Ok(result)
    }
    /// Return the immutable host-owned summary, never accepting text supplied by the iframe.
    pub fn confirmation(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<Option<String>, DeckError> {
        let session = self.session(owner, generation, false)?;
        let session = session.lock().map_err(|_| failure())?;
        let plan = resolve_plan(&session, owner, handle)?;
        if !plan.issues.is_empty() {
            return Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "미리보기의 확인 항목을 먼저 해결해 주세요.",
            ));
        }
        if plan.mode != MessagingMode::Register {
            return Ok(None);
        }
        Ok(Some(confirmation_text(&plan.preview)))
    }
    /// Queue a full trusted-shell preview with a single-use random confirmation nonce.
    pub fn request_confirmation(
        &self,
        owner: &str,
        name: &str,
        generation: u64,
        handle: &str,
    ) -> Result<Option<ConfirmationWait>, DeckError> {
        let session = self.session(owner, generation, false)?;
        let session = session.lock().map_err(|_| failure())?;
        let plan = resolve_plan(&session, owner, handle)?;
        if !plan.issues.is_empty() {
            return Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "미리보기의 확인 항목을 먼저 해결해 주세요.",
            ));
        }
        if plan.mode != MessagingMode::Register {
            return Ok(None);
        }
        let lifetime = Duration::from_secs(300)
            .checked_sub(plan.at.elapsed())
            .ok_or_else(expired)?;
        let mut pending = self.pending.lock().map_err(|_| failure())?;
        pending.retain(|_, p| p.at.elapsed() < p.lifetime);
        if pending.len() >= 16 || pending.values().any(|p| p.request.module_id == owner) {
            return Err(busy());
        }
        use deck_core::handles::RandomSource;
        let id = loop {
            let mut bytes = [0; 16];
            OsRng.fill(&mut bytes);
            let id = format!("mc_{}", deck_core::util::to_hex(&bytes));
            if !pending.contains_key(&id) {
                break id;
            }
        };
        let (answer, receive) = mpsc::sync_channel(1);
        pending.insert(
            id.clone(),
            Pending {
                request: MessagingApprovalRequest {
                    confirmation_id: id.clone(),
                    module_id: owner.into(),
                    module_name: name.into(),
                    expires_at: plan.expires_at.clone(),
                    preview: plan.preview.clone(),
                },
                generation,
                plan_handle: handle.into(),
                at: Instant::now(),
                lifetime,
                answer,
            },
        );
        Ok(Some(ConfirmationWait {
            id,
            answer: receive,
            remaining: lifetime,
        }))
    }
    /// List only active full previews for the authenticated main-shell command.
    pub fn pending_confirmations(&self) -> Result<Vec<MessagingApprovalRequest>, DeckError> {
        let mut pending = self.pending.lock().map_err(|_| failure())?;
        pending.retain(|_, p| p.at.elapsed() < p.lifetime);
        Ok(pending.values().map(|p| p.request.clone()).collect())
    }
    /// Read owner/generation so the command can reauthorize before accepting a nonce.
    pub fn confirmation_owner(&self, id: &str) -> Result<(String, u64), DeckError> {
        let pending = self.pending.lock().map_err(|_| failure())?;
        let p = pending.get(id).ok_or_else(expired)?;
        if p.at.elapsed() >= p.lifetime {
            return Err(expired());
        }
        Ok((p.request.module_id.clone(), p.generation))
    }
    /// Resolve once, requiring the same live plan and connection generation.
    pub fn resolve_confirmation(&self, args: MessagingApprovalResolution) -> Result<(), DeckError> {
        let p = self
            .pending
            .lock()
            .map_err(|_| failure())?
            .remove(&args.confirmation_id)
            .ok_or_else(expired)?;
        if p.at.elapsed() >= p.lifetime {
            return Err(expired());
        }
        if args.allow {
            self.confirmation(&p.request.module_id, p.generation, &p.plan_handle)?;
        }
        p.answer.try_send(args.allow).map_err(|_| expired())
    }
    /// Remove a timed-out/cancelled approval without modifying any draft or attempt ledger.
    pub fn cancel_confirmation(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }
    /// Consume once, recheck hashes, then permit the original durable begin-submit engine.
    pub fn start(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
        confirmed: bool,
    ) -> Result<StartedRun, DeckError> {
        let session = self.session(owner, generation, false)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let key = match session
            .handles
            .resolve(owner, handle)
            .map_err(|_| invalid_handle())?
        {
            Target::Plan(key) => key.clone(),
            _ => return Err(invalid_handle()),
        };
        let plan = resolve_plan(&session, owner, handle)?;
        if !plan.issues.is_empty() || plan.mode == MessagingMode::Register && !confirmed {
            return Err(DeckError::new(
                ErrorCode::PermissionDenied,
                "호스트에서 예약 등록을 확인해 주세요.",
            ));
        }
        let mut plan = session.plans.remove(&key).ok_or_else(expired)?;
        session
            .handles
            .release(owner, handle)
            .map_err(|_| invalid_handle())?;
        for attachment in &mut plan.attachments {
            attachment.check()?;
        }
        let reply: RunReply = match session.worker.call(
            "start",
            &StartArgs {
                plan_id: &plan.private_id,
                confirmed,
                account_binding: &plan.account_binding,
            },
        ) {
            Ok(value) => value,
            Err(error) => {
                session.worker.stop();
                return Err(error);
            }
        };
        if reply.run_id.is_empty() || reply.run_id.len() > 160 {
            session.worker.stop();
            return Err(failure());
        }
        // A successful original Runner.start proves the previous run is no longer active.
        for run in session.runs.values_mut() {
            run.finished.store(true, Ordering::Release);
            run.attachments.clear();
        }
        if session.runs.len() >= 32
            && let Some(oldest) = session
                .runs
                .iter()
                .min_by_key(|(_, r)| r.at)
                .map(|(key, _)| key.clone())
            && let Some(run) = session.runs.remove(&oldest)
        {
            session
                .handles
                .release(owner, &run.public_handle)
                .map_err(|_| invalid_handle())?;
        }
        let finished = Arc::new(AtomicBool::new(false));
        let run_handle = session
            .handles
            .issue(owner, Target::Run(reply.run_id.clone()));
        session.runs.insert(
            reply.run_id.clone(),
            Run {
                public_handle: run_handle.clone(),
                private_id: reply.run_id,
                mode: plan.mode,
                ids: plan.preview.iter().map(|p| p.message.id.clone()).collect(),
                attachments: plan.attachments,
                finished: finished.clone(),
                at: Instant::now(),
            },
        );
        Ok(StartedRun {
            run: MessagingRun { run_handle },
            stop: session.worker.stop_token(),
            finished,
        })
    }
    /// Return fixed typed stages and states, retaining attachment locks until completion.
    pub fn status(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<MessagingStatus, DeckError> {
        let session = self.session(owner, generation, false)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let key = run_key(&session, owner, handle)?;
        let private_id = session
            .runs
            .get(&key)
            .ok_or_else(invalid_handle)?
            .private_id
            .clone();
        let reply: StatusReply = session.worker.call(
            "status",
            &RunArgs {
                run_id: &private_id,
            },
        )?;
        let run = session.runs.get_mut(&key).ok_or_else(invalid_handle)?;
        validate_items(&reply.items, &run.ids)?;
        if reply.mode != run.mode
            || reply.total != run.ids.len() as u32
            || reply.progress > reply.total
        {
            return Err(failure());
        }
        if !reply.active {
            run.attachments.clear();
            run.finished.store(true, Ordering::Release);
        }
        Ok(MessagingStatus {
            run_handle: handle.into(),
            active: reply.active,
            mode: reply.mode,
            stage: reply.stage,
            progress: reply.progress,
            total: reply.total,
            items: reply.items,
            issue: reply.issue,
        })
    }
    /// Original cooperative cancel retains composer and registration retry locks.
    pub fn cancel(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<MessagingCancelResult, DeckError> {
        let session = self.session(owner, generation, false)?;
        let mut session = session.lock().map_err(|_| failure())?;
        let key = run_key(&session, owner, handle)?;
        let private_id = session
            .runs
            .get(&key)
            .ok_or_else(invalid_handle)?
            .private_id
            .clone();
        session.worker.call(
            "cancel",
            &RunArgs {
                run_id: &private_id,
            },
        )
    }
}
use sha2::Digest;
fn prune_plans(
    handles: &mut HandleTable<Target, OsRng>,
    plans: &mut HashMap<String, Plan>,
    owner: &str,
) {
    plans.retain(|_, plan| {
        if plan.at.elapsed() < Duration::from_secs(300) {
            return true;
        }
        let _ = handles.release(owner, &plan.public_handle);
        false
    });
}
fn connection_id(session: &Session, owner: &str, handle: &str) -> Result<String, DeckError> {
    let Target::Connection(id) = session
        .handles
        .resolve(owner, handle)
        .map_err(|_| invalid_handle())?
    else {
        return Err(invalid_handle());
    };
    if session
        .connection
        .as_ref()
        .is_none_or(|c| c.connection_id != *id)
    {
        return Err(invalid_handle());
    }
    Ok(id.clone())
}
fn resolve_plan<'a>(
    session: &'a Session,
    owner: &str,
    handle: &str,
) -> Result<&'a Plan, DeckError> {
    let Target::Plan(key) = session
        .handles
        .resolve(owner, handle)
        .map_err(|_| invalid_handle())?
    else {
        return Err(invalid_handle());
    };
    let plan = session.plans.get(key).ok_or_else(expired)?;
    if plan.at.elapsed() >= Duration::from_secs(300) {
        return Err(expired());
    }
    Ok(plan)
}
fn run_key(session: &Session, owner: &str, handle: &str) -> Result<String, DeckError> {
    let Target::Run(key) = session
        .handles
        .resolve(owner, handle)
        .map_err(|_| invalid_handle())?
    else {
        return Err(invalid_handle());
    };
    Ok(key.clone())
}
fn validate_items(items: &[MessagingItemStatus], ids: &[String]) -> Result<(), DeckError> {
    let actual: std::collections::HashSet<_> = items.iter().map(|i| &i.message_id).collect();
    if items.len() != ids.len()
        || actual.len() != items.len()
        || ids.iter().any(|id| !actual.contains(id))
    {
        return Err(failure());
    }
    Ok(())
}
fn confirmation_text(preview: &[MessagingPreview]) -> String {
    let mut text = format!(
        "쿨메신저 예약 {}건을 등록할까요? 아래 내용과 첨부가 쿨메신저를 통해 받는 사람에게 전달됩니다. 이미 등록을 요청한 메시지는 자동으로 다시 등록하지 않습니다.\n",
        preview.len()
    );
    for (index, p) in preview.iter().enumerate() {
        text.push_str(&format!(
            "\n{}. 예약: {}\n받는 사람: {}\n제목: {}\n본문:\n{}\n첨부: {}\n",
            index + 1,
            p.message.scheduled_at,
            p.recipient_labels.join("; "),
            p.message.title.as_deref().unwrap_or("(제목 없음)"),
            p.message.body,
            p.attachment_labels.join("; ")
        ));
    }
    text
}
/// Unload callback kills only this owner's private worker, never CoolMessenger itself.
pub fn cancel_owner(app: &tauri::AppHandle, owner: &str) {
    use tauri::Manager;
    if let Some(service) = app.try_state::<MessagingService>() {
        service.cancel_owner(owner);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expired_previews_release_handles_while_live_previews_remain_owned() {
        let owner = "synthetic-module";
        let mut handles = HandleTable::new(OsRng);
        let old_handle = handles.issue(owner, Target::Plan("old".into()));
        let live_handle = handles.issue(owner, Target::Plan("live".into()));
        let make_plan = |public_handle, at| Plan {
            public_handle,
            private_id: "synthetic-plan".into(),
            account_binding: "synthetic-binding".into(),
            at,
            mode: MessagingMode::Simulate,
            preview: vec![],
            issues: vec![],
            attachments: vec![],
            expires_at: "2026-11-01T12:00:00+09:00".into(),
        };
        let mut plans = HashMap::from([
            (
                "old".into(),
                make_plan(
                    old_handle.clone(),
                    Instant::now() - Duration::from_secs(301),
                ),
            ),
            (
                "live".into(),
                make_plan(live_handle.clone(), Instant::now()),
            ),
        ]);
        prune_plans(&mut handles, &mut plans, owner);
        assert_eq!(plans.len(), 1);
        assert!(handles.resolve(owner, &old_handle).is_err());
        assert!(handles.resolve(owner, &live_handle).is_ok());
        assert!(handles.resolve("synthetic-other", &live_handle).is_err());
        assert_eq!(handles.len(), 1);
    }
    #[test]
    fn mismatched_duplicate_or_truncated_item_results_are_rejected() {
        let item = MessagingItemStatus {
            message_id: "synthetic".into(),
            state: MessagingItemState::Draft,
            retry_locked: false,
        };
        let ids = vec!["synthetic".into()];
        assert!(validate_items(std::slice::from_ref(&item), &ids).is_ok());
        assert!(validate_items(&[], &ids).is_err());
        assert!(validate_items(&[item.clone(), item], &ids).is_err());
    }
    #[test]
    fn confirmation_comes_from_complete_immutable_preview() {
        let preview = MessagingPreview {
            message: ScheduledMessage {
                id: "synthetic".into(),
                recipients: vec![],
                title: None,
                body: "합성 본문 전체".into(),
                scheduled_at: "2026-11-01T12:00".into(),
                attachment_handles: vec![],
                content_revision: 1,
            },
            recipient_labels: vec!["합성 계정".into()],
            attachment_labels: vec!["synthetic.txt".into()],
            retry_locked: false,
        };
        let text = confirmation_text(&[preview]);
        assert!(text.contains("합성 본문 전체"));
        assert!(text.contains("synthetic.txt"));
        assert!(text.contains("합성 계정"));
        assert!(text.contains("2026-11-01T12:00"));
    }
    fn pending() -> (MessagingService, Receiver<bool>) {
        let service = MessagingService::unavailable();
        let (answer, receive) = mpsc::sync_channel(1);
        service.pending.lock().unwrap().insert(
            "synthetic-nonce".into(),
            Pending {
                request: MessagingApprovalRequest {
                    confirmation_id: "synthetic-nonce".into(),
                    module_id: "synthetic-module".into(),
                    module_name: "합성 도구".into(),
                    expires_at: "2026-11-01T12:00:00+09:00".into(),
                    preview: vec![],
                },
                generation: 1,
                plan_handle: "synthetic-plan".into(),
                at: Instant::now(),
                lifetime: Duration::from_secs(300),
                answer,
            },
        );
        (service, receive)
    }
    #[test]
    fn trusted_cancel_is_single_use_and_does_not_start_any_worker() {
        let (service, receive) = pending();
        assert!(
            service
                .resolve_confirmation(MessagingApprovalResolution {
                    confirmation_id: "forged".into(),
                    allow: false
                })
                .is_err()
        );
        service
            .resolve_confirmation(MessagingApprovalResolution {
                confirmation_id: "synthetic-nonce".into(),
                allow: false,
            })
            .unwrap();
        assert!(!receive.recv().unwrap());
        assert!(
            service
                .resolve_confirmation(MessagingApprovalResolution {
                    confirmation_id: "synthetic-nonce".into(),
                    allow: false
                })
                .is_err()
        );
        assert!(service.sessions.lock().unwrap().is_empty());
    }
    #[test]
    fn unload_and_expiry_invalidate_waiting_approval_without_touching_drafts() {
        let (service, receive) = pending();
        service.cancel_owner("synthetic-module");
        assert!(receive.recv().is_err());
        let (service, receive) = pending();
        service
            .pending
            .lock()
            .unwrap()
            .get_mut("synthetic-nonce")
            .unwrap()
            .lifetime = Duration::ZERO;
        assert!(service.pending_confirmations().unwrap().is_empty());
        assert!(receive.recv().is_err());
    }
    #[test]
    fn stale_plan_cannot_be_approved_even_with_a_real_nonce() {
        let (service, receive) = pending();
        assert!(
            service
                .resolve_confirmation(MessagingApprovalResolution {
                    confirmation_id: "synthetic-nonce".into(),
                    allow: true
                })
                .is_err()
        );
        assert!(receive.recv().is_err());
    }
}
