// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Outputs generated from Rust source types by crates/deck-codegen (CAP-006, GEN-006).
import { spawnSync } from "node:child_process";
import { exists } from "../../checks/lib/files.ts";
import type { GenOutput } from "./index.ts";

export const CODEGEN_CRATE = "crates/deck-codegen/Cargo.toml";

/** Runs deck-codegen and returns its files. Roots without the crate (test fixtures) yield none. */
export function generateFromRust(root: string): GenOutput[] {
  if (!exists(root, CODEGEN_CRATE)) return [];
  const res = spawnSync("cargo", ["run", "--quiet", "--locked", "-p", "deck-codegen", "--bin", "deck-codegen"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) {
    throw new Error(`deck-codegen failed: ${res.error?.message ?? res.stderr.trim()}`);
  }
  const report = JSON.parse(res.stdout) as { files?: GenOutput[] };
  if (!Array.isArray(report.files)) throw new Error("deck-codegen printed no files");
  return report.files;
}
