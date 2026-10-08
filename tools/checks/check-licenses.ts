// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-licenses: every npm dependency license is on the allowlist (SEC-011, GEN-004),
// and deny.toml allows exactly the same licenses for Rust crates.
import { spawnSync } from "node:child_process";
import { exists, isRecord, read, readJson } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";

export const ALLOWLIST = "tools/checks/licenses.allow.json";

export interface Allowlist {
  licenses: string[];
  /** Per-package exceptions approved by a human, each with a reason. */
  packages: { name: string; license: string; reason: string }[];
}

export interface DependencyLicense {
  name: string;
  version: string;
  license: string;
}

export function loadAllowlist(root: string): Allowlist {
  const data = readJson(root, ALLOWLIST);
  if (!isRecord(data) || !Array.isArray(data["licenses"]) || !Array.isArray(data["packages"])) {
    throw new Error(`${ALLOWLIST}: expected { licenses: string[], packages: [] }`);
  }
  return data as unknown as Allowlist;
}

/** Evaluates a simple SPDX expression: `A OR B` needs one allowed branch, `A AND B` needs all. */
export function isAllowedExpression(expr: string, allowed: ReadonlySet<string>): boolean {
  const e = expr.trim().replace(/^\((.*)\)$/, "$1").trim();
  if (/\sOR\s/.test(e)) return e.split(/\s+OR\s+/).some((p) => isAllowedExpression(p, allowed));
  if (/\sAND\s/.test(e)) return e.split(/\s+AND\s+/).every((p) => isAllowedExpression(p, allowed));
  return allowed.has(e);
}

export function checkLicenseList(deps: readonly DependencyLicense[], allow: Allowlist): Violation[] {
  const allowed = new Set(allow.licenses);
  return deps
    .filter((d) => !isAllowedExpression(d.license, allowed))
    .filter((d) => !allow.packages.some((p) => p.name === d.name && p.license === d.license && p.reason.trim() !== ""))
    .map((d) => ({
      rule: "SEC-011",
      message: `${d.name}@${d.version}의 라이선스 "${d.license}"가 allowlist에 없어요. 사람 승인을 받아 ${ALLOWLIST}에 추가하거나 다른 패키지를 쓰세요(GEN-004).`,
    }));
}

/** Parses `pnpm licenses list --json` output ({ [license]: [{ name, versions }] }). */
export function parsePnpmLicenses(json: string): DependencyLicense[] {
  const data = JSON.parse(json) as unknown;
  if (!isRecord(data)) return [];
  return Object.entries(data).flatMap(([license, pkgs]) =>
    (Array.isArray(pkgs) ? pkgs : []).flatMap((p: unknown) => {
      if (!isRecord(p) || typeof p["name"] !== "string") return [];
      const versions = Array.isArray(p["versions"]) ? (p["versions"] as unknown[]).map(String) : ["?"];
      return versions.map((version) => ({ name: p["name"] as string, version, license }));
    }),
  );
}

/** Reads `[licenses] allow = [...]` from deny.toml. */
export function denyTomlAllow(toml: string): string[] | null {
  const section = /\[licenses\]([\s\S]*?)(\n\[|$)/.exec(toml)?.[1];
  const list = section === undefined ? undefined : /\nallow\s*=\s*\[([\s\S]*?)\]/.exec(section)?.[1];
  if (list === undefined) return null;
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

export function checkDenyTomlSync(root: string, allow: Allowlist): Violation[] {
  if (!exists(root, "deny.toml")) return [{ rule: "SEC-011", file: "deny.toml", message: "deny.toml이 없어요." }];
  const deny = denyTomlAllow(read(root, "deny.toml"));
  const a = [...allow.licenses].sort().join(",");
  if (deny === null || [...deny].sort().join(",") !== a) {
    return [{ rule: "SEC-011", file: "deny.toml", message: `[licenses].allow가 ${ALLOWLIST}의 licenses와 달라요.` }];
  }
  return [];
}

export function checkLicenses(root: string): Violation[] {
  const allow = loadAllowlist(root);
  const res = spawnSync("pnpm", ["licenses", "list", "--json"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    return [{ rule: "SEC-011", message: `pnpm licenses list 실행에 실패했어요: ${res.stderr.trim().split("\n")[0] ?? ""}` }];
  }
  return [...checkLicenseList(parsePnpmLicenses(res.stdout), allow), ...checkDenyTomlSync(root, allow)];
}
