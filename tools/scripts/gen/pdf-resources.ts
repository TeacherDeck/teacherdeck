// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { exists } from "../../checks/lib/files.ts";
import { collectPdfResources, PDF_MODULES } from "../../checks/lib/pdf-assets.ts";
import type { GenOutput } from "./index.ts";

export function generatePdfResources(root: string): GenOutput[] {
  return PDF_MODULES.filter((id) => exists(root, `modules/${id}/package.json`)).map((id) => ({
    path: `modules/${id}/src/generated/pdf-resources.json`,
    content: `${JSON.stringify(collectPdfResources(root, id), null, 2)}\n`,
  }));
}
