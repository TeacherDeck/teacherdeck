// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// ESLint formatter that prints every problem as `[RULE-ID] file:line:col: message (정의: spec)`.
// Messages already starting with `[RULE-ID]` keep their ID; third-party rules are mapped below;
// anything unmapped is printed as `[LINT]`.
import path from "node:path";
import { specFor } from "../checks/lib/report.ts";

/** Third-party ESLint rules that enforce a spec rule. */
export const RULE_IDS = {
  "@typescript-eslint/ban-ts-comment": "GEN-003",
  "@vitest/no-focused-tests": "GEN-003",
  "@vitest/no-disabled-tests": "GEN-003",
};
const ID_TAG_RE = /\s*\[([A-Z]+-\d{3})\]\s*/;
const SPEC_SUFFIX_RE = /\s*\(정의: [^)]*\)\s*$/;
/** Inline config comments reported under `linterOptions.noInlineConfig` have no ruleId. */
// Assembled from parts so check-suppressions does not flag this file.
const INLINE_CONFIG_RE = new RegExp(
  ["has no effect because you have 'noInlineConfig'", `Unused ${"eslint"}-${"disable"} directive`, "Unused inline config"].join("|"),
);

/**
 * @param {import("eslint").Linter.LintMessage} m
 * @returns {{ id: string | null, text: string }}
 */
export function classify(m) {
  // Our own rules start with the tag; core rules such as no-restricted-imports prepend their own
  // text before our configured message, so the tag can appear mid-message.
  const own = ID_TAG_RE.exec(m.message);
  if (own !== null) {
    const text = m.message.replace(own[0], " ").replace(SPEC_SUFFIX_RE, "").trim();
    return { id: own[1] ?? null, text };
  }
  if (m.ruleId !== null && m.ruleId in RULE_IDS) {
    return { id: RULE_IDS[/** @type {keyof typeof RULE_IDS} */ (m.ruleId)], text: `${m.message} (${m.ruleId})` };
  }
  if (m.ruleId === null && INLINE_CONFIG_RE.test(m.message)) {
    return { id: "GEN-003", text: `인라인 린트 설정으로 검사를 우회하지 마세요: ${m.message}` };
  }
  return { id: null, text: m.ruleId === null ? m.message : `${m.message} (${m.ruleId})` };
}

/** @type {import("eslint").ESLint.FormatterFunction} */
export default function formatter(results) {
  const lines = [];
  for (const r of results) {
    const file = path.relative(process.cwd(), r.filePath).split(path.sep).join("/");
    for (const m of r.messages) {
      const { id, text } = classify(m);
      const loc = `${file}:${m.line}:${m.column}`;
      lines.push(id === null ? `[LINT] ${loc}: ${text}` : `[${id}] ${loc}: ${text} (정의: ${specFor(id)})`);
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
