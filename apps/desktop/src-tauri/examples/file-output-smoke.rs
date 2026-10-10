// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

//! Manual cross-volume QA. Pass existing absolute temp/output parent directories.
//! Only uniquely created synthetic fixtures are removed; unexpected files are preserved.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf, Prefix};
use std::time::Instant;

use deck_core::handles::{HANDLE_BYTES, RandomSource};
use teacherdeck_lib::file_output::{OutputBatch, WRITE_CHUNK_BYTES};
use teacherdeck_lib::file_read::FileReadSession;
use teacherdeck_lib::platform::{OsRng, TempArea};

fn disk(path: &Path) -> Option<u8> {
    match path.components().next()? {
        Component::Prefix(prefix) => match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                Some(letter.to_ascii_uppercase())
            }
            _ => None,
        },
        _ => None,
    }
}

fn checked_parent(argument: std::ffi::OsString) -> Result<PathBuf, ()> {
    let path = PathBuf::from(argument);
    if !path.is_absolute() || !path.is_dir() {
        return Err(());
    }
    fs::canonicalize(path).map_err(|_| ())
}

fn run() -> Result<(), ()> {
    let started = Instant::now();
    let mut args = std::env::args_os().skip(1);
    let temp_parent = checked_parent(args.next().ok_or(())?)?;
    let output_parent = checked_parent(args.next().ok_or(())?)?;
    if args.next().is_some()
        || disk(&temp_parent).is_none()
        || disk(&temp_parent) == disk(&output_parent)
        || disk(&output_parent).is_none()
    {
        return Err(());
    }
    let mut random = [0; HANDLE_BYTES];
    OsRng.fill(&mut random);
    let name = format!("teacherdeck-synthetic-{}", deck_core::util::to_hex(&random));
    let temp_root = temp_parent.join(&name);
    fs::create_dir(&temp_root).map_err(|_| ())?;
    let temp = TempArea::init_preserving(temp_root.clone()).map_err(|_| ())?;
    let batch = OutputBatch::create(&output_parent, &name).map_err(|_| ())?;
    let output_root = batch.folder_path().to_owned();
    let bytes: Vec<u8> = (0..WRITE_CHUNK_BYTES * 2 + 17)
        .map(|index| (index % 251) as u8)
        .collect();
    let source = temp_root.join("synthetic-source.bin");
    let mut source_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&source)
        .map_err(|_| ())?;
    source_file.write_all(&bytes).map_err(|_| ())?;
    source_file.sync_all().map_err(|_| ())?;
    drop(source_file);
    let snapshot = fs::metadata(&source).map_err(|_| ())?;
    let mut session = batch
        .begin("synthetic-result.bin", bytes.len() as u64, &temp)
        .map_err(|_| ())?;
    let mut offset = 0;
    let mut chunks = 0;
    let mut reader = FileReadSession::open(&source).map_err(|_| ())?;
    while offset < bytes.len() as u64 {
        let length = (bytes.len() as u64 - offset).min(WRITE_CHUNK_BYTES as u64) as usize;
        let chunk = reader.read_chunk(offset, length).map_err(|_| ())?;
        offset = session.append(offset, &chunk).map_err(|_| ())?;
        chunks += 1;
    }
    let result = session.commit().map_err(|_| ())?;
    if fs::read(&result).map_err(|_| ())? != bytes {
        return Err(());
    }
    session.abort().map_err(|_| ())?;
    if fs::read(&result).map_err(|_| ())? != bytes || fs::read(&source).map_err(|_| ())? != bytes {
        return Err(());
    }
    let after = fs::metadata(&source).map_err(|_| ())?;
    if snapshot.len() != after.len()
        || snapshot.modified().map_err(|_| ())? != after.modified().map_err(|_| ())?
    {
        return Err(());
    }
    drop(session);
    drop(reader);
    drop(batch);
    drop(temp);
    // Remove only verified fixture files. Empty-directory removal preserves unexpected entries.
    fs::remove_file(result).map_err(|_| ())?;
    fs::remove_file(source).map_err(|_| ())?;
    fs::remove_dir(output_root).map_err(|_| ())?;
    fs::remove_dir(temp_root).map_err(|_| ())?;
    writeln!(
        std::io::stdout().lock(),
        "합성 교차 볼륨 검증 성공: {}바이트, {chunks}청크, {}ms",
        bytes.len(),
        started.elapsed().as_millis()
    )
    .map_err(|_| ())?;
    Ok(())
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(()) => {
            let _ = writeln!(
                std::io::stderr().lock(),
                "합성 교차 볼륨 검증 실패: 서로 다른 볼륨의 절대 디렉터리 인자 두 개와 실행 권한을 확인하세요."
            );
            std::process::ExitCode::FAILURE
        }
    }
}
