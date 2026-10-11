// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
//! Explicit development proof; no UI, cookies, general URL or process options.
#[cfg(debug_assertions)]
fn run() -> Result<bool, ()> {
    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .map_err(|_| ())?;
    let result = teacherdeck_lib::media_synthetic_proof(&workspace);
    let log = workspace.join("target/media-review/native-proof-result.json");
    let report = match result {
        Ok(report) => report,
        Err(error) => serde_json::json!({"passed":false,"error":error.code}),
    };
    std::fs::write(log, serde_json::to_vec_pretty(&report).map_err(|_| ())?).map_err(|_| ())?;
    use std::io::Write;
    std::io::stdout()
        .write_all(format!("{report}\n").as_bytes())
        .map_err(|_| ())?;
    Ok(report.get("passed").and_then(serde_json::Value::as_bool) == Some(true))
}
#[cfg(debug_assertions)]
fn main() {
    if run() != Ok(true) {
        std::process::exit(1);
    }
}
#[cfg(not(debug_assertions))]
fn main() {
    std::process::exit(2);
}
