// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { HELD_MODULES, REPO_ROOT, bundledModuleIds, moduleIds } from "./modules.ts";

describe("held modules", () => {
  it("leaves held modules out of the default bundle but keeps every other module", () => {
    const all = moduleIds(REPO_ROOT);
    const bundled = bundledModuleIds(REPO_ROOT);
    expect(bundled).not.toContain("youtube-download");
    expect(bundled).toEqual(all.filter((id) => !(id in HELD_MODULES)));
  });

  it("only holds modules that exist, each with its tracking issue", () => {
    const all = moduleIds(REPO_ROOT);
    for (const [id, issue] of Object.entries(HELD_MODULES)) {
      expect(all).toContain(id);
      expect(issue).toMatch(/^https:\/\/github\.com\/TeacherDeck\/teacherdeck\/issues\/\d+$/);
    }
  });
});
