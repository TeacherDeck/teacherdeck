// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// CI: every commit in <base>..<head> follows Conventional Commits and carries Signed-off-by (GEN-009).
import { spawnSync } from "node:child_process";
import { checkCommitMessage } from "../checks/check-commit-msg.ts";
import { format } from "../checks/lib/report.ts";

const [base, head = "HEAD"] = process.argv.slice(2);
if (base === undefined) {
  console.error("usage: node tools/scripts/check-commits.ts <base> [head]");
  process.exit(2);
}
// %x00 separates commits; %B is the raw message.
const res = spawnSync("git", ["log", "--no-merges", "--format=%H%x01%B%x00", `${base}..${head}`], { encoding: "utf8" });
if (res.status !== 0) {
  console.error(res.stderr);
  process.exit(2);
}
let failed = false;
for (const entry of res.stdout.split("\0").map((e) => e.trim()).filter((e) => e !== "")) {
  const [sha = "", message = ""] = entry.split("\x01");
  for (const v of checkCommitMessage(message)) {
    failed = true;
    console.log(format({ ...v, file: sha.slice(0, 10) }));
  }
}
process.exit(failed ? 1 : 0);
