// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { dimensions, imageHeader, validateOptions, type Options } from './image.ts';
globalThis.onmessage = async (event: MessageEvent<{ blob: Blob; options: Options }>) => {
  let bitmap: ImageBitmap | undefined;
  try {
    const { blob, options } = event.data;
    validateOptions(options);
    const header = imageHeader(new Uint8Array(await blob.arrayBuffer()));
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const size = dimensions(bitmap.width, bitmap.height, options.maxEdge);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('CANVAS_UNAVAILABLE');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    // Preserve alpha even when JPEG was requested for a potentially transparent input.
    const type = options.format === 'jpeg' && header.mime === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const output = await canvas.convertToBlob({ type, quality: options.quality / 100 });
    if (output.type !== type) throw new Error('ENCODER_UNAVAILABLE');
    globalThis.postMessage({ ok: true, blob: output });
  } catch { globalThis.postMessage({ ok: false }); }
  finally { bitmap?.close(); }
};