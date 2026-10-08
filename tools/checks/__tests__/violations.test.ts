// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Checker self-tests (docs/spec/ci.md §1): every sample under violations/<RULE-ID>/ must fail
// with exactly that rule ID, and every _valid sample must pass. Guards against checkers that
// silently stop reporting.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCommitMessage } from "../check-commit-msg.ts";
import { checkDenyTomlSync, checkLicenseList, loadAllowlist, parsePnpmLicenses } from "../check-licenses.ts";
import { CHECKERS } from "../index.ts";
import { format, type Violation } from "../lib/report.ts";
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { REPO_ROOT, VALID, lintAsModuleFile, samples } from "./helpers.ts";

/** Repo-wide checker that each rule's mini-repo samples are run through. */
const CHECKER_FOR: Record<string, string> = {
  "GEN-003": "suppressions",
  "GEN-006": "gen",
  "GEN-008": "spdx",
  "DOC-003": "docs",
  "DOC-004": "docs",
  "MOD-001": "modules",
  "MOD-002": "modules",
  "MOD-003": "modules",
  "MOD-004": "modules",
  "MOD-012": "modules",
  "MOD-013": "modules",
  "MOD-015": "modules",
  "MOD-016": "docs",
  "VER-001": "versions",
  "SEC-001": "security",
  "SEC-003": "security",
  "SEC-007": "security",
  "CI-001": "security",
  "CI-002": "security",
  "CI-003": "security",
  "CI-004": "security",
};

/** Samples that legitimately violate a second rule too (the schema re-checks the same field). */
const ALSO_EXPECTED: Record<string, string[]> = {
  "MOD-002/bad-id": ["MOD-004"],
  "MOD-012/no-authors": ["MOD-004"],
};

/** MOD-006: run the sample against the SDK with exactly the caps its manifest declares. */
async function runUndeclaredCapSample(dir: string): Promise<(string | null)[]> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")) as { requires: Record<string, string> };
  const host = createMockHost({ granted: Object.keys(manifest.requires) });
  const deck = await connect({ window: host.window, logger: { warn: () => undefined, debug: () => undefined } });
  const sample = (await import(pathToFileURL(path.join(dir, "src/run.ts")).href)) as { run(d: typeof deck): Promise<unknown> };
  try {
    await sample.run(deck);
    return [];
  } catch (e) {
    return [...String(e instanceof Error ? e.message : e).matchAll(/\[([A-Z]+-\d{3})\]/g)].map((m) => m[1] ?? null);
  } finally {
    deck.dispose();
  }
}

async function runSample(rule: string, abs: string, isDir: boolean): Promise<(string | null)[]> {
  const ext = path.extname(abs);
  if (isDir && rule === "MOD-006") return runUndeclaredCapSample(abs);
  if (isDir && rule === "SEC-011") return checkDenyTomlSync(abs, loadAllowlist(abs)).map((v) => v.rule);
  if (isDir) {
    const checker = CHECKERS[CHECKER_FOR[rule] ?? ""];
    if (checker === undefined) throw new Error(`no checker mapped for ${rule}`);
    return checker(abs).filter((v) => v.warning !== true).map((v) => v.rule);
  }
  if (ext === ".ts" || ext === ".tsx") return lintAsModuleFile(abs);
  if (ext === ".txt") return checkCommitMessage(fs.readFileSync(abs, "utf8")).map((v) => v.rule);
  if (ext === ".json" && rule === "SEC-011") {
    return checkLicenseList(parsePnpmLicenses(fs.readFileSync(abs, "utf8")), loadAllowlist(REPO_ROOT)).map((v) => v.rule);
  }
  throw new Error(`unhandled sample ${abs}`);
}

describe("violation samples fail with their rule ID", () => {
  const all = samples();
  it("has samples", () => expect(all.length).toBeGreaterThan(40));
  for (const s of all) {
    it(`${s.rule}/${s.entry}`, async () => {
      const ids = await runSample(s.rule, s.abs, s.isDir);
      expect(ids).toContain(s.rule);
      const also = ALSO_EXPECTED[`${s.rule}/${s.entry}`] ?? [];
      expect(ids.filter((id) => id !== s.rule && !also.includes(id ?? ""))).toEqual([]);
    }, 120_000);
  }
});

describe("valid samples pass", () => {
  const dirs: [string, string][] = [
    ["modules", "modules"],
    ["suppressions-allowlisted", "suppressions"],
    ["spdx", "spdx"],
    ["docs", "docs"],
    ["versions", "versions"],
    ["security", "security"],
  ];
  for (const [dir, checker] of dirs) {
    it(`${checker}: _valid/${dir}`, () => {
      const run = CHECKERS[checker];
      expect(run).toBeDefined();
      const out: Violation[] = run?.(path.join(VALID, dir)) ?? [];
      expect(out.map(format)).toEqual([]);
    });
  }
  it("eslint: _valid/eslint-ok.ts", async () => {
    expect(await lintAsModuleFile(path.join(VALID, "eslint-ok.ts"))).toEqual([]);
  }, 120_000);
  it("commit-msg: _valid/commit-msg.txt", () => {
    expect(checkCommitMessage(fs.readFileSync(path.join(VALID, "commit-msg.txt"), "utf8"))).toEqual([]);
  });
});
