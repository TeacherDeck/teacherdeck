// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Third-party notices for the About screen (design-system.md §5): npm runtime dependencies of the
// shell and Rust crates linked into the host (normal dependencies on Windows only).
import { spawnSync } from "node:child_process";
import { exists } from "../../checks/lib/files.ts";
import { parsePnpmLicenses } from "../../checks/check-licenses.ts";
import type { GenOutput } from "./index.ts";

export const THIRD_PARTY = "apps/desktop/src/generated/third-party.json";
const HOST_CRATE = "teacherdeck";
const TARGET = "x86_64-pc-windows-msvc";

export interface Notice {
  name: string;
  version: string;
  license: string;
  source: "npm" | "cargo";
}

function run(cmd: string, args: string[], root: string, shell = false): string {
  const res = spawnSync(shell ? [cmd, ...args].join(" ") : cmd, shell ? [] : args, {
    cwd: root,
    encoding: "utf8",
    shell,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr.trim().split("\n")[0] ?? ""}`);
  return res.stdout;
}

interface CargoMetadata {
  packages: { id: string; name: string; version: string; license: string | null; source: string | null }[];
  resolve: { nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[] };
}

function cargoNotices(root: string): Notice[] {
  const meta = JSON.parse(
    run("cargo", ["metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET], root),
  ) as CargoMetadata;
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const start = meta.packages.find((p) => p.name === HOST_CRATE && p.source === null);
  if (start === undefined) return [];
  const seen = new Set<string>();
  const stack = [start.id];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const d of nodes.get(id)?.deps ?? []) {
      // Normal (runtime) dependencies only; build and dev dependencies are not shipped.
      if (!d.dep_kinds.some((k) => k.kind === null) || seen.has(d.pkg)) continue;
      seen.add(d.pkg);
      stack.push(d.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => p !== undefined && p.source !== null)
    .map((p) => ({ name: p.name, version: p.version, license: p.license ?? "UNKNOWN", source: "cargo" as const }));
}

function npmNotices(root: string): Notice[] {
  const json = run("pnpm", ["--filter", "@deck/desktop", "licenses", "list", "--json", "--prod"], root, true);
  return parsePnpmLicenses(json)
    .filter((d) => !d.name.startsWith("@deck/"))
    .map((d) => ({ name: d.name, version: d.version, license: d.license, source: "npm" as const }));
}

export function generateThirdParty(root: string): GenOutput[] {
  if (!exists(root, "apps/desktop/package.json") || !exists(root, "apps/desktop/src-tauri/Cargo.toml")) return [];
  const notices = [...npmNotices(root), ...cargoNotices(root)].sort(
    (a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  return [{ path: THIRD_PARTY, content: `${JSON.stringify(notices, null, 2)}\n` }];
}
