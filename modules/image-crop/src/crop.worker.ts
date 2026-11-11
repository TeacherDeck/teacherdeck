// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { imageHeader, MAX_PIXELS } from "./header.ts";
import { clampRect, orientedSize, outputSize, type Edit } from "./edit.ts";
import type { ImageFormat } from "./output-format.ts";
export interface CropRequest {
  bytes: Uint8Array<ArrayBuffer>;
  edit: Edit;
  preview: boolean;
  format: ImageFormat;
}
export interface CropResponse {
  blob: Blob;
  sourceWidth: number;
  sourceHeight: number;
  imageWidth: number;
  imageHeight: number;
}
self.onmessage = async (event: MessageEvent<CropRequest & { fontFamily: string }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const { bytes, edit, preview, format, fontFamily } = event.data;
    imageHeader(bytes);
    bitmap = await createImageBitmap(new Blob([bytes]));
    if (bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width < 1 || bitmap.height < 1)
      throw new Error("INVALID_IMAGE");
    const size = orientedSize(bitmap.width, bitmap.height, edit.turns);
    const rect = preview
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : clampRect(edit.rect, size.width, size.height);
    const finalSize = outputSize({ ...edit, rect: clampRect(edit.rect, size.width, size.height) });
    const scale = preview ? Math.min(1, 1400 / Math.max(size.width, size.height)) : 1;
    const canvas = new OffscreenCanvas(
      preview ? Math.max(1, Math.round(rect.width * scale)) : finalSize.width,
      preview ? Math.max(1, Math.round(rect.height * scale)) : finalSize.height,
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("INVALID_IMAGE");
    if (!preview && format === "jpeg") {
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.scale(canvas.width / rect.width, canvas.height / rect.height);
    ctx.translate(-rect.x, -rect.y);
    ctx.translate(size.width / 2, size.height / 2);
    ctx.scale(edit.flipX ? -1 : 1, edit.flipY ? -1 : 1);
    ctx.rotate(((((edit.turns % 4) + 4) % 4) * Math.PI) / 2);
    ctx.filter = `brightness(${edit.brightness ?? 100}%) contrast(${edit.contrast ?? 100}%)`;
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    ctx.resetTransform();
    ctx.filter = "none";
    const a = edit.annotation;
    if (a) {
      // Annotation coordinates use the oriented source, so preview and cropped output agree.
      const sx = canvas.width / rect.width,
        sy = canvas.height / rect.height;
      const x = ((size.width * a.x) / 100 - rect.x) * sx;
      const y = ((size.height * a.y) / 100 - rect.y) * sy;
      ctx.fillStyle = a.ink;
      ctx.strokeStyle = a.ink;
      if (a.kind === "text") {
        if (typeof fontFamily !== "string" || !fontFamily || fontFamily.length > 500) throw new Error("INVALID_FONT");
        ctx.font = `${a.textPixels * sx}px ${fontFamily}`;
        ctx.textBaseline = "top";
        ctx.fillText(a.text, x, y);
      } else {
        ctx.lineWidth = Math.max(1, 3 * sx);
        ctx.strokeRect(x, y, ((size.width * a.width) / 100) * sx, ((size.height * a.height) / 100) * sy);
      }
    }
    const type = preview ? "image/png" : `image/${format}`;
    const blob = await canvas.convertToBlob({
      type,
      quality: 0.95,
    });
    if (blob.type !== type) throw new Error("ENCODER_UNAVAILABLE");
    self.postMessage({
      blob,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      imageWidth: size.width,
      imageHeight: size.height,
    } satisfies CropResponse);
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error && error.message === "ENCODER_UNAVAILABLE" ? "ENCODER_UNAVAILABLE" : "INVALID_IMAGE",
    });
  } finally {
    bitmap?.close();
  }
};
