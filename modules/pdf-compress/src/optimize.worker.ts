// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { optimize } from "./optimize.ts";
self.onmessage = (event: MessageEvent<{ bytes: Uint8Array<ArrayBuffer>; quality: number }>) => {
  void optimize(
    event.data.bytes,
    event.data.quality,
    async (bytes, width, height, quality) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), {
        imageOrientation: "from-image",
        colorSpaceConversion: "none",
      });
      try {
        if (bitmap.width !== width || bitmap.height !== height) throw new Error("IMAGE_DIMENSIONS_CHANGED");
        const canvas = new OffscreenCanvas(width, height);
        try {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("CANVAS_UNAVAILABLE");
          context.drawImage(bitmap, 0, 0);
          const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
          return new Uint8Array(await blob.arrayBuffer());
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        bitmap.close();
      }
    },
    (done, total) => self.postMessage({ kind: "progress", done, total }),
  ).then(
    (bytes) => self.postMessage({ kind: "result", bytes }, { transfer: [bytes.buffer] }),
    () => self.postMessage({ kind: "error" }),
  );
};
