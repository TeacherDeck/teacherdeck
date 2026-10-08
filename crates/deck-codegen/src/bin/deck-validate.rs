// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `deck-validate <module.json>...`: validates manifests with the same deck-core code the host
//! runs, so `check-modules` and the app never disagree (MOD-004).
//!
//! Prints `{ "results": [{ "file", "issues": [{ "field", "message" }] }] }` and exits 0;
//! problems are data, not process failures.

use std::error::Error;
use std::io::Write as _;

use deck_core::manifest::{ManifestError, ModuleManifest};
use serde::Serialize;

#[derive(Serialize)]
struct IssueOut {
    field: String,
    message: String,
}

#[derive(Serialize)]
struct FileResult {
    file: String,
    issues: Vec<IssueOut>,
}

fn check(file: &str) -> Vec<IssueOut> {
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) => {
            return vec![IssueOut {
                field: String::new(),
                message: format!("파일을 읽을 수 없어요: {e}"),
            }];
        }
    };
    match ModuleManifest::parse(&text) {
        Ok(_) => Vec::new(),
        Err(ManifestError::Parse(message)) => vec![IssueOut {
            field: String::new(),
            message,
        }],
        Err(ManifestError::Invalid(issues)) => issues
            .into_iter()
            .map(|i| IssueOut {
                field: i.field,
                message: i.message,
            })
            .collect(),
    }
}

fn main() -> Result<(), Box<dyn Error>> {
    let results: Vec<FileResult> = std::env::args()
        .skip(1)
        .map(|file| FileResult {
            issues: check(&file),
            file,
        })
        .collect();
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &serde_json::json!({ "results": results }))?;
    writeln!(stdout)?;
    Ok(())
}
