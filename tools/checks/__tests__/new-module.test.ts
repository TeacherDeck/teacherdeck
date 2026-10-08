// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-001: a module generated from the template passes check-modules as-is, with every
// placeholder filled. Keeps the template and the checker in sync.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newModule } from "../../scripts/new-module.ts";
import { copyDir } from "../../scripts/lib/modules.ts";
import { checkModules } from "../check-modules.ts";
import { format } from "../lib/report.ts";
import { REPO_ROOT } from "./helpers.ts";

const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

function tempRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-newmod-"));
  temps.push(root);
  copyDir(path.join(REPO_ROOT, "modules/_template"), path.join(root, "modules/_template"));
  fs.mkdirSync(path.join(root, "schema"));
  fs.copyFileSync(path.join(REPO_ROOT, "schema/module.schema.json"), path.join(root, "schema/module.schema.json"));
  return root;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe("pnpm new:module (MOD-001)", () => {
  it("creates a module that passes check-modules with no placeholders left", () => {
    const root = tempRepo();
    const dir = newModule(root, { id: "seat-plan", name: "자리 배치", category: "classroom", author: "홍길동" });
    expect(checkModules(root).map(format)).toEqual([]);
    for (const f of walk(dir)) expect(fs.readFileSync(f, "utf8")).not.toMatch(/__[A-Z_]+__/);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "module.json"), "utf8")) as { id: string; name: string; category: string };
    expect(manifest).toMatchObject({ id: "seat-plan", name: "자리 배치", category: "classroom" });
  });

  it("refuses invalid ids, unknown categories and existing modules", () => {
    const root = tempRepo();
    expect(() => newModule(root, { id: "Bad_Id" })).toThrow(/MOD-002/);
    expect(() => newModule(root, { id: "ok-tool", category: "games" })).toThrow(/category/);
    newModule(root, { id: "ok-tool" });
    expect(() => newModule(root, { id: "ok-tool" })).toThrow(/이미/);
  });
});
