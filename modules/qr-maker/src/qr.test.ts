// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import jsQrModule from "jsqr";
import { describe, expect, it } from "vitest";
import { encodeQr, MAX_BYTES, prepareInput, QUIET_ZONE, svgPreview, toSvgBlob } from "./qr.ts";

// jsqr's CJS runtime exports the function itself; NodeNext reads its ESM-style declaration.
type DecodeQr = typeof jsQrModule.default;
const jsQR = typeof jsQrModule === "function" ? (jsQrModule as unknown as DecodeQr) : jsQrModule.default;

/** Rasterize the actual exported SVG path, then decode with an unrelated QR implementation. */
function decodeSvg(svg: string): string | undefined {
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!match?.[1]) throw new Error("missing viewBox");
  const modules = Number(match[1]);
  const scale = 5;
  const width = modules * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  const path = /<path d="([^"]*)" fill="black"/.exec(svg)?.[1] ?? "";
  for (const cell of path.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    const left = Number(cell[1]) * scale;
    const top = Number(cell[2]) * scale;
    for (let y = top; y < top + scale; y++) {
      for (let x = left; x < left + scale; x++) {
        const offset = (y * width + x) * 4;
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
      }
    }
  }
  return jsQR(data, width, width)?.data;
}

describe("QR content and exported SVG", () => {
  it.each(["https://example.org/lesson?q=synthetic#part", "  합성 수업\n다음 줄\t🌍  ", "  ", "a".repeat(MAX_BYTES)])(
    "independently decodes the exact UTF-8 text: %s",
    (text) => {
      const image = encodeQr(text);
      expect(decodeSvg(image.svg)).toBe(text);
      expect(image.pixels).toBe((image.cells.length + QUIET_ZONE * 2) * 8);
      expect(image.svg).toContain('fill="white"');
      expect(svgPreview(image)).toMatch(/^data:image\/svg\+xml/);
    },
  );

  it("validates web addresses without normalizing the encoded address", () => {
    expect(prepareInput("link", " https://example.org/a%20b?q=x#c ")).toBe("https://example.org/a%20b?q=x#c");
    expect(prepareInput("link", "HTTPS://example.org/lesson")).toBe("HTTPS://example.org/lesson");
    for (const input of [
      "example.org",
      "javascript:alert(1)",
      "ftp://example.org",
      "https://exam ple.org",
      "https://example.org/with space",
      "https:example.org",
      "https:/example.org",
      "https:\\\\example.org",
      "https://example.org\\path",
    ])
      expect(() => prepareInput("link", input)).toThrow("주소를 입력해 주세요");
    expect(prepareInput("text", "  합성\n  ")).toBe("  합성\n  ");
  });

  it("bounds UTF-8 bytes and rejects empty input", () => {
    expect(() => prepareInput("text", "")).toThrow("입력해 주세요");
    expect(() => prepareInput("link", "  ")).toThrow("입력해 주세요");
    expect(() => encodeQr("가".repeat(667))).toThrow("2,000바이트");
    expect(() => encodeQr("a".repeat(MAX_BYTES + 1))).toThrow("2,000바이트");
  });

  it("exports the full standalone SVG with no entered text or script in its markup", async () => {
    const text = "<script>합성</script>";
    const image = encodeQr(text);
    const blob = toSvgBlob(image);
    expect(blob.type).toContain("image/svg+xml");
    expect(await blob.text()).toBe(image.svg);
    expect(image.svg).not.toContain(text);
    expect(decodeSvg(await blob.text())).toBe(text);
  });
});
