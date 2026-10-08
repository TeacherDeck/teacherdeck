// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Claude Code PostToolUse hook (Edit|Write): formats the edited file with prettier or rustfmt.
// Never blocks: formatting problems surface later in `pnpm verify`.
import { spawnSync } from "node:child_process";
import path from "node:path";

const PRETTIER = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css"]);

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const file = JSON.parse(input)?.tool_input?.file_path;
  if (typeof file === "string") {
    const ext = path.extname(file);
    const root = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
    if (ext === ".rs") {
      spawnSync("rustfmt", ["--edition", "2024", file], { cwd: root, stdio: "ignore" });
    } else if (PRETTIER.has(ext) && !file.replace(/\\/g, "/").includes("/generated/")) {
      spawnSync(process.execPath, [path.join(root, "node_modules/prettier/bin/prettier.cjs"), "--write", "--log-level", "silent", file], {
        cwd: root,
        stdio: "ignore",
      });
    }
  }
} catch {
  // Formatting is best-effort.
}
process.exit(0);
