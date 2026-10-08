// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-spdx: every source file (code and config) starts with the SPDX header (GEN-008).
// Format and scope: docs/spec/README.md §4. Markdown and comment-less formats (JSON) are out of scope.
import path from "node:path";
import { listFiles, read } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";

export const SPDX_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
  ".rs", ".css", ".toml", ".yml", ".yaml", ".ps1", ".html", ".svg",
]);
/** Machine-written files that cannot carry a header. */
const EXEMPT = new Set(["pnpm-lock.yaml"]);
/** The header must appear within this many leading lines (room for shebang, doctype, XML declaration). */
const HEAD_LINES = 6;

export function checkSpdx(root: string): Violation[] {
  const v: Violation[] = [];
  for (const f of listFiles(root)) {
    if (!SPDX_EXTENSIONS.has(path.posix.extname(f)) || EXEMPT.has(path.posix.basename(f))) continue;
    const head = read(root, f).split("\n").slice(0, HEAD_LINES).join("\n");
    if (!head.includes("SPDX-License-Identifier: GPL-3.0-only")) {
      v.push({ rule: "GEN-008", file: f, line: 1, message: "SPDX 헤더 `SPDX-License-Identifier: GPL-3.0-only`가 없어요." });
    } else if (!head.includes("Additional terms: see LICENSE-ADDITIONAL-TERMS")) {
      v.push({ rule: "GEN-008", file: f, line: 1, message: "SPDX 헤더 둘째 줄 `Additional terms: see LICENSE-ADDITIONAL-TERMS`가 없어요." });
    }
  }
  return v;
}
