// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { checkSourceImages } from "./source-check.ts";

async function imagePdf(width: number, height: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  doc.context.register(
    doc.context.stream(new Uint8Array([0]), {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      BitsPerComponent: 8,
      ColorSpace: "DeviceGray",
    }),
  );
  return doc.save();
}

describe("source image preflight", () => {
  it("accepts source images within the pixel budget", async () => {
    await expect(checkSourceImages(await imagePdf(10, 20), 200)).resolves.toBeUndefined();
  });
  it.each([
    [10, 21],
    [0, 20],
    [-1, 20],
  ])("rejects oversized or invalid image dimensions %s x %s", async (width, height) => {
    await expect(checkSourceImages(await imagePdf(width, height), 200)).rejects.toThrow("SOURCE_IMAGE_TOO_LARGE");
  });
});
