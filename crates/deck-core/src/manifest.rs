// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Module manifest (`module.json`, modules.md §1). This struct is the source of truth for
//! `schema/module.schema.json` and the TS types (`pnpm gen`, GEN-006).
//!
//! Validation reports every problem at once with the field and a fix hint, so an agent adding a
//! module can correct all issues in one pass.

use std::collections::BTreeMap;
use std::fmt;

use schemars::JsonSchema;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::util::{is_safe_relative_path, is_valid_cap_name, is_valid_module_id};

/// Current `manifestVersion`.
pub const MANIFEST_VERSION: u32 = 1;
/// Maximum `description` length in characters.
pub const DESCRIPTION_MAX_CHARS: usize = 80;

/// Capability name → semver range, e.g. `{ "storage": "^1.0" }`.
pub type CapRequirements = BTreeMap<String, String>;

/// Tool category shown in the shell navigation. Adding one is a spec change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    /// Classroom tools (timer, seating, groups).
    Classroom,
    /// File tools (rename, organize).
    File,
    /// Image tools.
    Image,
    /// Document tools (PDF, office formats).
    Document,
    /// Everything else.
    Utility,
}

/// A module author (MOD-012).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct Author {
    /// Display name.
    #[schemars(length(min = 1))]
    pub name: String,
    /// GitHub handle without `@`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub github: Option<String>,
}

/// Module UI options.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UiOptions {
    /// Keep the iframe alive (hidden) when switching screens (max 3, LRU).
    #[serde(default)]
    pub keep_alive: bool,
}

/// `module.json`. Unknown fields are rejected (MOD-004).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[schemars(title = "TeacherDeck module manifest")]
pub struct ModuleManifest {
    /// Editor hint only; ignored by the host.
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    #[ts(skip)]
    pub schema: Option<String>,
    /// Manifest format version. Currently 1.
    #[schemars(range(min = 1, max = 1))]
    pub manifest_version: u32,
    /// Module id (MOD-002). Equals the directory name; never changes after release.
    #[schemars(regex(pattern = r"^[a-z][a-z0-9-]{1,30}[a-z0-9]$"))]
    pub id: String,
    /// User-facing name (Korean).
    #[schemars(length(min = 1))]
    pub name: String,
    /// One-line description, at most 80 characters.
    #[schemars(length(min = 1, max = 80))]
    pub description: String,
    /// Module semver (VER-004).
    #[ts(type = "string")]
    pub version: Version,
    /// Navigation category.
    pub category: Category,
    /// Package-relative SVG icon path.
    pub icon: String,
    /// Package-relative HTML entry path.
    pub entry: String,
    /// Authors; at least one (MOD-012).
    #[schemars(length(min = 1))]
    pub authors: Vec<Author>,
    /// Required capabilities and semver ranges.
    pub requires: CapRequirements,
    /// Optional capabilities and semver ranges (MOD-007).
    pub optional: CapRequirements,
    /// UI options.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ui: Option<UiOptions>,
}

/// One validation problem (manifest or index): which field, and what to do about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    /// JSON path of the field, e.g. `requires.storage`.
    pub field: String,
    /// What is wrong and how to fix it.
    pub message: String,
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

/// Why a manifest could not be accepted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ManifestError {
    /// Not valid JSON, wrong types, or unknown fields.
    #[error("module.json을 읽을 수 없어요: {0}")]
    Parse(String),
    /// Parsed, but violates the rules in modules.md.
    #[error("module.json 검증 실패({} 건): {}", .0.len(), join_issues(.0))]
    Invalid(Vec<Issue>),
}

fn join_issues(issues: &[Issue]) -> String {
    issues
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("; ")
}

impl ModuleManifest {
    /// Parses and validates `module.json` text.
    pub fn parse(json: &str) -> Result<Self, ManifestError> {
        let manifest: Self =
            serde_json::from_str(json).map_err(|e| ManifestError::Parse(e.to_string()))?;
        manifest.validate().map_err(ManifestError::Invalid)?;
        Ok(manifest)
    }

    /// Checks every rule that the type system cannot express. Capabilities unknown to this host
    /// are allowed here: a newer app may provide them, and the resolver reports NeedsAppUpdate.
    pub fn validate(&self) -> Result<(), Vec<Issue>> {
        let mut issues = Vec::new();
        let mut push = |field: &str, message: String| {
            issues.push(Issue {
                field: field.to_owned(),
                message,
            });
        };

        if self.manifest_version != MANIFEST_VERSION {
            push(
                "manifestVersion",
                format!(
                    "{MANIFEST_VERSION}이어야 해요(현재 {}).",
                    self.manifest_version
                ),
            );
        }
        if !is_valid_module_id(&self.id) {
            push(
                "id",
                format!(
                    "\"{}\"는 형식 ^[a-z][a-z0-9-]{{1,30}}[a-z0-9]$에 맞지 않아요. 소문자·숫자·하이픈만 쓰세요.",
                    self.id
                ),
            );
        }
        if self.name.trim().is_empty() {
            push("name", "이름을 비워 둘 수 없어요.".to_owned());
        }
        let desc_len = self.description.chars().count();
        if self.description.trim().is_empty() || desc_len > DESCRIPTION_MAX_CHARS {
            push(
                "description",
                format!("1~{DESCRIPTION_MAX_CHARS}자로 쓰세요(현재 {desc_len}자)."),
            );
        }
        for (field, path) in [("icon", &self.icon), ("entry", &self.entry)] {
            if !is_safe_relative_path(path) {
                push(
                    field,
                    format!("\"{path}\"는 패키지 안의 상대 경로여야 해요(예: \"index.html\")."),
                );
            }
        }
        if self.authors.is_empty() {
            push("authors", "저자를 1명 이상 적으세요(MOD-012).".to_owned());
        }
        for (i, author) in self.authors.iter().enumerate() {
            if author.name.trim().is_empty() {
                push(
                    &format!("authors[{i}].name"),
                    "이름을 비워 둘 수 없어요.".to_owned(),
                );
            }
        }
        for (field, reqs) in [("requires", &self.requires), ("optional", &self.optional)] {
            for (cap, range) in reqs {
                let path = format!("{field}.{cap}");
                if !is_valid_cap_name(cap) {
                    push(
                        &path,
                        "캡 이름은 소문자로 시작하는 영문 소문자·숫자여야 해요.".to_owned(),
                    );
                }
                if let Err(e) = VersionReq::parse(range) {
                    push(
                        &path,
                        format!("버전 범위 \"{range}\"를 해석할 수 없어요(예: \"^1.0\"): {e}"),
                    );
                }
            }
        }
        for cap in self
            .requires
            .keys()
            .filter(|c| self.optional.contains_key(*c))
        {
            push(
                &format!("optional.{cap}"),
                "같은 캡을 requires와 optional에 동시에 쓸 수 없어요.".to_owned(),
            );
        }

        if issues.is_empty() {
            Ok(())
        } else {
            Err(issues)
        }
    }

    /// Whether the module asked to stay alive while hidden.
    pub fn keep_alive(&self) -> bool {
        self.ui.is_some_and(|ui| ui.keep_alive)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "$schema": "../../schema/module.schema.json",
            "manifestVersion": 1,
            "id": "timer",
            "name": "타이머",
            "description": "수업용 타이머",
            "version": "0.1.0",
            "category": "classroom",
            "icon": "icon.svg",
            "entry": "index.html",
            "authors": [{ "name": "홍길동", "github": "gildong" }],
            "requires": { "storage": "^1.0", "window": "^1.0" },
            "optional": {},
            "ui": { "keepAlive": true }
        })
    }

    fn parse(v: &serde_json::Value) -> Result<ModuleManifest, ManifestError> {
        ModuleManifest::parse(&v.to_string())
    }

    fn issue_fields(v: &serde_json::Value) -> Vec<String> {
        match parse(v) {
            Err(ManifestError::Invalid(issues)) => issues.into_iter().map(|i| i.field).collect(),
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn accepts_spec_example_and_round_trips() {
        let m = parse(&sample()).unwrap();
        assert_eq!(m.id, "timer");
        assert!(m.keep_alive());
        assert_eq!(serde_json::to_value(&m).unwrap(), sample());
    }

    #[test]
    fn rejects_unknown_fields() {
        let mut v = sample();
        v["homepage"] = "https://example.com".into();
        assert!(matches!(parse(&v), Err(ManifestError::Parse(_))));
        let mut v = sample();
        v["ui"]["theme"] = "dark".into();
        assert!(matches!(parse(&v), Err(ManifestError::Parse(_))));
    }

    #[test]
    fn rejects_bad_semver_version_at_parse_time() {
        let mut v = sample();
        v["version"] = "1.0".into();
        assert!(matches!(parse(&v), Err(ManifestError::Parse(_))));
    }

    #[test]
    fn reports_all_issues_at_once() {
        let mut v = sample();
        v["manifestVersion"] = 2.into();
        v["id"] = "Timer_X".into();
        v["description"] = "가".repeat(81).into();
        v["entry"] = "../index.html".into();
        v["authors"] = serde_json::json!([]);
        v["requires"] = serde_json::json!({ "storage": "not-a-range", "Bad": "^1" });
        v["optional"] = serde_json::json!({ "storage": "^1" });
        let fields = issue_fields(&v);
        for expected in [
            "manifestVersion",
            "id",
            "description",
            "entry",
            "authors",
            "requires.storage",
            "requires.Bad",
            "optional.storage",
        ] {
            assert!(
                fields.iter().any(|f| f == expected),
                "missing {expected} in {fields:?}"
            );
        }
    }

    #[test]
    fn description_limit_counts_characters_not_bytes() {
        let mut v = sample();
        v["description"] = "가".repeat(80).into();
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn unknown_capability_is_not_a_manifest_error() {
        let mut v = sample();
        v["requires"] = serde_json::json!({ "ocr": "^1.0" });
        assert!(parse(&v).is_ok());
    }
}
