// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Parser for the rule definition grammar in docs/spec/README.md §3.
import { SPEC_FILE } from "./report.ts";

export const PREFIXES = Object.keys(SPEC_FILE);
const PFX = PREFIXES.join("|");

export const DEF_RE = new RegExp(
  `^- \\*\\*((?:${PFX})-\\d{3})\\*\\* \\[(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY|DEPRECATED)\\] (.*)$`,
);
/** Rule references, including ranges like `UI-001~003`. */
const REF_RE = new RegExp(`\\b((?:${PFX}))-(\\d{3})(?:~(\\d{3}))?\\b`, "g");

export interface RuleDef {
  id: string;
  grade: string;
  summary: string;
  /** Text after `— 강제:`, or null when missing. */
  enforcement: string | null;
  file: string;
  line: number;
}

/** Splits markdown into lines, flagging lines inside fenced code blocks. */
export function linesOutsideFences(md: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let fence = false;
  md.split("\n").forEach((text, i) => {
    if (/^\s*```/.test(text)) {
      fence = !fence;
      return;
    }
    if (!fence) out.push({ text, line: i + 1 });
  });
  return out;
}

export function parseRuleDefs(file: string, md: string): RuleDef[] {
  const lines = linesOutsideFences(md);
  const defs: RuleDef[] = [];
  lines.forEach((l, i) => {
    const m = DEF_RE.exec(l.text);
    if (m === null) return;
    const [, id = "", grade = "", first = ""] = m;
    let block = first;
    for (const next of lines.slice(i + 1)) {
      if (DEF_RE.test(next.text) || next.text.startsWith("#")) break;
      block += `\n${next.text}`;
    }
    const enf = /— 강제:\s*(.+)/.exec(block);
    const head = first.replace(/\s*— 강제:.*$/, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const summary = /^(.*?다(?:\([^)]*\))?\.)(?=\s|$)/.exec(head)?.[1] ?? head;
    defs.push({ id, grade, summary, enforcement: enf?.[1]?.trim() ?? null, file, line: l.line });
  });
  return defs;
}

export function parseRuleRefs(md: string): { id: string; line: number }[] {
  const refs: { id: string; line: number }[] = [];
  md.split("\n").forEach((text, i) => {
    for (const m of text.matchAll(REF_RE)) {
      const prefix = m[1] ?? "";
      const a = Number(m[2]);
      const b = m[3] === undefined ? a : Number(m[3]);
      for (let k = a; k <= b; k++) refs.push({ id: `${prefix}-${String(k).padStart(3, "0")}`, line: i + 1 });
    }
  });
  return refs;
}

/** GitHub-style heading anchor. */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export function anchorsOf(md: string): Set<string> {
  const set = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text } of linesOutsideFences(md)) {
    const m = /^#{1,6}\s+(.*)$/.exec(text);
    if (m === null) continue;
    const base = slug(m[1] ?? "");
    const n = seen.get(base);
    seen.set(base, n === undefined ? 0 : n + 1);
    set.add(n === undefined ? base : `${base}-${n + 1}`);
  }
  return set;
}

/** Relative markdown links (`[text](target)`), excluding URLs and fenced code. */
export function parseLinks(md: string): { target: string; line: number }[] {
  const links: { target: string; line: number }[] = [];
  for (const { text, line } of linesOutsideFences(md)) {
    for (const m of text.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1] ?? "";
      if (/^(https?:|mailto:)/.test(target)) continue;
      links.push({ target, line });
    }
  }
  return links;
}
