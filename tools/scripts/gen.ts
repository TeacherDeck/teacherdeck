// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm gen`: writes every generated output (GEN-006).
import fs from "node:fs";
import path from "node:path";
import { generateAll } from "./gen/index.ts";

const root = process.cwd();
for (const out of generateAll(root)) {
  const abs = path.join(root, out.path);
  const prev = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  if (prev === out.content) {
    console.log(`unchanged  ${out.path}`);
    continue;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, out.content);
  console.log(`generated  ${out.path}`);
}
