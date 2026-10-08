// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Registry of generators run by `pnpm gen` and compared by check-gen.
import { generateRuleIndex } from "./rule-index.ts";
import { generateFromRust } from "./rust.ts";

export interface GenOutput {
  /** POSIX path relative to the repo root. */
  path: string;
  content: string;
}

/**
 * All generated outputs. Add new generators here (capability registry from Phase 4,
 * third-party notices from Phase 5). Rust-sourced outputs come from crates/deck-codegen.
 */
export function generateAll(root: string): GenOutput[] {
  return [generateRuleIndex(root), ...generateFromRust(root)];
}
