// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-suppressions: lint/type/test suppressions are banned unless allowlisted with a reason (GEN-003).
// The allowlist (tools/checks/suppressions.allow.json) is a protected file.
import path from "node:path";
import { exists, isRecord, listFiles, read, readJson } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";
import { SPDX_EXTENSIONS } from "./check-spdx.ts";

export const ALLOWLIST = "tools/checks/suppressions.allow.json";

// Patterns are assembled from parts so this file does not match itself.
const join = (...parts: string[]): string => parts.join("");
const PATTERNS: { name: string; re: RegExp; ext?: string[] }[] = [
  { name: "eslint 인라인 설정", re: new RegExp(join("eslint", "-(disable|enable)|/\\*\\s*eslint\\s")) },
  { name: "TypeScript 억제 주석", re: new RegExp(join("@ts-", "(ignore|expect-error|nocheck)")) },
  { name: "Rust allow 속성", re: new RegExp(join("#!?\\[\\s*(allow|expect)", "\\s*\\(")), ext: [".rs"] },
  { name: "Rust cfg_attr allow", re: new RegExp(join("cfg_attr\\s*\\(.*\\b(allow|expect)", "\\s*\\(")), ext: [".rs"] },
  { name: "Rust ignore 테스트", re: new RegExp(join("#\\[\\s*", "ignore\\b")), ext: [".rs"] },
];

interface AllowEntry {
  file: string;
  pattern: string;
  reason: string;
}

function loadAllowlist(root: string, v: Violation[]): AllowEntry[] {
  if (!exists(root, ALLOWLIST)) return [];
  const data = readJson(root, ALLOWLIST);
  const entries = isRecord(data) && Array.isArray(data["entries"]) ? (data["entries"] as unknown[]) : null;
  if (entries === null) {
    v.push({ rule: "GEN-003", file: ALLOWLIST, message: '형식은 { "entries": [{ "file", "pattern", "reason" }] }이어야 해요.' });
    return [];
  }
  const ok: AllowEntry[] = [];
  for (const e of entries) {
    if (isRecord(e) && typeof e["file"] === "string" && typeof e["pattern"] === "string" &&
        typeof e["reason"] === "string" && e["reason"].trim().length >= 10) {
      ok.push({ file: e["file"], pattern: e["pattern"], reason: e["reason"] });
    } else {
      v.push({ rule: "GEN-003", file: ALLOWLIST, message: `항목에 file, pattern, reason(10자 이상)이 모두 있어야 해요: ${JSON.stringify(e)}` });
    }
  }
  return ok;
}

export function checkSuppressions(root: string): Violation[] {
  const v: Violation[] = [];
  const allow = loadAllowlist(root, v);
  for (const f of listFiles(root)) {
    const ext = path.posix.extname(f);
    if (!SPDX_EXTENSIONS.has(ext)) continue;
    read(root, f).split("\n").forEach((text, i) => {
      for (const p of PATTERNS) {
        if (p.ext !== undefined && !p.ext.includes(ext)) continue;
        if (!p.re.test(text)) continue;
        if (allow.some((a) => a.file === f && text.includes(a.pattern))) continue;
        v.push({ rule: "GEN-003", file: f, line: i + 1, message: `${p.name}로 검사를 우회하지 마세요. 꼭 필요하면 사유와 함께 ${ALLOWLIST}에 등록 승인을 받으세요.` });
      }
    });
  }
  return v;
}
