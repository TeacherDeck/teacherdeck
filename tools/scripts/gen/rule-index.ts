// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Generates the rule index table in docs/spec/README.md from rule definitions (GEN-006).
import path from "node:path";
import { listFiles, read } from "../../checks/lib/files.ts";
import { PREFIXES, parseRuleDefs, type RuleDef } from "../../checks/lib/spec.ts";
import type { GenOutput } from "./index.ts";

export const README = "docs/spec/README.md";
const START = "<!-- rule-index:start -->";
const END = "<!-- rule-index:end -->";

export function collectRuleDefs(root: string): RuleDef[] {
  return listFiles(root)
    .filter((f) => f.startsWith("docs/spec/") && f.endsWith(".md"))
    .flatMap((f) => parseRuleDefs(f, read(root, f)));
}

export function renderTable(defs: readonly RuleDef[]): string {
  const sorted = [...defs].sort(
    (a, b) =>
      PREFIXES.indexOf(a.id.split("-")[0] ?? "") - PREFIXES.indexOf(b.id.split("-")[0] ?? "") ||
      a.id.localeCompare(b.id),
  );
  const esc = (s: string): string => s.replace(/\|/g, "\\|");
  return [
    "<!-- 생성물: `pnpm gen`(tools/scripts/gen/rule-index.ts). 손으로 고치지 마세요(GEN-006). -->",
    "| ID | 등급 | 요약 | 강제 수단 | 정의 문서 |",
    "|---|---|---|---|---|",
    ...sorted.map((r) => {
      const base = path.posix.basename(r.file);
      return `| ${r.id} | ${r.grade} | ${esc(r.summary)} | ${esc(r.enforcement ?? "")} | [${base}](${base}) |`;
    }),
  ].join("\n");
}

export function generateRuleIndex(root: string): GenOutput {
  const src = read(root, README);
  const start = src.indexOf(START);
  const end = src.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${README}: rule-index markers not found`);
  const content = `${src.slice(0, start)}${START}\n${renderTable(collectRuleDefs(root))}\n${src.slice(end)}`;
  return { path: README, content };
}
