// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

/** Rule ID prefix → spec file that defines the rules (docs/spec/README.md §1). */
export const SPEC_FILE: Readonly<Record<string, string>> = {
  GEN: "docs/spec/process.md",
  DOC: "docs/spec/process.md",
  MOD: "docs/spec/modules.md",
  CAP: "docs/spec/capabilities.md",
  BRG: "docs/spec/bridge-protocol.md",
  VER: "docs/spec/versioning.md",
  UI: "docs/spec/design-system.md",
  PRV: "docs/spec/privacy.md",
  SEC: "docs/spec/security.md",
  CI: "docs/spec/ci.md",
};

export interface Violation {
  rule: string;
  message: string;
  file?: string;
  line?: number;
  /** Warnings are printed but do not fail verify (SHOULD-level checks). */
  warning?: boolean;
}

export function specFor(rule: string): string {
  const prefix = rule.split("-")[0] ?? "";
  return SPEC_FILE[prefix] ?? "docs/spec/README.md";
}

/** Formats a violation as `[RULE-ID] location: message (정의: spec)`. */
export function format(v: Violation): string {
  const loc = v.file === undefined ? "" : `${v.file}${v.line === undefined ? "" : `:${v.line}`}: `;
  const level = v.warning === true ? "경고 " : "";
  return `[${v.rule}] ${level}${loc}${v.message} (정의: ${specFor(v.rule)})`;
}

export function hasErrors(violations: readonly Violation[]): boolean {
  return violations.some((v) => v.warning !== true);
}
