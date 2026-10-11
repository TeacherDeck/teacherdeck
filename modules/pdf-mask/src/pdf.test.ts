// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", async () => ({ ...(await import("pdfjs-dist/legacy/build/pdf.mjs")), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "synthetic-worker" }));
import { pageInfo } from "./pdf.ts";
import { boundRect, detect } from "./logic.ts";

describe("PDF viewport redaction coordinates", () => {
  it.each([0, 90, 180, 270])("finds a labelled Latin name from actual text runs at rotation %i", async (rotation) => {
    const doc = await PDFDocument.create();
    const source = doc.addPage([400, 200]);
    source.setRotation(degrees(rotation));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let x = 30;
    for (const text of ["Name:", "Synthetic", "User"]) {
      source.drawText(text, { x, y: 90, size: 16, font });
      x += font.widthOfTextAtSize(text, 16) + 5;
    }
    const loading = getDocument({ data: await doc.save(), disableFontFace: true, useSystemFonts: true, verbosity: 0 });
    try {
      const parsed = await loading.promise;
      const info = await pageInfo(await parsed.getPage(1));
      const found = detect([info], [], ["이름"]);
      expect(found).toHaveLength(1);
      expect(found[0]?.label.replace(/\s/g, "")).toBe("SyntheticUser");
      // Each selected text object must be fully covered in the output coordinate system.
      for (const box of info.boxes.filter((box) => /Synthetic|User/.test(box.text))) {
        const mask = found[0]?.rect;
        if (!mask) throw new Error("MISSING_SYNTHETIC_MASK");
        expect(mask.x).toBeLessThanOrEqual(box.x);
        expect(mask.y).toBeLessThanOrEqual(box.y);
        expect(mask.x + mask.width).toBeGreaterThanOrEqual(Math.min(info.width, box.x + box.width));
        expect(mask.y + mask.height).toBeGreaterThanOrEqual(Math.min(info.height, box.y + box.height));
      }
    } finally {
      await loading.destroy();
    }
  });
  it.each([0, 90, 180, 270].flatMap((rotation) => [1, 2].map((userUnit) => ({ rotation, userUnit }))))(
    "covers text with rotation $rotation and UserUnit $userUnit inside an offset CropBox",
    async ({ rotation, userUnit }) => {
      const doc = await PDFDocument.create();
      const source = doc.addPage([300, 150]);
      source.setCropBox(20, 20, 240, 110);
      source.setRotation(degrees(rotation));
      source.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));
      const font = await doc.embedFont(StandardFonts.Helvetica);
      source.drawText("PRIVATE-IDENTIFIER", { x: 40, y: 70, size: 18, font });
      const loading = getDocument({
        data: await doc.save(),
        disableFontFace: true,
        useSystemFonts: true,
        verbosity: 0,
      });
      const parsed = await loading.promise;
      try {
        const page = await parsed.getPage(1);
        const info = await pageInfo(page);
        const viewport = page.getViewport({ scale: 1 });
        const item = (await page.getTextContent()).items.find(
          (item) => "str" in item && item.str === "PRIVATE-IDENTIFIER",
        );
        if (!item || !("width" in item)) throw new Error("MISSING_SYNTHETIC_TEXT");
        const mask = detect([info], ["PRIVATE-IDENTIFIER"], ["검색어"])[0]?.rect;
        expect(mask).toBeDefined();
        if (!mask) throw new Error("MISSING_SYNTHETIC_MASK");
        // Independent source-space endpoints must both fit inside the saved pixel erasure.
        for (const [x, y] of [
          [40, 70],
          [40 + item.width, 70],
        ] as const) {
          const [px, py] = viewport.convertToViewportPoint(x, y);
          expect(px).toBeGreaterThanOrEqual(mask.x);
          expect(px).toBeLessThanOrEqual(mask.x + mask.width);
          expect(py).toBeGreaterThanOrEqual(mask.y);
          expect(py).toBeLessThanOrEqual(mask.y + mask.height);
        }
        const extent = rotation % 180 ? mask.height : mask.width;
        expect(extent).toBeGreaterThanOrEqual(item.width * userUnit);
        expect(info.width).toBe(viewport.width);
        expect(info.height).toBe(viewport.height);
        expect(boundRect(mask, info.width, info.height)).toEqual(mask);
      } finally {
        await loading.destroy();
      }
    },
  );
});
