// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Directories never scanned. */
const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "coverage", ".pnpm-store"]);

/**
 * Intentional rule-violation samples used by checker self-tests.
 * Excluded from every repo-wide scan; they are scanned only by the tests.
 */
export const VIOLATIONS_DIR = "tools/checks/__tests__/violations";

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * Lists repo files as POSIX paths relative to `root`.
 * In a git work tree: tracked + untracked-but-not-ignored files. Otherwise a plain walk.
 */
export function listFiles(root: string): string[] {
  let files: string[];
  if (fs.existsSync(path.join(root, ".git"))) {
    const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    files = out.split("\0").filter((f) => f !== "" && fs.existsSync(path.join(root, f)));
  } else {
    files = walk(root, root);
  }
  return files
    .map(toPosix)
    .filter((f) => !f.startsWith(`${VIOLATIONS_DIR}/`) && !f.split("/").some((seg) => SKIP_DIRS.has(seg)))
    .sort();
}

function walk(root: string, dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, p, out);
    else if (e.isFile()) out.push(path.relative(root, p));
  }
  return out;
}

export function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

export function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

export function readJson(root: string, rel: string): unknown {
  return JSON.parse(read(root, rel)) as unknown;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
