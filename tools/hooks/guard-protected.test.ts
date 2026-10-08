// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// The guard hook really blocks protected paths (Phase 7 completion check).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globToRegExp, isProtected } from "./guard-protected.mjs";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "guard-protected.mjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function runHook(file: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, cwd: ROOT }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, DECK_GUARD: "", ...env },
  });
}

describe("guard-protected hook", () => {
  it("matches globs", () => {
    expect(globToRegExp("**/generated/**").test("packages/sdk/src/generated/ErrorCode.ts")).toBe(true);
    expect(globToRegExp("LICENSE*").test("LICENSE-ADDITIONAL-TERMS")).toBe(true);
    expect(globToRegExp("tools/checks/**").test("tools/checks/check-docs.ts")).toBe(true);
    expect(isProtected("modules/timer/src/App.tsx")).toBe(false);
    expect(isProtected("docs/spec/process.md")).toBe(false);
  });

  it("blocks protected files with exit 2 and a GEN-005 message", () => {
    for (const f of ["LICENSE", "schema/module.schema.json", "apps/desktop/src-tauri/tauri.conf.json", ".github/workflows/ci.yml"]) {
      const r = runHook(path.join(ROOT, f));
      expect(r.status, f).toBe(2);
      expect(r.stderr).toContain("[GEN-005] 보호 파일입니다");
    }
  });

  it("allows ordinary files and DECK_GUARD=off sessions", () => {
    expect(runHook(path.join(ROOT, "modules/timer/src/App.tsx")).status).toBe(0);
    expect(runHook(path.join(ROOT, "LICENSE"), { DECK_GUARD: "off" }).status).toBe(0);
  });
});
