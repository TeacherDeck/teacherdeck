// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// App version sources (VER-001): root package.json is the source of truth.

/** Matches the `version = "..."` line inside `[workspace.package]` of the root Cargo.toml. */
const WORKSPACE_VERSION_RE = /(\[workspace\.package\][^[]*?\nversion\s*=\s*")([^"]*)(")/;

export function cargoWorkspaceVersion(cargoToml: string): string | null {
  return WORKSPACE_VERSION_RE.exec(cargoToml)?.[2] ?? null;
}

export function setCargoWorkspaceVersion(cargoToml: string, version: string): string {
  return cargoToml.replace(WORKSPACE_VERSION_RE, (_m, a: string, _v: string, c: string) => `${a}${version}${c}`);
}

/** `[package]` sections that hard-code `version = "..."` instead of `version.workspace = true`. */
export function hasOwnPackageVersion(memberCargoToml: string): boolean {
  const pkg = /\[package\]([^[]*)/.exec(memberCargoToml)?.[1] ?? "";
  return /\nversion\s*=\s*"/.test(pkg);
}
