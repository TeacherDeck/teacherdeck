// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm verify` (CI-005: CI runs exactly this) and `pnpm verify:fast` (lefthook pre-commit).
// Runs every step even after a failure and prints a summary. Steps: docs/spec/ci.md §1.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CHECKERS } from "../checks/index.ts";
import { format, hasErrors } from "../checks/lib/report.ts";

const root = process.cwd();
const fast = process.argv.includes("--fast");
const bin = (rel: string): string => path.join(root, "node_modules", rel);

type Step = { name: string; fast: boolean } & ({ cmd: string; args: string[] } | { checker: string });

const STEPS: Step[] = [
  { name: "check-gen", fast: false, checker: "gen" },
  {
    name: "lint",
    fast: true,
    cmd: process.execPath,
    args: [bin("eslint/bin/eslint.js"), ".", "--max-warnings", "0", "--format", "./tools/eslint-plugin-deck/formatter.js"],
  },
  { name: "typecheck", fast: true, cmd: process.execPath, args: [bin("typescript/bin/tsc"), "-b"] },
  { name: "test", fast: false, cmd: process.execPath, args: [bin("vitest/vitest.mjs"), "run"] },
  { name: "cargo fmt", fast: false, cmd: "cargo", args: ["fmt", "--all", "--check"] },
  { name: "cargo clippy", fast: false, cmd: "cargo", args: ["clippy", "--workspace", "--all-targets", "--", "-D", "warnings"] },
  { name: "cargo test", fast: false, cmd: "cargo", args: ["test", "--workspace"] },
  { name: "cargo deny", fast: false, cmd: "cargo", args: ["deny", "check"] },
  { name: "check-modules", fast: true, checker: "modules" },
  { name: "check-spdx", fast: false, checker: "spdx" },
  { name: "check-versions", fast: false, checker: "versions" },
  { name: "check-docs", fast: false, checker: "docs" },
  { name: "check-security", fast: false, checker: "security" },
  { name: "check-licenses", fast: false, checker: "licenses" },
  { name: "check-suppressions", fast: false, checker: "suppressions" },
];

const results: { name: string; ok: boolean; ms: number }[] = [];
for (const step of STEPS.filter((s) => !fast || s.fast)) {
  console.log(`\n▶ ${step.name}`);
  const t0 = Date.now();
  let ok: boolean;
  if ("checker" in step) {
    const checker = CHECKERS[step.checker];
    if (checker === undefined) throw new Error(`unknown checker ${step.checker}`);
    try {
      const violations = checker(root);
      for (const v of violations) console.log(format(v));
      ok = !hasErrors(violations);
    } catch (e) {
      console.log(`검사기 오류: ${e instanceof Error ? e.message : String(e)}`);
      ok = false;
    }
  } else {
    const res = spawnSync(step.cmd, step.args, { cwd: root, stdio: "inherit" });
    if (res.error !== undefined) console.log(`실행 실패: ${res.error.message}`);
    ok = res.status === 0;
  }
  results.push({ name: step.name, ok, ms: Date.now() - t0 });
}

console.log(`\n${fast ? "verify:fast" : "verify"} 요약`);
for (const r of results) console.log(`  ${r.ok ? "✔" : "✘"} ${r.name} (${(r.ms / 1000).toFixed(1)}s)`);
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.log(`\n실패 ${failed.length}개: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
console.log("\n모든 검사를 통과했어요.");
