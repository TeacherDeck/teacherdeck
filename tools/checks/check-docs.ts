// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-docs: AGENTS.md/CLAUDE.md pairs, unique rule definitions, rule references,
// relative links and anchors, root AGENTS.md length, spec text copied into AGENTS.md.
import path from "node:path";
import { exists, listFiles, read } from "./lib/files.ts";
import { SPEC_FILE, type Violation } from "./lib/report.ts";
import { anchorsOf, linesOutsideFences, parseLinks, parseRuleDefs, parseRuleRefs, type RuleDef } from "./lib/spec.ts";

const ROOT_AGENTS_MAX_LINES = 200;
/** Spec paragraphs at least this long that appear verbatim in AGENTS.md/skills are reported (SHOULD). */
const COPY_MIN_CHARS = 80;

export function checkDocs(root: string): Violation[] {
  const files = listFiles(root);
  const mds = files.filter((f) => f.endsWith(".md"));
  const v: Violation[] = [];

  // MOD-016 / §4.1-6: every AGENTS.md has a CLAUDE.md containing only "@AGENTS.md", and vice versa.
  for (const f of files) {
    const dir = path.posix.dirname(f);
    const sibling = (name: string): string => (dir === "." ? name : `${dir}/${name}`);
    if (path.posix.basename(f) === "AGENTS.md" && !exists(root, sibling("CLAUDE.md"))) {
      v.push({ rule: "MOD-016", file: f, message: "같은 디렉터리에 CLAUDE.md(`@AGENTS.md`)가 없어요." });
    }
    if (path.posix.basename(f) === "CLAUDE.md") {
      if (!exists(root, sibling("AGENTS.md"))) {
        v.push({ rule: "MOD-016", file: f, message: "같은 디렉터리에 AGENTS.md가 없어요." });
      } else if (read(root, f).trim() !== "@AGENTS.md") {
        v.push({ rule: "MOD-016", file: f, message: "CLAUDE.md 내용은 `@AGENTS.md` 한 줄이어야 해요." });
      }
    }
  }

  // Rule definitions: only in docs/spec, each ID once, in the file that owns its prefix, with enforcement.
  const defs = new Map<string, RuleDef>();
  for (const f of mds) {
    for (const d of parseRuleDefs(f, read(root, f))) {
      const prefix = d.id.split("-")[0] ?? "";
      const prev = defs.get(d.id);
      if (prev !== undefined) {
        v.push({ rule: "DOC-004", file: f, line: d.line, message: `${d.id}가 ${prev.file}에 이미 정의돼 있어요. 정의는 한 곳에만 둬요.` });
        continue;
      }
      defs.set(d.id, d);
      if (d.file !== SPEC_FILE[prefix]) {
        v.push({ rule: "DOC-004", file: f, line: d.line, message: `${d.id}는 ${SPEC_FILE[prefix] ?? "?"}에서만 정의해요.` });
      }
      if (d.enforcement === null) {
        v.push({ rule: "DOC-004", file: f, line: d.line, message: `${d.id}에 \`— 강제:\` 항목이 없어요.` });
      }
    }
  }

  // References to rule IDs must exist.
  for (const f of mds) {
    for (const r of parseRuleRefs(read(root, f))) {
      if (!defs.has(r.id)) v.push({ rule: "DOC-003", file: f, line: r.line, message: `정의되지 않은 규칙 ${r.id}를 참조해요.` });
    }
  }

  // Relative links and anchors.
  const anchorCache = new Map<string, Set<string>>();
  for (const f of mds) {
    for (const link of parseLinks(read(root, f))) {
      const [target = "", anchor] = link.target.split("#");
      const resolved = target === "" ? f : path.posix.normalize(path.posix.join(path.posix.dirname(f), target));
      if (resolved.startsWith("..") || !exists(root, resolved)) {
        v.push({ rule: "DOC-003", file: f, line: link.line, message: `깨진 링크: ${link.target}` });
        continue;
      }
      if (anchor !== undefined && resolved.endsWith(".md")) {
        let anchors = anchorCache.get(resolved);
        if (anchors === undefined) {
          anchors = anchorsOf(read(root, resolved));
          anchorCache.set(resolved, anchors);
        }
        if (!anchors.has(decodeURIComponent(anchor))) {
          v.push({ rule: "DOC-003", file: f, line: link.line, message: `없는 앵커: ${link.target}` });
        }
      }
    }
  }

  // Root AGENTS.md stays short (DOC-004: summaries and links only).
  if (exists(root, "AGENTS.md")) {
    const n = read(root, "AGENTS.md").trimEnd().split("\n").length;
    if (n > ROOT_AGENTS_MAX_LINES) {
      v.push({ rule: "DOC-004", file: "AGENTS.md", message: `루트 AGENTS.md가 ${n}줄이에요. ${ROOT_AGENTS_MAX_LINES}줄 이하로 줄이세요.` });
    }
  }

  // SHOULD: spec paragraphs copied verbatim into AGENTS.md or skill files.
  const specParas = new Set<string>();
  for (const f of mds.filter((m) => m.startsWith("docs/spec/"))) {
    for (const { text } of linesOutsideFences(read(root, f))) {
      const t = text.replace(/^[-*>\d.\s]+/, "").trim();
      if (t.length >= COPY_MIN_CHARS && !t.startsWith("|")) specParas.add(t);
    }
  }
  for (const f of mds.filter((m) => path.posix.basename(m) === "AGENTS.md" || m.endsWith("/SKILL.md"))) {
    linesOutsideFences(read(root, f)).forEach(({ text, line }) => {
      const t = text.replace(/^[-*>\d.\s]+/, "").trim();
      if (specParas.has(t)) {
        v.push({ rule: "DOC-004", warning: true, file: f, line, message: "spec 문단을 그대로 복사했어요. ID·한 줄 요약·링크로 바꾸세요." });
      }
    });
  }

  return v;
}
