// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `deck-pack <staging-dir> <out.deckmod>`: packs a module's build output into a `.deckmod` with
//! deck-core's `build_package`, the same code the host validates with (catalog.md §2), and prints
//! the index entry fields as JSON.

use std::error::Error;
use std::io::Write as _;
use std::path::{Path, PathBuf};

use deck_core::package::build_package;

fn collect(
    root: &Path,
    dir: &Path,
    out: &mut Vec<(String, Vec<u8>)>,
) -> Result<(), Box<dyn Error>> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(format!("symlinks are not allowed: {}", path.display()).into());
        }
        if kind.is_dir() {
            collect(root, &path, out)?;
        } else {
            let rel = path
                .strip_prefix(root)?
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            out.push((rel, std::fs::read(&path)?));
        }
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [staging, out] = args.as_slice() else {
        return Err("usage: deck-pack <staging-dir> <out.deckmod>".into());
    };
    let staging = PathBuf::from(staging);
    let mut files = Vec::new();
    collect(&staging, &staging, &mut files)?;
    let (bytes, pkg) = build_package(&files)?;
    if let Some(parent) = Path::new(out).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(out, &bytes)?;

    let summary = serde_json::json!({
        "id": pkg.manifest.id,
        "version": pkg.manifest.version.to_string(),
        "requires": pkg.manifest.requires,
        "optional": pkg.manifest.optional,
        "sha256": pkg.sha256,
        "size": bytes.len(),
        "files": pkg.files.len(),
    });
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &summary)?;
    writeln!(stdout)?;
    Ok(())
}
