// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";
vi.mock("pdfjs-dist", async () => ({ ...(await import("pdfjs-dist/legacy/build/pdf.mjs")), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "synthetic-worker" }));
import { pageWords } from "./pdf.ts";

describe("photo roster PDF viewport coordinates", () => {
  it.each([0, 90, 180, 270])("scales UserUnit with rotation %i and an offset CropBox", async (rotation) => {
    const doc = await PDFDocument.create();
    const source = doc.addPage([300, 150]);
    source.setCropBox(20, 20, 240, 110);
    source.setRotation(degrees(rotation));
    source.node.set(PDFName.of("UserUnit"), PDFNumber.of(2));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    source.drawText("SYNTHETIC-ROSTER", { x: 40, y: 70, size: 18, font });
    const loading = getDocument({ data: await doc.save(), disableFontFace: true, useSystemFonts: true, verbosity: 0 });
    const parsed = await loading.promise;
    try {
      const page = await parsed.getPage(1);
      const scale = 200 / 72;
      const word = (await pageWords(page, scale))[0];
      if (!word) throw new Error("MISSING_SYNTHETIC_WORD");
      const viewport = page.getViewport({ scale });
      const item = (await page.getTextContent()).items.find((item) => "str" in item && item.str === "SYNTHETIC-ROSTER");
      if (!item || !("width" in item)) throw new Error("MISSING_SYNTHETIC_TEXT");
      expect(rotation % 180 ? word.height : word.width).toBeCloseTo(item.width * scale * 2, 5);
      const [x, y] = viewport.convertToViewportPoint(40 + item.width * 0.9, 70);
      expect(x).toBeGreaterThanOrEqual(word.x - 0.001);
      expect(x).toBeLessThanOrEqual(word.x + word.width + 0.001);
      expect(y).toBeGreaterThanOrEqual(word.y - 0.001);
      expect(y).toBeLessThanOrEqual(word.y + word.height + 0.001);
    } finally {
      await loading.destroy();
    }
  });
});
