// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Structured external-app message scheduling contract (ADR-0023).
use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// The fixed supported external application; executable paths are never accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum MessagingProvider {
    /// The approved Gentoo CoolMessenger adapter.
    Gentoo,
}
/// The four original CoolReserve execution modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum MessagingMode {
    /// Validate locally without inspecting or manipulating the external app.
    Simulate,
    /// Compare one existing composer without typing or clicking.
    Inspect,
    /// Prepare and compare one composer without pressing Send.
    Prepare,
    /// Submit only after an explicit trusted-host confirmation.
    Register,
}
/// Optional provider features discovered from supported application structure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MessagingFeature {
    /// Multiple verified accounts in one composer.
    MultiRecipient,
    /// Verified selected attachments.
    Attachments,
    /// Compare a selected reservation-list item after submission.
    SelectedResultVerification,
}
/// Compatibility evidence for the currently connected application.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum MessagingVersionSupport {
    /// Known control structure has been verified.
    Supported,
    /// The observed structure is unsupported.
    Unsupported,
    /// Compatibility could not be established.
    Unknown,
}
/// Submission-request completion and selected-list comparison remain distinct.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum MessagingResultConfirmation {
    /// Send and composer closure; the user reviews registration separately.
    Manual,
    /// Supported selected reservation-list comparison, never delivery evidence.
    Automatic,
}
/// Privacy-safe progress stages; free-form provider diagnostics are not returned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MessagingStage {
    /// No operation is running.
    Idle,
    /// Revalidating the immutable plan.
    Validating,
    /// Reading an existing composer.
    Reading,
    /// Filling a composer before Send.
    Preparing,
    /// Comparing recipients, content, time and attachments.
    Verifying,
    /// A durable submission attempt has been recorded.
    Submitting,
    /// Comparing a selected reservation entry.
    CheckingResult,
    /// The batch completed its chosen mode.
    Done,
    /// A cancellation interrupted further processing.
    Stopped,
    /// A safe pre-submission failure occurred.
    Failed,
    /// Registration needs manual review and must not be retried automatically.
    NeedsReview,
}
/// Durable per-message state from the original attempt ledger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MessagingItemState {
    /// An unsubmitted draft.
    Draft,
    /// Composer preparation is in progress.
    Preparing,
    /// Composer preparation completed without Send.
    Prepared,
    /// Submission may have started; restart converts it to uncertain.
    Submitting,
    /// Send and composer closure completed; no delivery or server receipt claim.
    RegistrationRequested,
    /// A supported selected reservation-list comparison succeeded.
    Confirmed,
    /// Submission outcome is uncertain and retries are locked.
    Uncertain,
    /// A pre-submission failure occurred.
    Failed,
}
/// Fixed issues that reveal neither application internals nor user content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MessagingIssueCode {
    /// Invalid content or scheduling bounds.
    InvalidMessage,
    /// Recipient account evidence changed or cannot be established.
    RecipientMismatch,
    /// Attachment identity changed or is unavailable.
    AttachmentChanged,
    /// The original durable ledger blocks another submission.
    RetryLocked,
    /// The requested application feature is unavailable.
    UnsupportedFeature,
    /// The connected account or composer changed.
    ConnectionChanged,
    /// An external operation failed without revealing diagnostics.
    ProviderFailed,
}
macro_rules! model {
    ($name:ident {$($field:ident : $ty:ty),* $(,)?}) => {
        #[doc = concat!("Typed ", stringify!($name), " payload; see ADR-0023.")]
        #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name {$(#[doc = concat!("Contract field `", stringify!($field), "`.")] pub $field: $ty),*}
    };
}
model!(MessagingConnectArgs {
    provider: MessagingProvider
});
model!(MessagingConnection {
    connection_handle: String, capabilities: Vec<MessagingFeature>, ready: bool,
    version_support: MessagingVersionSupport
});
model!(MessagingRecipientsArgs {
    connection_handle: String
});
model!(MessagingRecipient {
    recipient_handle: String,
    display_name: String,
    department: String,
    account_label: String
});
model!(ScheduledMessage {
    id: String, recipients: Vec<String>, title: Option<String>, body: String,
    scheduled_at: String, attachment_handles: Vec<String>, content_revision: u32
});
model!(MessagingPlanArgs {
    connection_handle: String, messages: Vec<ScheduledMessage>, mode: MessagingMode,
    result_confirmation: Option<MessagingResultConfirmation>
});
model!(MessagingIssue { message_id: Option<String>, code: MessagingIssueCode });
model!(MessagingPreview {
    message: ScheduledMessage, recipient_labels: Vec<String>, attachment_labels: Vec<String>, retry_locked: bool
});
model!(MessagingPlan {
    plan_handle: String, preview: Vec<MessagingPreview>, expires_at: String, issues: Vec<MessagingIssue>
});
model!(MessagingStartArgs { plan_handle: String, confirmation: Option<String> });
model!(MessagingRun { run_handle: String });
model!(MessagingStatusArgs { run_handle: String });
model!(MessagingItemStatus {
    message_id: String,
    state: MessagingItemState,
    retry_locked: bool
});
model!(MessagingStatus {
    run_handle: String, active: bool, mode: MessagingMode, stage: MessagingStage,
    progress: u32, total: u32, items: Vec<MessagingItemStatus>, issue: Option<MessagingIssueCode>
});
model!(MessagingCancelArgs { run_handle: String });
model!(MessagingCancelResult { requested: bool });
model!(MessagingApprovalRequest {
    confirmation_id: String, module_id: String, module_name: String,
    expires_at: String, preview: Vec<MessagingPreview>
});
model!(MessagingApprovalResolution {
    confirmation_id: String,
    allow: bool
});

impl MessagingPlanArgs {
    /// Validate structural bounds before resolving any private handles.
    /// Scheduling dates and calendar-month bounds are rechecked by the original core.
    pub fn validate(&self) -> Result<(), DeckError> {
        let invalid = || {
            DeckError::new(
                ErrorCode::InvalidArgs,
                "예약 메시지 입력 범위를 확인해 주세요.",
            )
        };
        if self.connection_handle.is_empty()
            || self.connection_handle.len() > 160
            || self.messages.is_empty()
            || self.messages.len() > 500
            || matches!(self.mode, MessagingMode::Inspect | MessagingMode::Prepare)
                && self.messages.len() != 1
            || serde_json::to_vec(self).map_err(|_| invalid())?.len() > 512 * 1024
        {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        let mut text_bytes = 0usize;
        for m in &self.messages {
            let title = m.title.as_deref().unwrap_or("");
            if m.id.is_empty()
                || m.id.len() > 160
                || !ids.insert(&m.id)
                || m.recipients.is_empty()
                || m.recipients.len() > 100
                || m.recipients.iter().any(|h| h.is_empty() || h.len() > 160)
                || m.recipients.iter().collect::<HashSet<_>>().len() != m.recipients.len()
                || m.attachment_handles.len() > 10
                || m.attachment_handles
                    .iter()
                    .any(|h| h.is_empty() || h.len() > 160)
                || m.attachment_handles.iter().collect::<HashSet<_>>().len()
                    != m.attachment_handles.len()
                || title.chars().count() > 200
                || m.body.chars().count() > 30_000
                || m.body.trim().is_empty()
                || [title, &m.body].iter().any(|s| s.contains(['\0', '\t']))
                || m.scheduled_at.len() != 16
                || !m.scheduled_at.bytes().enumerate().all(|(i, b)| match i {
                    4 | 7 => b == b'-',
                    10 => b == b'T',
                    13 => b == b':',
                    _ => b.is_ascii_digit(),
                })
            {
                return Err(invalid());
            }
            text_bytes = text_bytes
                .checked_add(title.len() + m.body.len())
                .ok_or_else(invalid)?;
        }
        if text_bytes > 256 * 1024 {
            return Err(invalid());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args() -> MessagingPlanArgs {
        MessagingPlanArgs {
            connection_handle: "opaque".into(),
            messages: vec![ScheduledMessage {
                id: "synthetic".into(),
                recipients: vec!["recipient".into()],
                title: None,
                body: "합성 본문".into(),
                scheduled_at: "2026-11-01T12:00".into(),
                attachment_handles: vec![],
                content_revision: 1,
            }],
            mode: MessagingMode::Simulate,
            result_confirmation: None,
        }
    }
    #[test]
    fn optional_title_is_preserved_and_unknown_provider_fields_rejected() {
        assert!(args().validate().is_ok());
        assert!(
            serde_json::from_str::<MessagingConnectArgs>(
                r#"{"provider":"gentoo","executable":"forbidden"}"#
            )
            .is_err()
        );
        assert!(
            serde_json::from_str::<MessagingConnectArgs>(r#"{"provider":"arbitrary"}"#).is_err()
        );
    }
    #[test]
    fn limits_are_rejected_without_truncating_messages() {
        let mut a = args();
        a.messages[0].body = "x".repeat(30_001);
        assert!(a.validate().is_err());
        a = args();
        a.messages[0].recipients.push("recipient".into());
        assert!(a.validate().is_err());
        a = args();
        a.messages[0].body = "\t".into();
        assert!(a.validate().is_err());
        a = args();
        a.messages[0].scheduled_at = "2026-11-01T12:00:00Z".into();
        assert!(a.validate().is_err());
        a = args();
        a.mode = MessagingMode::Prepare;
        let mut second = a.messages[0].clone();
        second.id = "other".into();
        a.messages.push(second);
        assert!(a.validate().is_err());
    }
}
