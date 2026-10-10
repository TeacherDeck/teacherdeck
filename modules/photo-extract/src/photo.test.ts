// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { inspectPhoto } from "./photo.ts";
import { collectStudents } from "./roster.ts";
describe("safe thumbnail admission", () => {
  it("never treats active unknown media as previewable or exports an active extension", () => {
    expect(inspectPhoto(new TextEncoder().encode('<svg onload="alert(1)"/>'))).toEqual({
      extension: "bin",
      mime: "application/octet-stream",
      preview: false,
    });
  });
  it("keeps oversized and incomplete images as original files without decoded previews", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set(new TextEncoder().encode("IHDR"), 12);
    const view = new DataView(png.buffer);
    view.setUint32(16, 10000);
    view.setUint32(20, 10000);
    expect(inspectPhoto(png)).toMatchObject({ extension: "png", preview: false });
    view.setUint32(16, 64);
    view.setUint32(20, 88);
    expect(inspectPhoto(png).preview).toBe(true);
    expect(inspectPhoto(new Uint8Array([255, 216, 255]))).toMatchObject({ extension: "jpg", preview: false });
  });
  it("caps hostile header counts before contextual pairing", () => {
    expect(() =>
      collectStudents(
        Array.from({ length: 1001 }, (_, i) => ({ row: i, col: 0, text: "1학년 2반" })),
        "합성",
      ),
    ).toThrow("ROSTER_LIMIT");
  });
});
