// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Claude Code PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit): blocks edits to protected paths
// (GEN-001, GEN-005, GEN-006, GEN-007). Exit 2 tells Claude Code to block the call and shows stderr.
//
// This guards against accidental drift by agents; it is NOT a security boundary. A human who has
// approved a change can open a session with DECK_GUARD=off.
import path from "node:path";

/** Protected paths (BOOTSTRAP §4.5; keep in sync with .github/CODEOWNERS). */
export const PROTECTED = [
  "LICENSE*",
  "AUTHORS",
  "TRADEMARK.md",
  "schema/**",
  "**/generated/**",
  ".github/workflows/**",
  ".github/CODEOWNERS",
  "apps/desktop/src-tauri/capabilities/**",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/tauri.release.conf.json",
  "deny.toml",
  "eslint.config.js",
  "tools/checks/**",
  "tools/eslint-plugin-deck/**",
  "tools/hooks/**",
  ".claude/settings.json",
];

const SPECIAL = new Set([".", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);

/**
 * Minimal glob → RegExp: `**` any depth, `*` within a segment.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*" && glob.charAt(i + 1) === "*") {
      const slash = glob.charAt(i + 2) === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else {
      re += SPECIAL.has(c) ? `\\${c}` : c;
    }
  }
  return new RegExp(`^${re}$`);
}

const MATCHERS = PROTECTED.map(globToRegExp);

/**
 * Repo-relative POSIX path, or null when outside the repo.
 * @param {string} root
 * @param {string} file
 */
export function relativeToRepo(root, file) {
  const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
}

/** @param {string} rel */
export function isProtected(rel) {
  return MATCHERS.some((re) => re.test(rel));
}

async function main() {
  if (process.env["DECK_GUARD"] === "off") return 0;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return 0;
  }
  const file = data?.tool_input?.file_path ?? data?.tool_input?.notebook_path;
  if (typeof file !== "string") return 0;
  const root = process.env["CLAUDE_PROJECT_DIR"] ?? data.cwd ?? process.cwd();
  const rel = relativeToRepo(root, file);
  if (rel === null || !isProtected(rel)) return 0;
  process.stderr.write(`[GEN-005] 보호 파일입니다: ${rel}. 작업을 멈추고 제안서를 작성하세요. (정의: docs/spec/process.md)\n`);
  return 2;
}

if (import.meta.main === true) {
  main().then((code) => process.exit(code));
}
