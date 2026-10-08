// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Registry of generators run by `pnpm gen` and compared by check-gen.
import { generateCapTable } from "./cap-table.ts";
import { generateRuleIndex } from "./rule-index.ts";
import { generateFromRust } from "./rust.ts";
import { generateThirdParty } from "./third-party.ts";

export interface GenOutput {
  /** POSIX path relative to the repo root. */
  path: string;
  content: string;
}

/**
 * All generated outputs. Rust-sourced outputs come from crates/deck-codegen; the capability table
 * is derived from its capabilities.json; third-party notices come from pnpm and cargo metadata.
 */
export function generateAll(root: string): GenOutput[] {
  const rust = generateFromRust(root);
  const caps = rust.find((o) => o.path === "schema/capabilities.json");
  return [
    generateRuleIndex(root),
    ...rust,
    ...(caps === undefined ? [] : [generateCapTable(root, caps.content)]),
    ...generateThirdParty(root),
  ];
}
