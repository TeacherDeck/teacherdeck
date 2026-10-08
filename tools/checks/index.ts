// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Registry of repo-wide checkers used by `pnpm verify` and `node tools/checks/cli.ts <name>`.
import { checkDocs } from "./check-docs.ts";
import { checkGen } from "./check-gen.ts";
import { checkLicenses } from "./check-licenses.ts";
import { checkModules } from "./check-modules.ts";
import { checkSecurity } from "./check-security.ts";
import { checkSpdx } from "./check-spdx.ts";
import { checkSuppressions } from "./check-suppressions.ts";
import { checkVersions } from "./check-versions.ts";
import type { Violation } from "./lib/report.ts";

export const CHECKERS: Readonly<Record<string, (root: string) => Violation[]>> = {
  gen: checkGen,
  modules: checkModules,
  spdx: checkSpdx,
  versions: checkVersions,
  docs: checkDocs,
  security: checkSecurity,
  licenses: checkLicenses,
  suppressions: checkSuppressions,
};
