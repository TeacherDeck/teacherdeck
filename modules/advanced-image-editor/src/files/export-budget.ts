// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { layerBounds } from "../core/geometry.ts";
import { layerSize } from "../core/model.ts";
import type { EditorDocument } from "../core/model.ts";
import { checkDimensions } from "./limits.ts";

/** Full compositor plus one adjusted layer, or raster/canvas/encoder buffers during final output. */
export function rasterEncodingScratch(document: EditorDocument): number {
  const composite = checkDimensions(document.width, document.height) * 4;
  const largestLayer = Math.max(
    0,
    ...document.layers.map((layer) => {
      const size = layerSize(layer);
      return checkDimensions(size.width, size.height) * 4;
    }),
  );
  return Math.max(composite + largestLayer * 2, composite * 3) + 1024 * 1024;
}

/** Cached transformed layers/masks, compositor, writer growth and output copies all count before rendering. */
export function psdEncodingScratch(document: EditorDocument): number {
  const bytes = document.layers.map((layer) => {
    const bounds = layerBounds(layer);
    return checkDimensions(bounds.width, bounds.height) * 4;
  });
  const composite = checkDimensions(document.width, document.height) * 4;
  const cached = bytes.reduce((sum, size, index) => {
    const layer = document.layers[index];
    return sum + size * (layer?.kind === "pixel" && layer.mask ? 2 : 1);
  }, composite);
  const localScratch = document.layers.map((layer, index) => {
    const size = layerSize(layer);
    return size.width * size.height * 12 + (layer.kind === "pixel" && layer.mask ? (bytes[index] ?? 0) * 2 : 0);
  });
  return cached + Math.max(cached * 3 + Math.max(0, ...bytes), 0, ...localScratch) + 1024 * 1024;
}
