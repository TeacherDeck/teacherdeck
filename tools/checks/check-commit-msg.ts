// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-commit-msg: Conventional Commits header and DCO Signed-off-by trailer (GEN-009).
import type { Violation } from "./lib/report.ts";

export const TYPES = ["feat", "fix", "docs", "refactor", "test", "build", "ci", "chore", "perf", "style", "revert"];
const HEADER_RE = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.*$`);
const MAX_HEADER = 100;
const SIGNOFF_RE = /^Signed-off-by: .+ <[^<>\s]+@[^<>\s]+>$/m;

export function checkCommitMessage(raw: string): Violation[] {
  // Drop comment lines git adds to the editor buffer.
  const msg = raw.split("\n").filter((l) => !l.startsWith("#")).join("\n").trim();
  const header = msg.split("\n")[0] ?? "";
  // Merge and fixup/squash commits created by git itself are exempt.
  if (/^(Merge |fixup! |squash! )/.test(header)) return [];
  const v: Violation[] = [];
  if (!HEADER_RE.test(header)) {
    v.push({ rule: "GEN-009", message: `첫 줄이 Conventional Commits 형식이 아니에요: "${header}". 예: "feat(timer): add presentation mode"` });
  } else if (header.length > MAX_HEADER) {
    v.push({ rule: "GEN-009", message: `첫 줄이 ${header.length}자예요. ${MAX_HEADER}자 이하로 줄이세요.` });
  }
  if (!SIGNOFF_RE.test(msg)) {
    v.push({ rule: "GEN-009", message: "Signed-off-by 트레일러가 없어요. `git commit -s`로 커밋하세요." });
  }
  return v;
}
