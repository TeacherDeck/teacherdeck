// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import qrcode from "qrcode-generator";

export type InputMode = "link" | "text";
export type OutputFormat = "png" | "svg";
export const MAX_BYTES = 2000;
export const QUIET_ZONE = 4;
export const CELL_PIXELS = 8;
export interface QrImage {
  cells: boolean[][];
  svg: string;
  pixels: number;
}

/** Link mode validates without rewriting the address; text preserves all whitespace. */
export function prepareInput(mode: InputMode, input: string): string {
  const text = mode === "link" ? input.trim() : input;
  if (text.length === 0) throw new Error("링크나 글을 입력해 주세요.");
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error("내용이 너무 길어요. UTF-8 기준 2,000바이트 이하로 줄여 주세요.");
  if (mode === "link") {
    try {
      if (!/^https?:\/\//i.test(text) || text.includes("\\")) throw new Error();
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol) || !url.hostname || /\s/.test(text)) throw new Error();
    } catch {
      throw new Error("http:// 또는 https://로 시작하는 주소를 입력해 주세요. 글을 넣으려면 ‘글’을 선택해 주세요.");
    }
  }
  return text;
}

/** The maintained encoder implements the QR standard; UTF-8 byte conversion is explicit. */
export function encodeQr(text: string): QrImage {
  prepareInput("text", text);
  qrcode.stringToBytes = (value) => Array.from(new TextEncoder().encode(value));
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const count = code.getModuleCount();
  const cells = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => code.isDark(row, column)),
  );
  const size = count + QUIET_ZONE * 2;
  const pixels = size * CELL_PIXELS;
  const paths: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (cells[row]?.[col]) paths.push(`M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`);
    }
  }
  // Fixed black/white are QR image data, independent of the UI theme (quiet zone included).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${paths.join("")}" fill="black"/></svg>`;
  return { cells, svg, pixels };
}

export function svgPreview(image: QrImage): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image.svg)}`;
}

export function toSvgBlob(image: QrImage): Blob {
  return new Blob([image.svg], { type: "image/svg+xml;charset=utf-8" });
}

export async function toPngBlob(image: QrImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.pixels;
  canvas.height = image.pixels;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 만들지 못했어요. 도구를 다시 열어 주세요.");
  context.fillStyle = "white";
  context.fillRect(0, 0, image.pixels, image.pixels);
  context.fillStyle = "black";
  for (let row = 0; row < image.cells.length; row++) {
    for (let col = 0; col < image.cells.length; col++) {
      if (image.cells[row]?.[col])
        context.fillRect((col + QUIET_ZONE) * CELL_PIXELS, (row + QUIET_ZONE) * CELL_PIXELS, CELL_PIXELS, CELL_PIXELS);
    }
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob) resolve(blob);
      else reject(new Error("PNG를 만들지 못했어요. 다시 저장해 주세요."));
    }, "image/png");
  });
}
