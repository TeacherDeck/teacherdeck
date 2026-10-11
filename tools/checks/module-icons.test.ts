// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Packaged icons are independent images: host CSS cannot supply their currentColor.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledModuleIds, REPO_ROOT } from "../scripts/lib/modules.ts";

describe("bundled tool identity", () => {
  it("ships distinct self-contained icons rather than template placeholders", () => {
    const glyphs = new Set<string>();
    const template = fs.readFileSync(path.join(REPO_ROOT, "modules/_template/icon.svg"), "utf8");
    for (const id of bundledModuleIds(REPO_ROOT)) {
      const svg = fs.readFileSync(path.join(REPO_ROOT, "modules", id, "icon.svg"), "utf8");
      expect(svg, id).not.toBe(template);
      expect(svg, id).toContain('viewBox="0 0 48 48"');
      expect(svg, id).not.toMatch(/currentColor|<script|<foreignObject|(?:href|src)=/i);
      const normalized = svg
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\s+/g, " ")
        .trim();
      expect(glyphs.has(normalized), id).toBe(false);
      glyphs.add(normalized);
    }
  });
});
