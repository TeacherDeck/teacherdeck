// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { assertMemoryBudget, createDocument, createPixelLayer, validateDocument } from "../core/model.ts";
import type { EditorDocument } from "../core/model.ts";
import { renderDocumentPixels, renderLayerTransformed, rasterizeLayer } from "../core/render.ts";
import { decodeProject, encodeProject } from "./project.ts";
import { decodePsd, encodePsd } from "./psd.ts";
import type { ImportedDocument, ImportOptions } from "./psd.ts";
import { imageHeader } from "./header.ts";
import { checkDimensions, MAX_INPUT_BYTES } from "./limits.ts";
import { requireInputBudget } from "./budget.ts";

export type ExportFormat = "deckimage" | "psd" | "png" | "jpeg";
export interface EncodeResult {
  blob: Blob;
  revision: number;
  format: ExportFormat;
}
export function inputKind(bytes: Uint8Array): "deckimage" | "psd" | "image" {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "deckimage";
  if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) return "psd";
  return "image";
}
export async function decodeDocument(
  bytes: Uint8Array<ArrayBuffer>,
  options: ImportOptions = {},
): Promise<ImportedDocument> {
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error("INPUT_LIMIT");
  requireInputBudget(bytes, options);
  const kind = inputKind(bytes);
  if (kind === "psd") return decodePsd(bytes, options);
  if (kind === "deckimage") {
    const document = decodeProject(bytes);
    return {
      document,
      warnings: [],
      fonts: [...new Set(document.layers.filter((l) => l.kind === "text").map((l) => l.text.fontFamily))],
      flattened: false,
    };
  }
  const header = imageHeader(bytes);
  const document = createDocument(header.width, header.height);
  assertMemoryBudget(document, header.width * header.height * 12 + bytes.length);
  let bitmap: ImageBitmap | undefined;
  try {
    // Chromium applies EXIF orientation. Never rotate the decoded pixels a second time.
    bitmap = await createImageBitmap(new Blob([bytes], { type: header.mime }), { imageOrientation: "from-image" });
    checkDimensions(bitmap.width, bitmap.height);
    document.width = bitmap.width;
    document.height = bitmap.height;
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
      context = canvas.getContext("2d");
    if (!context) throw new Error("INVALID_IMAGE");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    document.layers.push(createPixelLayer({ width: bitmap.width, height: bitmap.height, data: image.data }));
    canvas.width = 1;
    canvas.height = 1;
    return { document, warnings: [], fonts: [], flattened: false };
  } finally {
    bitmap?.close();
  }
}
export async function encodeDocument(document: EditorDocument, format: ExportFormat): Promise<EncodeResult> {
  validateDocument(document);
  if (format === "deckimage")
    return {
      blob: new Blob([Uint8Array.from(encodeProject(document))], { type: "application/vnd.teacherdeck.image" }),
      revision: document.revision,
      format,
    };
  if (format === "psd") {
    const output = encodePsd(document, { renderDocumentPixels, renderLayerTransformed, rasterizeLayer });
    return {
      blob: new Blob([Uint8Array.from(output)], { type: "image/vnd.adobe.photoshop" }),
      revision: document.revision,
      format,
    };
  }
  assertMemoryBudget(document, document.width * document.height * 16);
  const image = renderDocumentPixels(document),
    canvas = new OffscreenCanvas(document.width, document.height),
    context = canvas.getContext("2d");
  if (!context) throw new Error("INVALID_IMAGE");
  const raw = new OffscreenCanvas(document.width, document.height),
    rawContext = raw.getContext("2d");
  if (!rawContext) throw new Error("INVALID_IMAGE");
  try {
    rawContext.putImageData(new ImageData(Uint8ClampedArray.from(image.data), image.width, image.height), 0, 0);
    if (format === "jpeg") {
      context.fillStyle = "white";
      context.fillRect(0, 0, document.width, document.height);
    }
    context.drawImage(raw, 0, 0);
    const blob = await canvas.convertToBlob({ type: format === "jpeg" ? "image/jpeg" : "image/png", quality: 0.95 });
    return { blob, revision: document.revision, format };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    raw.width = 1;
    raw.height = 1;
  }
}
