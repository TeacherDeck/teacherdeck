// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { imageHeader, MAX_PIXELS } from "./header.ts";
import { clampRect, orientedSize, type Edit } from "./edit.ts";
export interface CropRequest {
  bytes: Uint8Array<ArrayBuffer>;
  edit: Edit;
  preview: boolean;
  format: "png" | "jpeg";
}
export interface CropResponse {
  blob: Blob;
  sourceWidth: number;
  sourceHeight: number;
  imageWidth: number;
  imageHeight: number;
}
self.onmessage = async (event: MessageEvent<CropRequest>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const { bytes, edit, preview, format } = event.data;
    imageHeader(bytes);
    bitmap = await createImageBitmap(new Blob([bytes]));
    if (bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width < 1 || bitmap.height < 1)
      throw new Error("INVALID_IMAGE");
    const size = orientedSize(bitmap.width, bitmap.height, edit.turns);
    const rect = preview
      ? { x: 0, y: 0, width: size.width, height: size.height }
      : clampRect(edit.rect, size.width, size.height);
    const scale = preview ? Math.min(1, 1400 / Math.max(size.width, size.height)) : 1;
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(rect.width * scale)),
      Math.max(1, Math.round(rect.height * scale)),
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
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await canvas.convertToBlob({
      type: preview || format === "png" ? "image/png" : "image/jpeg",
      quality: 0.95,
    });
    self.postMessage({
      blob,
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      imageWidth: size.width,
      imageHeight: size.height,
    } satisfies CropResponse);
  } catch {
    self.postMessage({ error: "INVALID_IMAGE" });
  } finally {
    bitmap?.close();
  }
};
