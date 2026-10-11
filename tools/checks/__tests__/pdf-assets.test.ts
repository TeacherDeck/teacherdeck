// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectPdfResources, PDF_ASSET_ALLOWLIST, PDF_MODULES, validateFontApproval } from "../lib/pdf-assets.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const approval = JSON.parse(fs.readFileSync(path.join(root, PDF_ASSET_ALLOWLIST), "utf8")) as Parameters<typeof validateFontApproval>[0];
const assetRoot = path.join(root, "modules/pdf-mask/node_modules/pdfjs-dist");
const readAsset = (name: string) => fs.readFileSync(path.join(assetRoot, name));

describe("bounded PDF asset exception", () => {
  it("rejects a replaced font or notice, a different version and an expanded exception", () => {
    expect(() => validateFontApproval(approval, "6.4.299", readAsset)).not.toThrow();
    expect(() => validateFontApproval(approval, "6.4.300", readAsset)).toThrow();
    for (const target of [approval.files[0]?.path, approval.licenseFile]) {
      expect(() => validateFontApproval(approval, "6.4.299", (name) => name === target ? new Uint8Array([0]) : readAsset(name))).toThrow();
    }
    expect(() => validateFontApproval({ ...approval, files: [...approval.files, { path: "standard_fonts/Other.ttf", sha256: "a".repeat(64) }] }, "6.4.299", readAsset)).toThrow();
  });
  it.each(PDF_MODULES)("keeps the approved assets and dependency notices inside %s", (id) => {
    const result = collectPdfResources(root, id);
    expect(result.fonts.paths).toHaveLength(4);
    expect(result.assets.filter((a) => a.path.endsWith(".ttf"))).toHaveLength(4);
    expect(result.assets.some((a) => a.path.includes("quickjs-eval"))).toBe(false);
    expect(result.assets.some((a) => a.path === "standard_fonts/LICENSE_LIBERATION")).toBe(true);
    expect(result.notices.some((n) => n.name === "pdfjs-dist" && n.text.includes("Apache"))).toBe(true);
    if (id !== "file-rename") {
      for (const name of ["pdf-lib", "@pdf-lib/standard-fonts", "@pdf-lib/upng", "pako", "tslib"])
        expect(result.notices.some((n) => n.name === name && n.text.length > 100)).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(path.join(root, `modules/${id}/src/generated/pdf-resources.json`), "utf8"))).toEqual(result);
  });
});
