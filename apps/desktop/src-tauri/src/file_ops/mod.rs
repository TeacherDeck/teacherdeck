// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Host-owned rename plans and persistent protected undo (ADR-0019).
mod journal;
pub mod native;
#[cfg(test)]
mod tests;
use crate::{file_read::DirectoryGuard, platform::OsRng};
use deck_core::{
    DeckError, ErrorCode,
    caps::file_ops::*,
    handles::{HANDLE_BYTES, RandomSource},
};
use journal::{Event, Item, Place, Record};
use native::ProtectedFile;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn invalid() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "변경 계획의 파일·이름·충돌을 확인하고 다시 계획해 주세요.",
    )
}
fn unavailable() -> DeckError {
    DeckError::new(
        ErrorCode::Internal,
        "파일 변경이나 이력을 안전하게 처리하지 못했어요. 원본을 보존했으니 상태를 확인해 주세요.",
    )
}
fn denied() -> DeckError {
    DeckError::new(
        ErrorCode::PermissionDenied,
        "이 변경 계획이나 이력을 사용할 권한이 없어요.",
    )
}
fn token() -> String {
    let mut bytes = [0; HANDLE_BYTES];
    OsRng.fill(&mut bytes);
    deck_core::util::to_hex(&bytes)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|time| u64::try_from(time.as_millis()).ok())
        .unwrap_or(0)
}
struct Plan {
    owner: String,
    generation: u64,
    created: Instant,
    items: Vec<Item>,
    groups: Vec<Vec<usize>>,
    history: Option<String>,
    confirmed: bool,
}
struct Saved {
    record: Record,
    previous: String,
    undo_confirmed: bool,
}
struct HistoryCursor {
    owner: String,
    handles: Vec<String>,
    offset: usize,
    created: Instant,
}
/// Serialized by AppState's mutex. Contains only host-private paths and journals.
pub struct FileOpsService {
    root: PathBuf,
    plans: HashMap<String, Plan>,
    records: HashMap<String, Saved>,
    blocked: bool,
    cursors: HashMap<String, HistoryCursor>,
}
impl FileOpsService {
    /// Safe fallback preserves corrupt metadata and never grants file mutation.
    pub fn unavailable() -> Self {
        Self {
            root: PathBuf::new(),
            plans: HashMap::new(),
            records: HashMap::new(),
            blocked: true,
            cursors: HashMap::new(),
        }
    }
    fn available(&self) -> Result<(), DeckError> {
        if self.blocked {
            Err(unavailable())
        } else {
            Ok(())
        }
    }
    /// Clears only session plans; persistent histories remain available across restarts.
    pub fn unload(&mut self, owner: &str) {
        self.plans.retain(|_, plan| plan.owner != owner);
        self.cursors.retain(|_, cursor| cursor.owner != owner);
        for saved in self
            .records
            .values_mut()
            .filter(|saved| saved.record.owner == owner)
        {
            saved.undo_confirmed = false;
        }
    }
    /// Opens only the host-owned application data directory. No user file changes occur.
    pub fn open(root: PathBuf) -> Result<Self, DeckError> {
        if !root.is_absolute() {
            return Err(invalid());
        }
        let mut missing = Vec::new();
        let mut ancestor = root.as_path();
        while !ancestor.exists() {
            missing.push(ancestor.to_path_buf());
            ancestor = ancestor.parent().ok_or_else(invalid)?;
        }
        let mut guards = vec![DirectoryGuard::open(ancestor)?];
        for path in missing.into_iter().rev() {
            for guard in &guards {
                guard.validate()?;
            }
            fs::create_dir(&path).map_err(|_| unavailable())?;
            guards.push(DirectoryGuard::open(&path)?);
        }
        DirectoryGuard::open(&root)?.validate()?;
        let mut records = HashMap::new();
        let mut bytes = 0_u64;
        let mut files = 0;
        for entry in fs::read_dir(&root).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            files += 1;
            if files > 200 {
                return Err(unavailable());
            }
            let pathname = entry.path();
            let meta = fs::symlink_metadata(&pathname).map_err(|_| unavailable())?;
            if native::reparse(&meta) || !meta.is_file() {
                return Err(unavailable());
            }
            bytes += meta.len();
            if bytes > 64 * 1024 * 1024 {
                return Err(unavailable());
            }
            let handle = pathname
                .file_stem()
                .and_then(|name| name.to_str())
                .ok_or_else(unavailable)?;
            if pathname.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                return Err(unavailable());
            }
            let (record, previous) = journal::load(&root, handle)?;
            records.insert(
                handle.into(),
                Saved {
                    record,
                    previous,
                    undo_confirmed: false,
                },
            );
        }
        Ok(Self {
            root,
            plans: HashMap::new(),
            records,
            blocked: false,
            cursors: HashMap::new(),
        })
    }
    /// Resolves are performed by the cap under module/session authorization first.
    pub fn plan(
        &mut self,
        owner: &str,
        generation: u64,
        inputs: Vec<(String, PathBuf, String)>,
    ) -> Result<RenamePlan, DeckError> {
        self.available()?;
        if inputs.is_empty() || inputs.len() > 2000 {
            return Err(invalid());
        }
        // Reject oversized batches before hashing gigabytes. ProtectedFile still
        // rechecks exact metadata/identity after acquisition, so this is only a limit preflight.
        let mut declared_bytes = 0_u64;
        for (_, path, _) in &inputs {
            let metadata = fs::symlink_metadata(path).map_err(|_| invalid())?;
            if native::reparse(&metadata)
                || !metadata.is_file()
                || metadata.len() > 512 * 1024 * 1024
            {
                return Err(invalid());
            }
            declared_bytes = declared_bytes
                .checked_add(metadata.len())
                .ok_or_else(invalid)?;
            if declared_bytes > 2 * 1024 * 1024 * 1024 {
                return Err(invalid());
            }
        }
        self.plans
            .retain(|_, plan| plan.created.elapsed() < Duration::from_secs(300));
        if self
            .plans
            .values()
            .filter(|plan| plan.owner == owner)
            .count()
            >= 8
        {
            return Err(DeckError::new(
                ErrorCode::Busy,
                "변경 계획이 많아요. 잠시 후 새로 확인해 주세요.",
            ));
        }
        let mut items = Vec::new();
        let mut previews = Vec::new();
        let mut identities = HashSet::new();
        let mut bytes = 0_u64;
        for (source, path, new) in inputs {
            let parent = path.parent().ok_or_else(invalid)?.to_path_buf();
            let old = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(invalid)?
                .to_owned();
            if path.starts_with(&self.root) {
                return Err(denied());
            }
            let mut file = ProtectedFile::open(&path)?;
            let stamp = file.fingerprint()?;
            bytes = bytes.checked_add(stamp.size).ok_or_else(invalid)?;
            if bytes > 2 * 1024 * 1024 * 1024 {
                return Err(invalid());
            }
            let identity = (stamp.volume, stamp.id);
            let status = if !valid_target_name(&new) || !identities.insert(identity) {
                RenameStatus::Invalid
            } else if old == new {
                RenameStatus::Unchanged
            } else {
                RenameStatus::Ready
            };
            previews.push(RenamePreview {
                source_handle: source.clone(),
                final_name: new.clone(),
                status: status.clone(),
            });
            items.push(Item {
                source,
                parent,
                old,
                new,
                temporary: format!(".deck-rename-{}.tmp", token()),
                stamp,
                place: Place::Old,
                status,
            });
        }
        let mut destinations = HashMap::<(PathBuf, String), Vec<usize>>::new();
        let sources: HashSet<_> = items
            .iter()
            .map(|item| (item.parent.clone(), item.old.to_uppercase()))
            .collect();
        let parents: HashSet<_> = items.iter().map(|item| item.parent.clone()).collect();
        let mut occupied = HashSet::new();
        for parent in parents {
            let _guard = DirectoryGuard::open(&parent)?;
            let mut count = 0;
            for entry in fs::read_dir(&parent).map_err(|_| unavailable())? {
                count += 1;
                if count > 8192 {
                    return Err(invalid());
                }
                let entry = entry.map_err(|_| unavailable())?;
                occupied.insert((
                    parent.clone(),
                    entry.file_name().to_string_lossy().to_uppercase(),
                ));
            }
        }
        for (index, item) in items.iter().enumerate() {
            destinations
                .entry((item.parent.clone(), item.new.to_uppercase()))
                .or_default()
                .push(index);
        }
        for (target, indexes) in destinations {
            let conflict =
                indexes.len() > 1 || (occupied.contains(&target) && !sources.contains(&target));
            if conflict {
                for index in indexes {
                    if let Some(item) = items.get_mut(index) {
                        item.status = RenameStatus::Conflict;
                    }
                    if let Some(row) = previews.get_mut(index) {
                        row.status = RenameStatus::Conflict;
                    }
                }
            }
        }
        let groups = groups(&items);
        let handle = token();
        self.plans.insert(
            handle.clone(),
            Plan {
                owner: owner.into(),
                generation,
                created: Instant::now(),
                items,
                groups,
                history: None,
                confirmed: false,
            },
        );
        Ok(RenamePlan {
            plan_handle: handle,
            items: previews,
            expires_at: now() + 300_000,
        })
    }
    fn checked_plan(&self, owner: &str, generation: u64, handle: &str) -> Result<&Plan, DeckError> {
        self.available()?;
        let plan = self.plans.get(handle).ok_or_else(denied)?;
        if plan.owner != owner || plan.generation != generation {
            return Err(denied());
        }
        if plan.created.elapsed() >= Duration::from_secs(300) {
            return Err(DeckError::new(
                ErrorCode::Timeout,
                "변경 계획의 시간이 지났어요. 충돌을 다시 확인해 주세요.",
            ));
        }
        Ok(plan)
    }
    /// True only before the first native mutation in this plan.
    pub fn needs_confirmation(
        &self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<bool, DeckError> {
        Ok(!self.checked_plan(owner, generation, handle)?.confirmed)
    }
    /// Called only after a positive native host dialog response and authorization recheck.
    pub fn confirm(&mut self, owner: &str, generation: u64, handle: &str) -> Result<(), DeckError> {
        self.checked_plan(owner, generation, handle)?;
        self.plans.get_mut(handle).ok_or_else(denied)?.confirmed = true;
        Ok(())
    }
    fn capacity(&mut self, owner: &str) -> Result<(), DeckError> {
        let mut records: Vec<_> = self
            .records
            .values()
            .filter(|saved| saved.record.owner == owner)
            .map(|saved| {
                (
                    saved.record.created,
                    saved.record.handle.clone(),
                    saved.record.state.clone(),
                )
            })
            .collect();
        records.sort_by_key(|row| row.0);
        while records.len() >= 20 {
            let position = records
                .iter()
                .position(|row| {
                    matches!(
                        row.2,
                        RenameHistoryState::Completed | RenameHistoryState::Undone
                    )
                })
                .ok_or_else(unavailable)?;
            let (_, handle, _) = records.remove(position);
            DirectoryGuard::open(&self.root)?.validate()?;
            let path = journal::path(&self.root, &handle)?;
            let meta = fs::symlink_metadata(&path).map_err(|_| unavailable())?;
            if native::reparse(&meta) {
                return Err(unavailable());
            }
            fs::remove_file(path).map_err(|_| unavailable())?;
            self.records.remove(&handle);
        }
        let bytes = fs::read_dir(&self.root)
            .map_err(|_| unavailable())?
            .try_fold(0_u64, |total, entry| {
                let entry = entry.map_err(|_| unavailable())?;
                let meta = fs::symlink_metadata(entry.path()).map_err(|_| unavailable())?;
                total.checked_add(meta.len()).ok_or_else(unavailable)
            })?;
        // Reserve the complete per-journal allowance before user names can change.
        if bytes + journal::MAX_JOURNAL > 64 * 1024 * 1024 {
            return Err(unavailable());
        }
        Ok(())
    }
    /// Advances exactly one connected group. Repeat with the same plan until done=true.
    pub fn execute(
        &mut self,
        owner: &str,
        generation: u64,
        handle: &str,
    ) -> Result<RenameResult, DeckError> {
        let plan = self.checked_plan(owner, generation, handle)?;
        if !plan.confirmed {
            return Err(denied());
        }
        if plan
            .items
            .iter()
            .any(|item| !matches!(item.status, RenameStatus::Ready | RenameStatus::Unchanged))
        {
            return Err(invalid());
        }
        let history = if let Some(history) = &plan.history {
            history.clone()
        } else {
            self.capacity(owner)?;
            let plan = self.checked_plan(owner, generation, handle)?;
            let history = token();
            let record = Record {
                version: 1,
                owner: owner.into(),
                handle: history.clone(),
                created: now(),
                items: plan.items.clone(),
                groups: plan.groups.clone(),
                next: 0,
                undo_next: 0,
                state: RenameHistoryState::Pending,
                intent: None,
            };
            let mut previous = String::new();
            journal::append(
                &self.root,
                &history,
                &mut previous,
                Event::Start(record.clone()),
                true,
            )?;
            self.records.insert(
                history.clone(),
                Saved {
                    record,
                    previous,
                    undo_confirmed: false,
                },
            );
            self.plans.get_mut(handle).ok_or_else(denied)?.history = Some(history.clone());
            history
        };
        self.reload(&history, owner)?;
        let saved = self.records.get_mut(&history).ok_or_else(unavailable)?;
        if let Some((group, _)) = saved.record.intent {
            recover(&self.root, saved, group)?;
        }
        if saved.record.next < saved.record.groups.len() {
            let group = saved.record.next;
            advance(&self.root, saved, group, false)?;
        }
        if saved.record.next == saved.record.groups.len()
            && saved.record.state != RenameHistoryState::Blocked
        {
            emit(
                &self.root,
                saved,
                Event::State(RenameHistoryState::Completed),
            )?;
        }
        Ok(result(&saved.record))
    }
    fn reload(&mut self, handle: &str, owner: &str) -> Result<(), DeckError> {
        self.available()?;
        let (record, previous) = journal::load(&self.root, handle)?;
        if record.owner != owner {
            return Err(denied());
        }
        let confirmed = self
            .records
            .get(handle)
            .is_some_and(|saved| saved.undo_confirmed);
        self.records.insert(
            handle.into(),
            Saved {
                record,
                previous,
                undo_confirmed: confirmed,
            },
        );
        Ok(())
    }
    /// Lists owner-private summaries; interruption repair never runs without confirmation.
    pub fn history(
        &mut self,
        owner: &str,
        args: ListHistoryArgs,
    ) -> Result<RenameHistoryPage, DeckError> {
        self.available()?;
        let limit = args.limit.unwrap_or(20);
        if limit == 0 || limit > 20 {
            return Err(invalid());
        }
        self.cursors
            .retain(|_, cursor| cursor.created.elapsed() < Duration::from_secs(300));
        let cursor = if let Some(cursor) = args.cursor {
            cursor
        } else {
            if self
                .cursors
                .values()
                .filter(|cursor| cursor.owner == owner)
                .count()
                >= 8
            {
                return Err(invalid());
            }
            let mut rows: Vec<_> = self
                .records
                .values()
                .filter(|saved| saved.record.owner == owner)
                .map(|saved| (saved.record.created, saved.record.handle.clone()))
                .collect();
            rows.sort_by_key(|row| std::cmp::Reverse(row.0));
            let cursor = token();
            self.cursors.insert(
                cursor.clone(),
                HistoryCursor {
                    owner: owner.into(),
                    handles: rows.into_iter().map(|(_, handle)| handle).collect(),
                    offset: 0,
                    created: Instant::now(),
                },
            );
            cursor
        };
        let page = self.cursors.get(&cursor).ok_or_else(invalid)?;
        if page.owner != owner {
            return Err(denied());
        }
        let end = (page.offset + limit as usize).min(page.handles.len());
        let handles = page
            .handles
            .get(page.offset..end)
            .ok_or_else(invalid)?
            .to_vec();
        let mut entries = Vec::new();
        for handle in handles {
            self.reload(&handle, owner)?;
            entries.push(summary(
                &self.records.get(&handle).ok_or_else(unavailable)?.record,
            ));
        }
        let page = self.cursors.get_mut(&cursor).ok_or_else(invalid)?;
        page.offset = end;
        let finished = end == page.handles.len();
        if finished {
            self.cursors.remove(&cursor);
        }
        Ok(RenameHistoryPage {
            entries,
            next_cursor: (!finished).then_some(cursor),
        })
    }
    /// Host confirms the first restore call in this application session.
    pub fn undo_needs_confirmation(
        &mut self,
        owner: &str,
        handle: &str,
    ) -> Result<bool, DeckError> {
        self.reload(handle, owner)?;
        Ok(!self.records.get(handle).ok_or_else(denied)?.undo_confirmed)
    }
    /// Native host confirmation callback after authorization recheck.
    pub fn confirm_undo(&mut self, owner: &str, handle: &str) -> Result<(), DeckError> {
        self.reload(handle, owner)?;
        self.records
            .get_mut(handle)
            .ok_or_else(denied)?
            .undo_confirmed = true;
        Ok(())
    }
    /// Restores one group only after complete identity/content/occupancy verification.
    pub fn undo(&mut self, owner: &str, handle: &str) -> Result<UndoRenameResult, DeckError> {
        self.reload(handle, owner)?;
        let saved = self.records.get_mut(handle).ok_or_else(denied)?;
        if !saved.undo_confirmed {
            return Err(denied());
        }
        if let Some((group, _)) = saved.record.intent {
            recover(&self.root, saved, group)?;
        }
        if saved.record.undo_next < saved.record.groups.len() {
            let group = saved.record.undo_next;
            advance(&self.root, saved, group, true)?;
        }
        let done = saved.record.undo_next == saved.record.groups.len();
        if done {
            let state = if saved
                .record
                .items
                .iter()
                .any(|item| item.place == Place::Blocked)
            {
                RenameHistoryState::Blocked
            } else {
                RenameHistoryState::Undone
            };
            emit(&self.root, saved, Event::State(state))?;
        }
        let success = saved
            .record
            .items
            .iter()
            .filter(|item| item.place == Place::Restored)
            .count() as u32;
        let blocked = saved
            .record
            .items
            .iter()
            .filter(|item| item.place == Place::Blocked)
            .count() as u32;
        Ok(UndoRenameResult {
            success,
            failed: 0,
            blocked,
            done,
        })
    }
}
fn groups(items: &[Item]) -> Vec<Vec<usize>> {
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        if item.status != RenameStatus::Ready || seen.contains(&index) {
            continue;
        }
        let mut group = vec![index];
        seen.insert(index);
        let mut cursor = 0;
        while let Some(current) = group.get(cursor).copied() {
            cursor += 1;
            let Some(a) = items.get(current) else { break };
            for (other, b) in items.iter().enumerate() {
                if b.status == RenameStatus::Ready
                    && !seen.contains(&other)
                    && a.parent == b.parent
                    && (a.new.to_uppercase() == b.old.to_uppercase()
                        || b.new.to_uppercase() == a.old.to_uppercase())
                {
                    seen.insert(other);
                    group.push(other);
                }
            }
        }
        output.push(group);
    }
    output
}
fn emit(root: &Path, saved: &mut Saved, event: Event) -> Result<(), DeckError> {
    let serialized = serde_json::to_vec(&event).map_err(|_| unavailable())?;
    journal::append(
        root,
        &saved.record.handle,
        &mut saved.previous,
        event,
        false,
    )?;
    let event = serde_json::from_slice(&serialized).map_err(|_| unavailable())?;
    journal::apply(&mut saved.record, event)
}
fn summary(record: &Record) -> RenameHistory {
    RenameHistory {
        history_handle: record.handle.clone(),
        created_at: record.created,
        total: record
            .items
            .iter()
            .filter(|item| item.status != RenameStatus::Unchanged)
            .count() as u32,
        success: record
            .items
            .iter()
            .filter(|item| item.status == RenameStatus::Success)
            .count() as u32,
        blocked: record
            .items
            .iter()
            .filter(|item| item.place == Place::Blocked)
            .count() as u32,
        state: record.state.clone(),
    }
}
fn result(record: &Record) -> RenameResult {
    RenameResult {
        history_handle: Some(record.handle.clone()),
        success: record
            .items
            .iter()
            .filter(|item| item.status == RenameStatus::Success)
            .count() as u32,
        failed: record
            .items
            .iter()
            .filter(|item| {
                matches!(
                    item.status,
                    RenameStatus::Failed | RenameStatus::Changed | RenameStatus::Conflict
                )
            })
            .count() as u32,
        not_started: record
            .items
            .iter()
            .filter(|item| item.status == RenameStatus::Ready)
            .count() as u32,
        items: record
            .items
            .iter()
            .map(|item| RenameOutcome {
                source_handle: item.source.clone(),
                status: if item.status == RenameStatus::Ready {
                    RenameStatus::NotStarted
                } else {
                    item.status.clone()
                },
            })
            .collect(),
        done: record.next == record.groups.len(),
    }
}
struct OpenItem {
    index: usize,
    file: ProtectedFile,
    path: PathBuf,
}
fn locate(item: &Item) -> Result<(ProtectedFile, PathBuf), DeckError> {
    let mut matched = None;
    for name in [&item.old, &item.temporary, &item.new] {
        let path = item.parent.join(name);
        if !path.exists() {
            continue;
        }
        if let Ok(mut file) = ProtectedFile::open(&path)
            && file.fingerprint()? == item.stamp
        {
            if matched.is_some() {
                return Err(invalid());
            }
            matched = Some((file, path));
        }
    }
    matched.ok_or_else(invalid)
}
fn open_group(
    record: &Record,
    group: usize,
    undo: bool,
    recovery: bool,
) -> Result<Vec<OpenItem>, DeckError> {
    let mut opened = Vec::new();
    for index in record.groups.get(group).ok_or_else(invalid)? {
        let item = record.items.get(*index).ok_or_else(invalid)?;
        if undo && !recovery && matches!(item.place, Place::Old | Place::Restored) {
            continue;
        }
        if recovery {
            let (file, path) = locate(item)?;
            opened.push(OpenItem {
                index: *index,
                file,
                path,
            });
        } else {
            let path = item.parent.join(if undo { &item.new } else { &item.old });
            let mut file = ProtectedFile::open(&path)?;
            if file.fingerprint()? != item.stamp {
                return Err(invalid());
            }
            opened.push(OpenItem {
                index: *index,
                file,
                path,
            });
        }
    }
    // Occupied destinations are allowed only when they are exact acquired source paths.
    let sources: HashSet<_> = opened
        .iter()
        .map(|open| open.path.to_string_lossy().to_uppercase())
        .collect();
    for open in &opened {
        let item = record.items.get(open.index).ok_or_else(invalid)?;
        let target = item.parent.join(if undo || recovery {
            &item.old
        } else {
            &item.new
        });
        if target.exists() && !sources.contains(&target.to_string_lossy().to_uppercase()) {
            return Err(invalid());
        }
    }
    Ok(opened)
}
enum TransferFailure {
    Native,
    Journal(DeckError),
}
fn transfer(
    root: &Path,
    saved: &mut Saved,
    opened: &mut [OpenItem],
    undo: bool,
) -> Result<(), TransferFailure> {
    for open in opened.iter_mut() {
        let item = saved
            .record
            .items
            .get(open.index)
            .ok_or(TransferFailure::Native)?;
        let temporary = item.parent.join(&item.temporary);
        if open.path != temporary {
            open.file
                .rename_to(&temporary)
                .map_err(|_| TransferFailure::Native)?;
            open.path = temporary;
            emit(
                root,
                saved,
                Event::Moved {
                    index: open.index,
                    place: Place::Temporary,
                },
            )
            .map_err(TransferFailure::Journal)?;
        }
    }
    for open in opened.iter_mut() {
        let item = saved
            .record
            .items
            .get(open.index)
            .ok_or(TransferFailure::Native)?;
        let destination = item.parent.join(if undo { &item.old } else { &item.new });
        open.file
            .rename_to(&destination)
            .map_err(|_| TransferFailure::Native)?;
        open.path = destination;
        emit(
            root,
            saved,
            Event::Moved {
                index: open.index,
                place: if undo { Place::Restored } else { Place::New },
            },
        )
        .map_err(TransferFailure::Journal)?;
    }
    Ok(())
}
fn advance(root: &Path, saved: &mut Saved, group: usize, undo: bool) -> Result<(), DeckError> {
    let mut opened = match open_group(&saved.record, group, undo, false) {
        Ok(opened) => opened,
        Err(_) => {
            emit(
                root,
                saved,
                Event::GroupDone {
                    group,
                    undo,
                    status: RenameStatus::Changed,
                },
            )?;
            emit(root, saved, Event::State(RenameHistoryState::Blocked))?;
            return Ok(());
        }
    };
    emit(root, saved, Event::Intent { group, undo })?;
    if let Err(failure) = transfer(root, saved, &mut opened, undo) {
        // A failed durable write must stop all further moves. The persisted intent
        // identifies every possible old/temp/new location on the next validated load.
        if let TransferFailure::Journal(error) = failure {
            return Err(error);
        }
        // Keep exact handles during rollback. A competing destination can block it,
        // in which case the journal and user bytes remain intact at their last names.
        if let Err(failure) = transfer(root, saved, &mut opened, true) {
            if let TransferFailure::Journal(error) = failure {
                return Err(error);
            }
            emit(root, saved, Event::State(RenameHistoryState::Blocked))?;
            return Err(unavailable());
        }
        emit(
            root,
            saved,
            Event::GroupDone {
                group,
                undo,
                status: if undo {
                    RenameStatus::Success
                } else {
                    RenameStatus::Failed
                },
            },
        )?;
    } else {
        emit(
            root,
            saved,
            Event::GroupDone {
                group,
                undo,
                status: RenameStatus::Success,
            },
        )?;
    }
    Ok(())
}
fn recover(root: &Path, saved: &mut Saved, group: usize) -> Result<(), DeckError> {
    let mut opened = match open_group(&saved.record, group, true, true) {
        Ok(opened) => opened,
        Err(_) => {
            emit(root, saved, Event::State(RenameHistoryState::Blocked))?;
            return Err(unavailable());
        }
    };
    transfer(root, saved, &mut opened, true).map_err(|failure| match failure {
        TransferFailure::Native => unavailable(),
        TransferFailure::Journal(error) => error,
    })?;
    let undo = saved.record.intent.is_some_and(|(_, undo)| undo);
    emit(
        root,
        saved,
        Event::GroupDone {
            group,
            undo,
            status: if undo {
                RenameStatus::Success
            } else {
                RenameStatus::Failed
            },
        },
    )?;
    Ok(())
}
