// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shared helpers for the module pipeline (new-module, pack-module, bundle-modules).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Repo root, independent of the current directory (scripts also run from apps/desktop). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

export const MODULES_DIR = "modules";
export const TEMPLATE_DIR = "_template";
export const ID_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** Ids of real modules (directories with module.json, template excluded), sorted. */
export function moduleIds(root: string): string[] {
  const dir = path.join(root, MODULES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== TEMPLATE_DIR && fs.existsSync(path.join(dir, e.name, "module.json")))
    .map((e) => e.name)
    .sort();
}

/**
 * Modules kept in the repo and checked by `pnpm verify` but left out of the bundled index, so the
 * deck does not show them (catalog.md §1). Each value is the issue that tracks the decision.
 */
export const HELD_MODULES: Readonly<Record<string, string>> = {
  "youtube-download": "https://github.com/TeacherDeck/teacherdeck/issues/15",
};

/** Ids of modules that ship as default modules: every module except held ones, sorted. */
export function bundledModuleIds(root: string): string[] {
  return moduleIds(root).filter((id) => !Object.hasOwn(HELD_MODULES, id));
}

/** Runs a command and returns stdout; throws with stderr on failure. */
export function run(cmd: string, args: string[], cwd: string): string {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error !== undefined) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${res.stderr}${res.stdout}`);
  return res.stdout;
}

/** Runs a deck-codegen binary (deck-pack, deck-validate). */
export function cargoBin(root: string, bin: string, args: string[]): string {
  return run("cargo", ["run", "--quiet", "--locked", "-p", "deck-codegen", "--bin", bin, "--", ...args], root);
}

export function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) copyDir(src, dst);
    else if (e.isFile()) fs.copyFileSync(src, dst);
  }
}
