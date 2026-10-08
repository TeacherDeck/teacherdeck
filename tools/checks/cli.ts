// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Usage:
//   node tools/checks/cli.ts <checker>            run one repo-wide checker (see index.ts)
//   node tools/checks/cli.ts commit-msg <file>    validate a commit message file (lefthook commit-msg)
import fs from "node:fs";
import { checkCommitMessage } from "./check-commit-msg.ts";
import { CHECKERS } from "./index.ts";
import { format, hasErrors, type Violation } from "./lib/report.ts";

const [name, arg] = process.argv.slice(2);
let violations: Violation[];
if (name === "commit-msg" && arg !== undefined) {
  violations = checkCommitMessage(fs.readFileSync(arg, "utf8"));
} else {
  const checker = name === undefined ? undefined : CHECKERS[name];
  if (checker === undefined) {
    console.error(`usage: cli.ts <${Object.keys(CHECKERS).join("|")}> | commit-msg <file>`);
    process.exit(2);
  }
  violations = checker(process.cwd());
}
for (const v of violations) console.log(format(v));
process.exit(hasErrors(violations) ? 1 : 0);
