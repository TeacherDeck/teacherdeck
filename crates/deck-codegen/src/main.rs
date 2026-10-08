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

use deck_core::catalog::{CatalogIndex, IndexEntry};
use deck_core::error::{DeckError, ErrorCode};
use deck_core::manifest::{Author, Category, ModuleManifest, UiOptions};
use deck_core::resolver::{Picked, Resolution, ResolveState, Source, UnmetCap};
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

    let sdk = vec![
        ts::<ErrorCode>(SDK_DIR, &cfg)?,
        ts::<DeckError>(SDK_DIR, &cfg)?,
    ];
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
    ];
    check_imports(&sdk)?;
    check_imports(&shell)?;

    let mut files = vec![
        schema::<ModuleManifest>("schema/module.schema.json")?,
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
