// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { classify } from "../../eslint-plugin-deck/formatter.js";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const VIOLATIONS = path.join(REPO_ROOT, "tools/checks/__tests__/violations");
export const VALID = path.join(VIOLATIONS, "_valid");

/** `violations/<RULE-ID>/<entry>` pairs, discovered from disk so no sample goes untested. */
export function samples(): { rule: string; entry: string; abs: string; isDir: boolean }[] {
  return fs
    .readdirSync(VIOLATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[A-Z]+-\d{3}$/.test(d.name))
    .flatMap((d) =>
      fs.readdirSync(path.join(VIOLATIONS, d.name), { withFileTypes: true }).map((e) => ({
        rule: d.name,
        entry: e.name,
        abs: path.join(VIOLATIONS, d.name, e.name),
        isDir: e.isDirectory(),
      })),
    );
}

let eslint: ESLint | undefined;

/** Lints a sample as if it lived at `modules/sample/src/<name>`; returns the spec IDs reported. */
export async function lintAsModuleFile(abs: string): Promise<(string | null)[]> {
  eslint ??= new ESLint({ cwd: REPO_ROOT });
  const filePath = path.join(REPO_ROOT, "modules/sample/src", path.basename(abs));
  const [result] = await eslint.lintText(fs.readFileSync(abs, "utf8"), { filePath });
  return (result?.messages ?? []).map((m) => classify(m).id);
}
