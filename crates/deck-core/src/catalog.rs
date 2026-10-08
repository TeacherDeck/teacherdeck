// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Catalog / bundled-module index (`index.json`, catalog.md §1). Source of truth for
//! `schema/catalog.schema.json`.

use std::collections::{BTreeMap, BTreeSet};

use schemars::JsonSchema;
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::manifest::{CapRequirements, Issue};
use crate::package::MAX_PACKAGE_BYTES;
use crate::resolver::{Candidate, Source};
use crate::util::{is_safe_relative_path, is_sha256_hex, is_valid_module_id};

/// Current index `format`.
pub const INDEX_FORMAT: u32 = 1;

/// One published version of a module.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct IndexEntry {
    /// Module version.
    #[ts(type = "string")]
    pub version: Version,
    /// Same as the manifest `requires` of this version.
    pub requires: CapRequirements,
    /// Same as the manifest `optional` of this version.
    pub optional: CapRequirements,
    /// SHA-256 of the `.deckmod` package (lowercase hex).
    #[schemars(regex(pattern = r"^[0-9a-f]{64}$"))]
    pub sha256: String,
    /// Package size in bytes.
    pub size: u64,
    /// Package location relative to the index, e.g. `timer/0.1.0/`.
    pub url: String,
    /// Revoked versions are never resolved.
    pub revoked: bool,
}

/// `index.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[schemars(title = "TeacherDeck module index")]
pub struct CatalogIndex {
    /// Index format version. Currently 1.
    #[schemars(range(min = 1, max = 1))]
    pub format: u32,
    /// Monotonically increasing sequence number (rollback protection).
    pub seq: u64,
    /// RFC 3339 timestamp of generation.
    pub generated_at: String,
    /// Module id → published versions.
    pub modules: BTreeMap<String, Vec<IndexEntry>>,
}

/// Why an index was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CatalogError {
    /// Not valid JSON, wrong types, or unknown fields.
    #[error("index.json을 읽을 수 없어요: {0}")]
    Parse(String),
    /// Parsed, but violates catalog.md.
    #[error("index.json 검증 실패({} 건)", .0.len())]
    Invalid(Vec<Issue>),
    /// `seq` went backwards (catalog.md §1).
    #[error("seq {got}는 이미 받은 {last}보다 작아 거부했어요.")]
    SeqRollback {
        /// Last accepted seq.
        last: u64,
        /// Seq of the rejected index.
        got: u64,
    },
}

impl CatalogIndex {
    /// Parses and validates `index.json` text.
    pub fn parse(json: &str) -> Result<Self, CatalogError> {
        let index: Self =
            serde_json::from_str(json).map_err(|e| CatalogError::Parse(e.to_string()))?;
        index.validate().map_err(CatalogError::Invalid)?;
        Ok(index)
    }

    /// Checks rules the type system cannot express.
    pub fn validate(&self) -> Result<(), Vec<Issue>> {
        let mut issues = Vec::new();
        let mut push = |field: String, message: String| issues.push(Issue { field, message });
        if self.format != INDEX_FORMAT {
            push("format".into(), format!("{INDEX_FORMAT}이어야 해요."));
        }
        for (id, entries) in &self.modules {
            if !is_valid_module_id(id) {
                push(
                    format!("modules.{id}"),
                    "모듈 id 형식이 아니에요(MOD-002).".into(),
                );
            }
            let mut seen = BTreeSet::new();
            for (i, e) in entries.iter().enumerate() {
                let f = |name: &str| format!("modules.{id}[{i}].{name}");
                if !seen.insert(&e.version) {
                    push(f("version"), format!("버전 {}이 중복돼요.", e.version));
                }
                if !is_sha256_hex(&e.sha256) {
                    push(f("sha256"), "소문자 16진수 64자여야 해요.".into());
                }
                if e.size == 0 || e.size > MAX_PACKAGE_BYTES {
                    push(f("size"), format!("1~{MAX_PACKAGE_BYTES} 바이트여야 해요."));
                }
                if !is_safe_relative_path(e.url.trim_end_matches('/')) {
                    push(
                        f("url"),
                        "인덱스 기준 상대 경로여야 해요(예: \"timer/0.1.0/\").".into(),
                    );
                }
                for (cap, range) in e.requires.iter().chain(&e.optional) {
                    if VersionReq::parse(range).is_err() {
                        push(
                            f(&format!("requires.{cap}")),
                            format!("버전 범위 \"{range}\"를 해석할 수 없어요."),
                        );
                    }
                }
            }
        }
        if issues.is_empty() {
            Ok(())
        } else {
            Err(issues)
        }
    }

    /// Rejects an index whose `seq` is lower than the last accepted one.
    pub fn check_seq(&self, last_accepted: Option<u64>) -> Result<(), CatalogError> {
        match last_accepted {
            Some(last) if self.seq < last => Err(CatalogError::SeqRollback {
                last,
                got: self.seq,
            }),
            _ => Ok(()),
        }
    }

    /// Resolver candidates for every module in this index.
    pub fn candidates(&self, source: Source) -> BTreeMap<String, Vec<Candidate>> {
        self.modules
            .iter()
            .map(|(id, entries)| {
                let cands = entries
                    .iter()
                    .map(|e| Candidate {
                        source,
                        version: e.version.clone(),
                        requires: e.requires.clone(),
                        optional: e.optional.clone(),
                        sha256: Some(e.sha256.clone()),
                        revoked: e.revoked,
                        manifest_valid: true,
                    })
                    .collect();
                (id.clone(), cands)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "format": 1,
            "seq": 7,
            "generatedAt": "2026-01-01T00:00:00Z",
            "modules": {
                "timer": [{
                    "version": "0.1.0",
                    "requires": { "storage": "^1.0", "window": "^1.0" },
                    "optional": {},
                    "sha256": "a".repeat(64),
                    "size": 1024,
                    "url": "timer/0.1.0/",
                    "revoked": false
                }]
            }
        })
    }

    #[test]
    fn parses_spec_example() {
        let idx = CatalogIndex::parse(&sample().to_string()).unwrap();
        let cands = idx.candidates(Source::Bundled);
        assert_eq!(cands.get("timer").map(Vec::len), Some(1));
    }

    #[test]
    fn rejects_unknown_fields_and_bad_entries() {
        let mut v = sample();
        v["signature"] = "x".into();
        assert!(matches!(
            CatalogIndex::parse(&v.to_string()),
            Err(CatalogError::Parse(_))
        ));

        let mut v = sample();
        v["modules"]["timer"][0]["sha256"] = "XYZ".into();
        v["modules"]["timer"][0]["url"] = "../../etc/".into();
        v["modules"]["timer"][0]["size"] = 0.into();
        let dup = v["modules"]["timer"][0].clone();
        if let Some(list) = v["modules"]["timer"].as_array_mut() {
            list.push(dup);
        }
        match CatalogIndex::parse(&v.to_string()) {
            Err(CatalogError::Invalid(issues)) => {
                let fields: Vec<_> = issues.iter().map(|i| i.field.as_str()).collect();
                for f in ["sha256", "url", "size", "version"] {
                    assert!(
                        fields.iter().any(|x| x.ends_with(f)),
                        "missing {f}: {fields:?}"
                    );
                }
            }
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[test]
    fn seq_must_not_go_backwards() {
        let idx = CatalogIndex::parse(&sample().to_string()).unwrap();
        assert!(idx.check_seq(None).is_ok());
        assert!(idx.check_seq(Some(7)).is_ok());
        assert_eq!(
            idx.check_seq(Some(8)),
            Err(CatalogError::SeqRollback { last: 8, got: 7 })
        );
    }
}
