// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Bounded public single-video download contract (ADR-0028).
use super::fs::FileHandleInfo;
use crate::{DeckError, ErrorCode};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Maximum complete MP4 size; the same bound applies to staging and publication.
pub const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
/// Maximum lifetime including first-use engine preparation.
pub const DOWNLOAD_TIMEOUT_SECONDS: u64 = 1800;

/// Start one public YouTube video. Credentials and arbitrary engine arguments are absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaDownloadStartArgs {
    /// HTTPS YouTube watch, short, shorts, embed or live URL for exactly one video.
    pub url: String,
    /// A same-module current-session folder from fs.pickFolder.
    pub folder_handle: String,
}
/// Opaque current-session job identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaDownloadJob {
    /// Poll or cancel only through the issuing module.
    pub job_handle: String,
}
/// Privacy-safe progress with no provider log or document title.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "kebab-case")]
pub enum MediaDownloadStage {
    /// Preparing the pinned local engine; first use may download the fixed runtime.
    PreparingEngine,
    /// Fetching the public video as a combined MP4.
    Downloading,
    /// Checking and publishing the completed file without overwriting.
    Validating,
    /// A new output file is available.
    Complete,
    /// Work stopped before publication.
    Cancelled,
    /// A safe error is available.
    Failed,
}
/// Job snapshot. Failed downloads never masquerade as empty successful results.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct MediaDownloadStatus {
    /// Current-session job handle.
    pub job_handle: String,
    /// Fixed stage.
    pub stage: MediaDownloadStage,
    /// Completed bytes reported by the bounded engine.
    pub downloaded_bytes: u64,
    /// Known total, when the provider supplies a bounded size.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total_bytes: Option<u64>,
    /// Only a successfully published new file is returned.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file: Option<FileHandleInfo>,
    /// Fixed user-facing error; never engine stdout/stderr.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<DeckError>,
}
/// Cancellation cannot delete a file already published successfully.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
pub struct MediaDownloadCancelResult {
    /// An active owned job received the request.
    pub requested: bool,
}

/// Validate and normalize a single video to a fixed YouTube HTTPS URL.
pub fn youtube_video_id(value: &str) -> Result<String, DeckError> {
    let value = value.trim();
    if value.len() > 2048
        || !value.is_ascii()
        || value
            .bytes()
            .any(|c| c.is_ascii_control() || c.is_ascii_whitespace())
    {
        return Err(invalid_url());
    }
    let address = value.strip_prefix("https://").ok_or_else(invalid_url)?;
    let (host, resource) = address.split_once('/').ok_or_else(invalid_url)?;
    let resource = resource.split('#').next().ok_or_else(invalid_url)?;
    let (path, query) = resource.split_once('?').unwrap_or((resource, ""));
    let id = match host.to_ascii_lowercase().as_str() {
        "youtu.be" | "www.youtu.be" => path,
        "youtube.com" | "www.youtube.com" | "m.youtube.com" => {
            if path == "watch" {
                let mut candidates = query.split('&').filter_map(|pair| {
                    let (key, value) = pair.split_once('=')?;
                    (key == "v").then_some(value)
                });
                let id = candidates.next().ok_or_else(invalid_url)?;
                if candidates.next().is_some() {
                    return Err(invalid_url());
                }
                id
            } else {
                let (kind, id) = path.split_once('/').ok_or_else(invalid_url)?;
                if !matches!(kind, "shorts" | "embed" | "live") {
                    return Err(invalid_url());
                }
                id
            }
        }
        _ => return Err(invalid_url()),
    };
    if id.len() != 11
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
    {
        return Err(invalid_url());
    }
    Ok(id.into())
}
fn invalid_url() -> DeckError {
    DeckError::new(
        ErrorCode::InvalidArgs,
        "공개 YouTube 영상 한 개의 https 주소를 넣어 주세요.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_video_normalizes_and_playlist_parameters_cannot_change_selection() {
        for value in [
            "https://www.youtube.com/watch?v=ABCDEFGHI_1&list=synthetic&t=20",
            "https://youtu.be/ABCDEFGHI_1?si=synthetic",
            "https://m.youtube.com/shorts/ABCDEFGHI_1",
            "https://youtube.com/embed/ABCDEFGHI_1",
            "https://youtube.com/live/ABCDEFGHI_1#t=20",
        ] {
            assert_eq!(youtube_video_id(value).unwrap(), "ABCDEFGHI_1");
        }
    }
    #[test]
    fn urls_cannot_select_arbitrary_hosts_credentials_paths_or_multiple_ids() {
        for value in [
            "http://youtube.com/watch?v=ABCDEFGHI_1",
            "https://youtube.com.invalid/watch?v=ABCDEFGHI_1",
            "https://youtube.com@invalid/watch?v=ABCDEFGHI_1",
            "https://youtube.com:443/watch?v=ABCDEFGHI_1",
            "https://youtube.com/watch?v=ABCDEFGHI_1&v=BCDEFGHIJ_2",
            "https://youtube.com/playlist?list=synthetic",
            "https://youtu.be/ABCDEFGHI_1/extra",
            "https://youtube.com/watch?v=ABCDEFGHI%5f1",
            "file:///synthetic",
            "https://youtu.be/ABCDEFGHI_1\n--cookies",
        ] {
            assert!(youtube_video_id(value).is_err(), "{value}");
        }
        assert!(
            youtube_video_id(&format!(
                "https://youtu.be/ABCDEFGHI_1?{}",
                "x".repeat(2048)
            ))
            .is_err()
        );
    }
    #[test]
    fn caller_cannot_supply_cookie_process_or_path_options() {
        assert!(serde_json::from_value::<MediaDownloadStartArgs>(serde_json::json!({"url":"https://youtu.be/ABCDEFGHI_1","folderHandle":"synthetic", "cookies":"synthetic"})).is_err());
    }
}
