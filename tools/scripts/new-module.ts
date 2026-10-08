// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm new:module <id> [--name 이름] [--category utility] [--author 이름]` (MOD-001).
// Copies modules/_template, filling placeholders. The template marker in package.json lets
// check-modules tell generated modules from hand-made ones.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ID_RE, MODULES_DIR, REPO_ROOT, TEMPLATE_DIR } from "./lib/modules.ts";

export const CATEGORIES = ["classroom", "file", "image", "document", "utility"] as const;

export interface NewModuleOptions {
  id: string;
  name?: string;
  category?: string;
  author?: string;
}

function gitUser(root: string): string | undefined {
  const res = spawnSync("git", ["config", "user.name"], { cwd: root, encoding: "utf8" });
  const name = res.stdout?.trim();
  return res.status === 0 && name !== "" ? name : undefined;
}

export function newModule(root: string, opts: NewModuleOptions): string {
  const { id } = opts;
  if (!ID_RE.test(id)) throw new Error(`[MOD-002] id "${id}"는 ${String(ID_RE)} 형식이어야 해요.`);
  const category = opts.category ?? "utility";
  if (!(CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`category는 ${CATEGORIES.join(", ")} 중 하나여야 해요.`);
  }
  const target = path.join(root, MODULES_DIR, id);
  if (fs.existsSync(target)) throw new Error(`modules/${id}가 이미 있어요.`);
  const template = path.join(root, MODULES_DIR, TEMPLATE_DIR);
  const values: Record<string, string> = {
    __MODULE_ID__: id,
    __MODULE_NAME__: opts.name ?? id,
    __CATEGORY__: category,
    __AUTHOR__: opts.author ?? gitUser(root) ?? "TODO(human): 저자 이름",
  };
  const fill = (text: string): string => text.replace(/__[A-Z_]+__/g, (k) => values[k] ?? k);

  const copy = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const src = path.join(from, e.name);
      const dst = path.join(to, fill(e.name));
      if (e.isDirectory()) copy(src, dst);
      else fs.writeFileSync(dst, fill(fs.readFileSync(src, "utf8")));
    }
  };
  copy(template, target);
  return target;
}

function parseArgs(argv: string[]): NewModuleOptions {
  const [id, ...rest] = argv;
  if (id === undefined) throw new Error("usage: pnpm new:module <id> [--name 이름] [--category utility] [--author 이름]");
  const opts: NewModuleOptions = { id };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${key ?? ""}에 값이 없어요.`);
    if (key === "--name") opts.name = value;
    else if (key === "--category") opts.category = value;
    else if (key === "--author") opts.author = value;
    else throw new Error(`알 수 없는 옵션: ${key ?? ""}`);
  }
  return opts;
}

if (import.meta.main === true) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const dir = newModule(REPO_ROOT, opts);
    console.log(`만들었어요: ${path.relative(REPO_ROOT, dir)}
다음 단계 (modules/AGENTS.md 모듈 추가 절차):
  1. pnpm install
  2. module.json의 name·description·requires를 채워요.
  3. src/에 기능과 테스트를 작성해요.
  4. pnpm verify`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
