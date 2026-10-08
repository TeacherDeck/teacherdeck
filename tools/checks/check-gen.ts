// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-gen: regenerates every output in memory and compares it with the file on disk (GEN-006).
import { generateAll } from "../scripts/gen/index.ts";
import { exists, read } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";

export function checkGen(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const out of generateAll(root)) {
    if (!exists(root, out.path)) {
      violations.push({ rule: "GEN-006", file: out.path, message: "생성물이 없어요. `pnpm gen`을 실행하세요." });
    } else if (read(root, out.path) !== out.content) {
      violations.push({
        rule: "GEN-006",
        file: out.path,
        message: "생성물이 원천과 달라요. 손으로 고치지 말고 생성기를 고친 뒤 `pnpm gen`을 실행하세요.",
      });
    }
  }
  return violations;
}
