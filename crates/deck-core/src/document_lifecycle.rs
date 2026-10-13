// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Content-free owner-scoped document protection (ADR-0030).

use crate::caps::window::*;
use crate::{DeckError, ErrorCode};
use std::collections::HashMap;

/// Maximum lifetime of a shell leave/exit decision.
pub const DECISION_TIMEOUT_MS: u64 = 300_000;
/// A requested save must answer within one minute.
pub const SAVE_TIMEOUT_MS: u64 = 60_000;

struct Pending {
    id: String,
    prepared: u64,
    started: Option<u64>,
    result: Option<bool>,
}
struct Entry {
    state: DocumentState,
    pending: Option<Pending>,
}

/// One document per module; tokens and monotonic time are injected by the host.
#[derive(Default)]
pub struct DocumentRegistry {
    entries: HashMap<String, Entry>,
    exit: Option<(DocumentExitRequest, u64)>,
}

fn invalid() -> DeckError {
    DeckError::new(ErrorCode::NotFound, "문서 보호 요청이 만료됐어요.")
}
fn blocked() -> DeckError {
    DeckError::new(ErrorCode::Cancelled, "미저장 작업을 유지했어요.")
}
fn matches(p: &Pending, id: &str, now: u64) -> bool {
    p.id == id
        && now.saturating_sub(p.prepared) < DECISION_TIMEOUT_MS
        && p.started
            .is_none_or(|at| now.saturating_sub(at) < SAVE_TIMEOUT_MS)
}

impl DocumentRegistry {
    /// Idempotent registration cannot silently reset an already dirty document.
    pub fn register(&mut self, owner: &str, handle: String) -> DocumentRegistration {
        let entry = self
            .entries
            .entry(owner.to_owned())
            .or_insert_with(|| Entry {
                state: DocumentState {
                    document_handle: handle,
                    dirty: false,
                    saving: false,
                },
                pending: None,
            });
        DocumentRegistration {
            document_handle: entry.state.document_handle.clone(),
        }
    }
    /// Updates only the matching live owner reference.
    pub fn update(&mut self, owner: &str, state: DocumentState) -> Result<(), DeckError> {
        let entry = self.entries.get_mut(owner).ok_or_else(invalid)?;
        if entry.state.document_handle != state.document_handle {
            return Err(invalid());
        }
        entry.state = state;
        Ok(())
    }
    /// Current owner state; never contains document content or paths.
    pub fn state(&self, owner: &str) -> Option<DocumentState> {
        self.entries.get(owner).map(|entry| entry.state.clone())
    }
    /// True while any document could be lost by native exit.
    pub fn protected(&self) -> bool {
        self.entries
            .values()
            .any(|entry| entry.state.dirty || entry.state.saving)
    }
    /// Starts a one-use leave decision for a single owner.
    pub fn prepare(&mut self, owner: &str, id: String, now: u64) -> DocumentActionResult {
        let Some(entry) = self.entries.get_mut(owner) else {
            return DocumentActionResult::default();
        };
        entry.pending = Some(Pending {
            id: id.clone(),
            prepared: now,
            started: None,
            result: None,
        });
        DocumentActionResult {
            state: Some(entry.state.clone()),
            request_id: Some(id),
            saved: None,
        }
    }
    /// Changes a prepared decision into an explicit owner-only save request.
    pub fn request_save(
        &mut self,
        owner: &str,
        id: &str,
        now: u64,
    ) -> Result<DocumentSaveRequested, DeckError> {
        let entry = self.entries.get_mut(owner).ok_or_else(invalid)?;
        let pending = entry.pending.as_mut().ok_or_else(invalid)?;
        if !matches(pending, id, now) || pending.started.is_some() || entry.state.saving {
            return Err(blocked());
        }
        pending.started = Some(now);
        Ok(DocumentSaveRequested {
            document_handle: entry.state.document_handle.clone(),
            request_id: id.to_owned(),
        })
    }
    /// Accepts a module response only for its own requested save; does not clear dirty.
    pub fn complete(
        &mut self,
        owner: &str,
        args: CompleteDocumentSaveArgs,
        now: u64,
    ) -> Result<(), DeckError> {
        let entry = self.entries.get_mut(owner).ok_or_else(invalid)?;
        let pending = entry.pending.as_mut().ok_or_else(invalid)?;
        if entry.state.document_handle != args.document_handle
            || !matches(pending, &args.request_id, now)
            || pending.started.is_none()
            || pending.result.is_some()
        {
            return Err(invalid());
        }
        pending.result = Some(args.saved && !entry.state.dirty && !entry.state.saving);
        Ok(())
    }
    /// Reads a response and checks whether a subsequent edit made it obsolete.
    pub fn save_result(
        &mut self,
        owner: &str,
        id: &str,
        now: u64,
    ) -> Result<DocumentActionResult, DeckError> {
        let entry = self.entries.get_mut(owner).ok_or_else(invalid)?;
        let pending = entry.pending.as_ref().ok_or_else(invalid)?;
        if !matches(pending, id, now) {
            return Err(invalid());
        }
        let saved = pending
            .result
            .map(|saved| saved && !entry.state.dirty && !entry.state.saving);
        if saved.is_some() {
            entry.pending = None;
        }
        Ok(DocumentActionResult {
            state: Some(entry.state.clone()),
            request_id: None,
            saved,
        })
    }
    /// Cancelling preserves the owner document and all its dirty state.
    pub fn cancel(&mut self, owner: &str, id: &str) {
        if let Some(entry) = self.entries.get_mut(owner)
            && entry
                .pending
                .as_ref()
                .is_some_and(|pending| pending.id == id)
        {
            entry.pending = None;
        }
    }
    /// Only the exact prepared document may be discarded; its reference is revoked.
    pub fn discard(
        &mut self,
        owner: &str,
        handle: &str,
        id: &str,
        now: u64,
    ) -> Result<(), DeckError> {
        let entry = self.entries.get(owner).ok_or_else(invalid)?;
        if entry.state.document_handle != handle
            || !entry.pending.as_ref().is_some_and(|p| matches(p, id, now))
        {
            return Err(invalid());
        }
        if entry.state.saving {
            return Err(blocked());
        }
        self.entries.remove(owner);
        Ok(())
    }
    /// Host unload refuses a protected document even if a shell navigation races a new edit.
    pub fn unload(&mut self, owner: &str) -> Result<(), DeckError> {
        self.unload_many(&[owner])
    }

    /// Atomically checks every eviction target before revoking any protection reference.
    pub fn unload_many(&mut self, owners: &[&str]) -> Result<(), DeckError> {
        if owners.iter().any(|owner| {
            self.entries
                .get(*owner)
                .is_some_and(|e| e.state.dirty || e.state.saving)
        }) {
            return Err(blocked());
        }
        for owner in owners {
            self.entries.remove(*owner);
        }
        Ok(())
    }
    /// True while an existing native confirmation should be allowed to finish.
    pub fn exit_pending(&self, now: u64) -> bool {
        self.exit
            .as_ref()
            .is_some_and(|(_, at)| now.saturating_sub(*at) < DECISION_TIMEOUT_MS)
    }

    /// Creates a native action token only while protection is necessary.
    pub fn request_exit(
        &mut self,
        action: DocumentExitAction,
        id: String,
        now: u64,
    ) -> Option<DocumentExitRequest> {
        if !self.protected() {
            return None;
        }
        if let Some((request, at)) = &self.exit
            && now.saturating_sub(*at) < DECISION_TIMEOUT_MS
        {
            return Some(request.clone());
        }
        let request = DocumentExitRequest {
            request_id: id,
            action,
        };
        self.exit = Some((request.clone(), now));
        Some(request)
    }
    /// A one-use native action must still be safe at the actual exit boundary.
    pub fn resolve_exit(
        &mut self,
        id: &str,
        proceed: bool,
        now: u64,
    ) -> Result<Option<DocumentExitAction>, DeckError> {
        let (request, at) = self.exit.as_ref().ok_or_else(invalid)?;
        if request.request_id != id || now.saturating_sub(*at) >= DECISION_TIMEOUT_MS {
            return Err(invalid());
        }
        let action = request.action;
        self.exit = None;
        if !proceed {
            return Ok(None);
        }
        if self.protected() {
            return Err(blocked());
        }
        Ok(Some(action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dirty(registry: &mut DocumentRegistry, owner: &str) -> String {
        let handle = registry
            .register(owner, format!("synthetic-{owner}"))
            .document_handle;
        registry
            .update(
                owner,
                DocumentState {
                    document_handle: handle.clone(),
                    dirty: true,
                    saving: false,
                },
            )
            .unwrap();
        handle
    }
    #[test]
    fn registration_and_foreign_or_old_references_never_reset_dirty() {
        let mut registry = DocumentRegistry::default();
        let handle = dirty(&mut registry, "one");
        assert_eq!(
            registry.register("one", "new".into()).document_handle,
            handle
        );
        assert!(registry.protected());
        assert!(
            registry
                .update(
                    "two",
                    DocumentState {
                        document_handle: handle,
                        dirty: false,
                        saving: false
                    }
                )
                .is_err()
        );
        assert!(registry.unload("one").is_err());
    }
    #[test]
    fn saving_clean_document_and_expired_discard_also_block_destruction() {
        let mut registry = DocumentRegistry::default();
        let handle = registry
            .register("one", "synthetic-document".into())
            .document_handle;
        registry
            .update(
                "one",
                DocumentState {
                    document_handle: handle.clone(),
                    dirty: false,
                    saving: true,
                },
            )
            .unwrap();
        assert!(registry.protected());
        assert!(registry.unload("one").is_err());
        registry.prepare("one", "leave".into(), 0);
        assert!(registry.discard("one", &handle, "leave", 1).is_err());
        registry
            .update(
                "one",
                DocumentState {
                    document_handle: handle.clone(),
                    dirty: true,
                    saving: false,
                },
            )
            .unwrap();
        assert!(
            registry
                .discard("one", &handle, "leave", DECISION_TIMEOUT_MS)
                .is_err()
        );
        let request = registry
            .request_exit(DocumentExitAction::Close, "exit".into(), 1)
            .unwrap();
        assert!(
            registry
                .resolve_exit(&request.request_id, true, DECISION_TIMEOUT_MS + 1)
                .is_err()
        );
        assert!(registry.protected());
    }
    #[test]
    fn batch_unload_keeps_every_reference_when_one_late_edit_blocks_transition() {
        let mut registry = DocumentRegistry::default();
        let first = registry
            .register("one", "synthetic-first".into())
            .document_handle;
        dirty(&mut registry, "two");
        assert!(registry.unload_many(&["one", "two"]).is_err());
        assert_eq!(registry.state("one").unwrap().document_handle, first);
        let second = registry.state("two").unwrap().document_handle;
        registry
            .update(
                "two",
                DocumentState {
                    document_handle: second,
                    dirty: false,
                    saving: false,
                },
            )
            .unwrap();
        registry.unload_many(&["one", "two"]).unwrap();
        assert!(registry.state("one").is_none());
        assert!(registry.state("two").is_none());
    }
    #[test]
    fn successful_save_requires_clean_current_state_and_consumes_once() {
        let mut registry = DocumentRegistry::default();
        let handle = dirty(&mut registry, "one");
        registry.prepare("one", "leave".into(), 0);
        registry.request_save("one", "leave", 1).unwrap();
        registry
            .update(
                "one",
                DocumentState {
                    document_handle: handle.clone(),
                    dirty: false,
                    saving: false,
                },
            )
            .unwrap();
        registry
            .complete(
                "one",
                CompleteDocumentSaveArgs {
                    document_handle: handle.clone(),
                    request_id: "leave".into(),
                    saved: true,
                },
                2,
            )
            .unwrap();
        registry
            .update(
                "one",
                DocumentState {
                    document_handle: handle,
                    dirty: true,
                    saving: false,
                },
            )
            .unwrap();
        assert_eq!(
            registry.save_result("one", "leave", 3).unwrap().saved,
            Some(false)
        );
        assert!(registry.save_result("one", "leave", 4).is_err());
    }
    #[test]
    fn clean_save_response_unlocks_unload_but_never_clears_dirty_itself() {
        let mut registry = DocumentRegistry::default();
        let handle = dirty(&mut registry, "one");
        registry.prepare("one", "first".into(), 0);
        registry.request_save("one", "first", 1).unwrap();
        registry
            .complete(
                "one",
                CompleteDocumentSaveArgs {
                    document_handle: handle.clone(),
                    request_id: "first".into(),
                    saved: true,
                },
                2,
            )
            .unwrap();
        assert_eq!(
            registry.save_result("one", "first", 3).unwrap().saved,
            Some(false)
        );
        assert!(registry.protected());

        registry.prepare("one", "second".into(), 4);
        registry.request_save("one", "second", 5).unwrap();
        registry
            .update(
                "one",
                DocumentState {
                    document_handle: handle.clone(),
                    dirty: false,
                    saving: false,
                },
            )
            .unwrap();
        registry
            .complete(
                "one",
                CompleteDocumentSaveArgs {
                    document_handle: handle,
                    request_id: "second".into(),
                    saved: true,
                },
                6,
            )
            .unwrap();
        assert_eq!(
            registry.save_result("one", "second", 7).unwrap().saved,
            Some(true)
        );
        assert!(registry.save_result("one", "second", 8).is_err());
        registry.unload("one").unwrap();
        assert!(!registry.protected());
    }
    #[test]
    fn failure_timeout_cancel_and_wrong_discard_preserve_document() {
        let mut registry = DocumentRegistry::default();
        let handle = dirty(&mut registry, "one");
        registry.prepare("one", "leave".into(), 0);
        assert!(registry.discard("one", &handle, "wrong", 1).is_err());
        registry.request_save("one", "leave", 1).unwrap();
        assert!(
            registry
                .complete(
                    "one",
                    CompleteDocumentSaveArgs {
                        document_handle: handle.clone(),
                        request_id: "leave".into(),
                        saved: true
                    },
                    SAVE_TIMEOUT_MS + 1
                )
                .is_err()
        );
        registry.cancel("one", "leave");
        assert!(registry.protected());
        registry.prepare("one", "discard".into(), 2);
        registry.discard("one", &handle, "discard", 3).unwrap();
        assert!(registry.state("one").is_none());
        assert!(registry.discard("one", &handle, "discard", 4).is_err());
    }
    #[test]
    fn native_exit_rechecks_all_documents_and_requires_current_one_use_token() {
        let mut registry = DocumentRegistry::default();
        let handle = dirty(&mut registry, "one");
        let exit = registry
            .request_exit(DocumentExitAction::Restart, "exit".into(), 0)
            .unwrap();
        assert!(registry.exit_pending(1));
        assert!(!registry.exit_pending(DECISION_TIMEOUT_MS));
        assert!(registry.resolve_exit("wrong", true, 1).is_err());
        assert!(registry.resolve_exit(&exit.request_id, true, 2).is_err());
        let exit = registry
            .request_exit(DocumentExitAction::Exit, "exit2".into(), 3)
            .unwrap();
        registry.prepare("one", "discard".into(), 4);
        registry.discard("one", &handle, "discard", 5).unwrap();
        assert_eq!(
            registry.resolve_exit(&exit.request_id, true, 6).unwrap(),
            Some(DocumentExitAction::Exit)
        );
        assert!(registry.resolve_exit(&exit.request_id, true, 7).is_err());
    }
    #[test]
    fn disconnected_expired_and_cancelled_native_confirmation_preserve_every_exit_kind() {
        for action in [
            DocumentExitAction::Close,
            DocumentExitAction::Exit,
            DocumentExitAction::Restart,
        ] {
            let mut registry = DocumentRegistry::default();
            let handle = dirty(&mut registry, "synthetic-editor");
            let abandoned = registry
                .request_exit(action, "synthetic-abandoned".into(), 0)
                .unwrap();
            // No response (including a disconnected shell) never becomes consent at expiry.
            assert!(!registry.exit_pending(DECISION_TIMEOUT_MS));
            assert!(registry.protected());
            assert!(
                registry
                    .resolve_exit(&abandoned.request_id, true, DECISION_TIMEOUT_MS)
                    .is_err()
            );
            let current = registry
                .request_exit(action, "synthetic-current".into(), DECISION_TIMEOUT_MS + 1)
                .unwrap();
            assert_eq!(
                registry
                    .resolve_exit(&current.request_id, false, DECISION_TIMEOUT_MS + 2)
                    .unwrap(),
                None
            );
            assert!(registry.protected());
            assert_eq!(
                registry.state("synthetic-editor").unwrap().document_handle,
                handle
            );
            // A late positive completion cannot reuse either abandoned or cancelled consent.
            for id in [&abandoned.request_id, &current.request_id] {
                assert!(
                    registry
                        .resolve_exit(id, true, DECISION_TIMEOUT_MS + 3)
                        .is_err()
                );
            }
        }
    }
}
