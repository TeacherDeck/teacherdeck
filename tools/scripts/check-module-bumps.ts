// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// CI: a module whose shipped files changed since <base> must bump its version and update its
// CHANGELOG (MOD-013, VER-004). Tests and docs-only changes do not count as user-visible.
import { spawnSync } from "node:child_process";
import { format, type Violation } from "../checks/lib/report.ts";

/** Files that do not change what users get. */
const NOT_SHIPPED = /(\.test\.tsx?$|(^|\/)AGENTS\.md$|(^|\/)CLAUDE\.md$|(^|\/)CHANGELOG\.md$)/;

export interface ModuleDiff {
  id: string;
  /** Paths changed under modules/<id>/, relative to the module. */
  changed: string[];
  /** Version at base, or null when the module is new. */
  baseVersion: string | null;
  headVersion: string;
}

export function checkBumps(diffs: readonly ModuleDiff[]): Violation[] {
  const v: Violation[] = [];
  for (const d of diffs) {
    if (d.baseVersion === null) continue;
    const shipped = d.changed.filter((f) => !NOT_SHIPPED.test(f));
    if (shipped.length === 0) continue;
    if (d.baseVersion === d.headVersion) {
      v.push({ rule: "MOD-013", file: `modules/${d.id}/module.json`, message: `파일이 바뀌었는데 버전(${d.headVersion})을 올리지 않았어요.` });
    }
    if (!d.changed.includes("CHANGELOG.md")) {
      v.push({ rule: "MOD-013", file: `modules/${d.id}/CHANGELOG.md`, message: "사용자에게 보이는 변경을 CHANGELOG에 적어 주세요." });
    }
  }
  return v;
}

function git(args: string[]): string | null {
  const res = spawnSync("git", args, { encoding: "utf8" });
  return res.status === 0 ? res.stdout : null;
}

function versionAt(ref: string, id: string): string | null {
  const text = git(["show", `${ref}:modules/${id}/module.json`]);
  if (text === null) return null;
  return (JSON.parse(text) as { version: string }).version;
}

if (import.meta.main === true) {
  const base = process.argv[2];
  if (base === undefined) {
    console.error("usage: node tools/scripts/check-module-bumps.ts <base>");
    process.exit(2);
  }
  const files = (git(["diff", "--name-only", `${base}...HEAD`, "--", "modules/"]) ?? "").split("\n").filter((f) => f !== "");
  const byModule = new Map<string, string[]>();
  for (const f of files) {
    const [, id, ...rest] = f.split("/");
    if (id === undefined || id === "_template" || rest.length === 0) continue;
    byModule.set(id, [...(byModule.get(id) ?? []), rest.join("/")]);
  }
  const diffs: ModuleDiff[] = [...byModule].flatMap(([id, changed]) => {
    const head = versionAt("HEAD", id);
    return head === null ? [] : [{ id, changed, baseVersion: versionAt(base, id), headVersion: head }];
  });
  const violations = checkBumps(diffs);
  for (const x of violations) console.log(format(x));
  process.exit(violations.length > 0 ? 1 : 0);
}
