// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! `.deckmod` package validation (catalog.md §2, SEC-006). Works on bytes in memory and returns
//! the verified files; writing them to disk is the host's job.
//!
//! Checks, in order: package size → each entry (path safety, symlink, encryption, duplicates,
//! compression ratio, unpacked budget) → `SHA256SUMS` (complete, exact, matching) → manifest
//! (valid, entry and icon present).

use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};

use crate::manifest::{ManifestError, ModuleManifest};
use crate::util::{is_safe_relative_path, is_sha256_hex, sha256_hex};

/// Maximum `.deckmod` size (catalog.md §2).
pub const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024;
/// Maximum total unpacked size (ADR-0009).
pub const MAX_UNPACKED_BYTES: u64 = 50 * 1024 * 1024;
/// Maximum per-file compression ratio for files above [`RATIO_MIN_BYTES`] (zip bomb guard).
pub const MAX_COMPRESSION_RATIO: u64 = 100;
/// Files smaller than this are exempt from the ratio check.
pub const RATIO_MIN_BYTES: u64 = 1024 * 1024;
/// Checksum file at the package root.
pub const SUMS_FILE: &str = "SHA256SUMS";
/// Manifest file at the package root.
pub const MANIFEST_FILE: &str = "module.json";

/// Size limits applied during validation. [`Limits::default`] is the policy in ADR-0009;
/// other values exist for tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Maximum package size.
    pub max_package: u64,
    /// Maximum total unpacked size.
    pub max_unpacked: u64,
    /// Maximum compression ratio for files above `ratio_min_bytes`.
    pub max_ratio: u64,
    /// Files smaller than this skip the ratio check.
    pub ratio_min_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_package: MAX_PACKAGE_BYTES,
            max_unpacked: MAX_UNPACKED_BYTES,
            max_ratio: MAX_COMPRESSION_RATIO,
            ratio_min_bytes: RATIO_MIN_BYTES,
        }
    }
}

/// A verified file from the package.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageFile {
    /// Package-relative path.
    pub path: String,
    /// File contents.
    pub data: Vec<u8>,
}

/// A package that passed every check.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidatedPackage {
    /// Parsed and validated manifest.
    pub manifest: ModuleManifest,
    /// Every file except `SHA256SUMS`, sorted by path.
    pub files: Vec<PackageFile>,
    /// SHA-256 of the whole package (matches the index `sha256`).
    pub sha256: String,
}

/// Why a package was rejected. Paths are package-internal, never user paths (PRV-003).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PackageError {
    /// Package exceeds the size limit.
    #[error("패키지가 {size} 바이트로 최대 크기를 넘어요.")]
    TooLarge {
        /// Actual size.
        size: u64,
    },
    /// Unpacked contents exceed the limit.
    #[error("압축을 푼 크기가 최대 크기를 넘어요.")]
    UnpackedTooLarge,
    /// A file compresses suspiciously well.
    #[error("{path}의 압축률이 너무 높아요(압축 폭탄 의심).")]
    CompressionRatio {
        /// Entry path.
        path: String,
    },
    /// Not a readable zip archive.
    #[error("zip을 읽을 수 없어요: {0}")]
    Zip(String),
    /// Absolute path, `..`, drive letter, backslash or similar (zip-slip).
    #[error("허용되지 않는 경로예요: {path:?}")]
    UnsafePath {
        /// Entry path as stored.
        path: String,
    },
    /// Symbolic links are not allowed.
    #[error("심볼릭 링크는 허용하지 않아요: {path}")]
    Symlink {
        /// Entry path.
        path: String,
    },
    /// Encrypted entries are not allowed.
    #[error("암호화된 항목은 허용하지 않아요: {path}")]
    Encrypted {
        /// Entry path.
        path: String,
    },
    /// Two entries map to the same path (case-insensitive, as on Windows).
    #[error("같은 경로가 두 번 있어요(대소문자 무시): {path}")]
    DuplicatePath {
        /// Entry path.
        path: String,
    },
    /// A required file is missing.
    #[error("필수 파일이 없어요: {path}")]
    MissingFile {
        /// Expected path.
        path: String,
    },
    /// `SHA256SUMS` line is malformed.
    #[error("SHA256SUMS {line}번째 줄 형식이 잘못됐어요.")]
    MalformedSums {
        /// 1-based line number.
        line: usize,
    },
    /// A file's digest differs from `SHA256SUMS`.
    #[error("{path}의 SHA-256이 SHA256SUMS와 달라요.")]
    HashMismatch {
        /// Entry path.
        path: String,
    },
    /// A file is not listed in `SHA256SUMS`.
    #[error("{path}가 SHA256SUMS에 없어요.")]
    UnlistedFile {
        /// Entry path.
        path: String,
    },
    /// `SHA256SUMS` lists a file that is not in the package.
    #[error("SHA256SUMS에 있는 {path}가 패키지에 없어요.")]
    ListedButMissing {
        /// Listed path.
        path: String,
    },
    /// `module.json` is unreadable or invalid.
    #[error(transparent)]
    Manifest(#[from] ManifestError),
}

/// Validates a `.deckmod` package held in memory with the default [`Limits`].
pub fn validate_package(bytes: &[u8]) -> Result<ValidatedPackage, PackageError> {
    validate_package_with(bytes, &Limits::default())
}

/// Validates a `.deckmod` package held in memory.
pub fn validate_package_with(
    bytes: &[u8],
    limits: &Limits,
) -> Result<ValidatedPackage, PackageError> {
    let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    if size > limits.max_package {
        return Err(PackageError::TooLarge { size });
    }
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| PackageError::Zip(e.to_string()))?;

    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut seen_lower = BTreeSet::new();
    let mut budget = limits.max_unpacked;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| PackageError::Zip(e.to_string()))?;
        let raw = entry.name().to_owned();
        let is_dir = entry.is_dir();
        let path = if is_dir {
            raw.trim_end_matches('/')
        } else {
            raw.as_str()
        }
        .to_owned();

        if !is_safe_relative_path(&path) {
            return Err(PackageError::UnsafePath { path: raw });
        }
        if entry.is_symlink() {
            return Err(PackageError::Symlink { path });
        }
        if entry.encrypted() {
            return Err(PackageError::Encrypted { path });
        }
        if !seen_lower.insert(path.to_lowercase()) {
            return Err(PackageError::DuplicatePath { path });
        }
        if is_dir {
            continue;
        }
        let declared = entry.size();
        if declared > limits.ratio_min_bytes
            && declared / entry.compressed_size().max(1) > limits.max_ratio
        {
            return Err(PackageError::CompressionRatio { path });
        }
        // Never trust the declared size: read at most the remaining budget + 1 byte.
        let mut data = Vec::new();
        (&mut entry)
            .take(budget.saturating_add(1))
            .read_to_end(&mut data)
            .map_err(|e| PackageError::Zip(e.to_string()))?;
        let read = u64::try_from(data.len()).unwrap_or(u64::MAX);
        if read > budget {
            return Err(PackageError::UnpackedTooLarge);
        }
        budget -= read;
        files.insert(path, data);
    }

    let sums_bytes = files
        .remove(SUMS_FILE)
        .ok_or_else(|| PackageError::MissingFile {
            path: SUMS_FILE.to_owned(),
        })?;
    verify_sums(&sums_bytes, &files)?;

    let manifest_bytes = files
        .get(MANIFEST_FILE)
        .ok_or_else(|| PackageError::MissingFile {
            path: MANIFEST_FILE.to_owned(),
        })?;
    let manifest_text = std::str::from_utf8(manifest_bytes)
        .map_err(|e| ManifestError::Parse(format!("UTF-8이 아니에요: {e}")))?;
    let manifest = ModuleManifest::parse(manifest_text)?;
    for required in [&manifest.entry, &manifest.icon] {
        if !files.contains_key(required.as_str()) {
            return Err(PackageError::MissingFile {
                path: required.clone(),
            });
        }
    }

    Ok(ValidatedPackage {
        manifest,
        files: files
            .into_iter()
            .map(|(path, data)| PackageFile { path, data })
            .collect(),
        sha256: sha256_hex(bytes),
    })
}

/// Builds a `.deckmod` from package-relative files: adds `SHA256SUMS`, sorts entries and fixes
/// timestamps so the same input always yields the same bytes. The bytes are re-validated before
/// returning, so whatever this produces is guaranteed to pass [`validate_package`].
pub fn build_package(
    files: &[(String, Vec<u8>)],
) -> Result<(Vec<u8>, ValidatedPackage), PackageError> {
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    let mut sorted: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(p, d)| (p.as_str(), d.as_slice()))
        .collect();
    sorted.sort_by(|a, b| a.0.cmp(b.0));
    let sums: String = sorted
        .iter()
        .map(|(path, data)| {
            format!(
                "{}  {path}
",
                sha256_hex(data)
            )
        })
        .collect();
    sorted.push((SUMS_FILE, sums.as_bytes()));

    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (path, data) in sorted {
        zip.start_file(path, opts)
            .map_err(|e| PackageError::Zip(e.to_string()))?;
        zip.write_all(data)
            .map_err(|e| PackageError::Zip(e.to_string()))?;
    }
    let bytes = zip
        .finish()
        .map_err(|e| PackageError::Zip(e.to_string()))?
        .into_inner();
    let validated = validate_package(&bytes)?;
    Ok((bytes, validated))
}

/// `SHA256SUMS` must list every other file exactly once with a matching digest
/// (`sha256sum` format: `<hex>  <path>`, optional `*` binary marker).
fn verify_sums(sums: &[u8], files: &BTreeMap<String, Vec<u8>>) -> Result<(), PackageError> {
    let text = std::str::from_utf8(sums).map_err(|_| PackageError::MalformedSums { line: 1 })?;
    let mut listed: BTreeMap<&str, &str> = BTreeMap::new();
    for (n, line) in text
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
    {
        let malformed = PackageError::MalformedSums { line: n + 1 };
        let (hash, rest) = line.split_once(' ').ok_or_else(|| malformed.clone())?;
        let path = rest
            .strip_prefix(' ')
            .or_else(|| rest.strip_prefix('*'))
            .unwrap_or(rest);
        let path = path.strip_prefix('*').unwrap_or(path);
        if !is_sha256_hex(hash)
            || !is_safe_relative_path(path)
            || listed.insert(path, hash).is_some()
        {
            return Err(malformed);
        }
    }
    for (path, data) in files {
        match listed.remove(path.as_str()) {
            None => return Err(PackageError::UnlistedFile { path: path.clone() }),
            Some(hash) if hash != sha256_hex(data) => {
                return Err(PackageError::HashMismatch { path: path.clone() });
            }
            Some(_) => {}
        }
    }
    if let Some(path) = listed.keys().next() {
        return Err(PackageError::ListedButMissing {
            path: (*path).to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    use super::*;

    const MANIFEST: &str = r#"{
        "manifestVersion": 1, "id": "sample-tool", "name": "샘플", "description": "테스트",
        "version": "0.1.0", "category": "utility", "icon": "icon.svg", "entry": "index.html",
        "authors": [{ "name": "홍길동" }], "requires": {}, "optional": {}
    }"#;

    fn base_files() -> Vec<(String, Vec<u8>)> {
        vec![
            ("module.json".into(), MANIFEST.as_bytes().to_vec()),
            ("index.html".into(), b"<!doctype html>".to_vec()),
            ("icon.svg".into(), b"<svg/>".to_vec()),
            ("assets/app.js".into(), b"export {};".to_vec()),
        ]
    }

    fn sums_for(files: &[(String, Vec<u8>)]) -> Vec<u8> {
        files
            .iter()
            .map(|(p, d)| format!("{}  {p}\n", sha256_hex(d)))
            .collect::<String>()
            .into_bytes()
    }

    /// Builds a zip; `sums` = None computes a correct SHA256SUMS.
    fn build(files: &[(String, Vec<u8>)], sums: Option<Vec<u8>>) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (path, data) in files {
            zip.start_file(path.as_str(), opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.start_file(SUMS_FILE, opts).unwrap();
        zip.write_all(&sums.unwrap_or_else(|| sums_for(files)))
            .unwrap();
        zip.finish().unwrap().into_inner()
    }

    fn with_file(path: &str, data: &[u8]) -> Vec<(String, Vec<u8>)> {
        let mut files = base_files();
        files.push((path.to_owned(), data.to_vec()));
        files
    }

    #[test]
    fn accepts_valid_package() {
        let bytes = build(&base_files(), None);
        let pkg = validate_package(&bytes).unwrap();
        assert_eq!(pkg.manifest.id, "sample-tool");
        assert_eq!(pkg.files.len(), 4);
        assert_eq!(pkg.sha256, sha256_hex(&bytes));
    }

    #[test]
    fn rejects_zip_slip_paths() {
        for bad in [
            "../evil.js",
            "a/../../evil.js",
            "/abs.js",
            "C:/win.js",
            "a\\b.js",
            "./x.js",
        ] {
            let bytes = build(&with_file(bad, b"x"), None);
            assert!(
                matches!(
                    validate_package(&bytes),
                    Err(PackageError::UnsafePath { .. })
                ),
                "{bad}"
            );
        }
    }

    #[test]
    fn rejects_symlink() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        let opts = SimpleFileOptions::default();
        for (p, d) in base_files() {
            zip.start_file(p, opts).unwrap();
            zip.write_all(&d).unwrap();
        }
        zip.add_symlink("link.js", "../../etc/passwd", opts)
            .unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        assert!(matches!(
            validate_package(&bytes),
            Err(PackageError::Symlink { .. })
        ));
    }

    #[test]
    fn rejects_oversized_package() {
        let big = vec![0u8; usize::try_from(MAX_PACKAGE_BYTES).unwrap() + 1];
        assert!(matches!(
            validate_package(&big),
            Err(PackageError::TooLarge { .. })
        ));
    }

    #[test]
    fn rejects_compression_bomb() {
        let bytes = build(&with_file("zeros.bin", &vec![0u8; 8 * 1024 * 1024]), None);
        assert!(matches!(
            validate_package(&bytes),
            Err(PackageError::CompressionRatio { .. })
        ));
    }

    #[test]
    fn rejects_unpacked_over_budget() {
        let bytes = build(&with_file("big.bin", &vec![7u8; 4096]), None);
        let tight = Limits {
            max_unpacked: 4000,
            ..Limits::default()
        };
        assert_eq!(
            validate_package_with(&bytes, &tight),
            Err(PackageError::UnpackedTooLarge)
        );
        assert!(validate_package_with(&bytes, &Limits::default()).is_ok());
    }

    #[test]
    fn rejects_case_insensitive_duplicates() {
        let bytes = build(&with_file("INDEX.html", b"x"), None);
        assert!(matches!(
            validate_package(&bytes),
            Err(PackageError::DuplicatePath { .. })
        ));
    }

    #[test]
    fn sums_must_match_and_be_complete() {
        let files = base_files();
        let mut sums = sums_for(&files);
        sums.extend_from_slice(format!("{}  ghost.js\n", "0".repeat(64)).as_bytes());
        assert!(matches!(
            validate_package(&build(&files, Some(sums))),
            Err(PackageError::ListedButMissing { .. })
        ));

        let partial = sums_for(&files[..3]);
        assert!(matches!(
            validate_package(&build(&files, Some(partial))),
            Err(PackageError::UnlistedFile { .. })
        ));

        let tampered = String::from_utf8(sums_for(&files)).unwrap().replacen(
            &sha256_hex(b"<svg/>"),
            &"0".repeat(64),
            1,
        );
        assert!(matches!(
            validate_package(&build(&files, Some(tampered.into_bytes()))),
            Err(PackageError::HashMismatch { .. })
        ));

        assert!(matches!(
            validate_package(&build(&files, Some(b"not a sums line\n".to_vec()))),
            Err(PackageError::MalformedSums { line: 1 })
        ));
    }

    #[test]
    fn requires_sums_manifest_entry_and_icon() {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("module.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(MANIFEST.as_bytes()).unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        assert_eq!(
            validate_package(&bytes),
            Err(PackageError::MissingFile {
                path: SUMS_FILE.into()
            })
        );

        let files: Vec<_> = base_files()
            .into_iter()
            .filter(|(p, _)| p != "icon.svg")
            .collect();
        assert_eq!(
            validate_package(&build(&files, None)),
            Err(PackageError::MissingFile {
                path: "icon.svg".into()
            })
        );
    }

    #[test]
    fn rejects_invalid_manifest() {
        let mut files = base_files();
        if let Some(m) = files.iter_mut().find(|(p, _)| p == "module.json") {
            m.1 = MANIFEST.replace("sample-tool", "Bad_Id").into_bytes();
        }
        assert!(matches!(
            validate_package(&build(&files, None)),
            Err(PackageError::Manifest(ManifestError::Invalid(_)))
        ));
    }

    #[test]
    fn build_package_round_trips_deterministically() {
        let (a, pkg) = build_package(&base_files()).unwrap();
        let mut reversed = base_files();
        reversed.reverse();
        let (b, _) = build_package(&reversed).unwrap();
        assert_eq!(a, b, "same files in any order give identical bytes");
        assert_eq!(pkg.sha256, sha256_hex(&a));
        assert_eq!(pkg.files.len(), base_files().len());
        assert!(build_package(&with_file("../x", b"x")).is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(
            validate_package(b"not a zip"),
            Err(PackageError::Zip(_))
        ));
    }
}
