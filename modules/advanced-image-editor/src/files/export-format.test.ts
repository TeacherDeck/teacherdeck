// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { exportName, exportTarget } from "./export-format.ts";

describe("source-aware image exports", () => {
  it("keeps periods in the already extension-free document title", () => {
    const title = "합성.수업.자료";
    expect(exportName(title, exportTarget("source", `${title}.JPEG`))).toBe(`${title}.JPEG`);
    expect(exportName(title, "deckimage")).toBe(`${title}.deckimage`);
    expect(exportName(title, "png")).toBe(`${title}.png`);
  });
  it.each([
    ["합성.jpg", "jpeg", "jpg"],
    ["합성.jpeg", "jpeg", "jpeg"],
    ["합성.JPEG", "jpeg", "JPEG"],
    ["합성.png", "png", "png"],
    ["합성.webp", "webp", "webp"],
  ])("keeps %s format and suffix", (source, format, extension) => {
    const target = exportTarget("source", source);
    expect(target).toEqual({ format, extension });
    expect(exportName("합성 결과", target)).toBe(`합성 결과.${extension}`);
  });

  it.each(["", "새 작업", "합성.psd", "합성.deckimage"])("defaults %s to PNG", (source) => {
    expect(exportTarget("source", source)).toEqual({ format: "png", extension: "png" });
  });

  it("honors explicit formats and leaves native project saving independent", () => {
    expect(exportName("합성", exportTarget("png", "합성.jpeg"))).toBe("합성.png");
    expect(exportName("합성", exportTarget("jpeg", "합성.webp"))).toBe("합성.jpg");
    expect(exportName("합성", exportTarget("webp", "합성.png"))).toBe("합성.webp");
    expect(exportName("합성", exportTarget("deckimage", "합성.jpeg"))).toBe("합성.deckimage");
    expect(exportName("합성", "psd")).toBe("합성.psd");
  });

  it("uses the actual source encoding when the original suffix is incorrect", () => {
    expect(exportName("합성", exportTarget("source", "합성.jpeg", "png"))).toBe("합성.png");
    expect(exportName("합성", exportTarget("source", "합성.png", "jpeg"))).toBe("합성.jpg");
    expect(exportName("합성", exportTarget("source", "합성.jpeg", "jpeg"))).toBe("합성.jpeg");
    expect(exportName("합성", exportTarget("jpeg", "합성.png", "webp"))).toBe("합성.jpg");
  });
});
