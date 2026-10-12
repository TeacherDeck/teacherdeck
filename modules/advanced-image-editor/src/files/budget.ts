// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { strFromU8, unzipSync } from "fflate";
import { imageHeader } from "./header.ts";
import { inspectProjectZip } from "./project.ts";
import { checkBytes, checkDimensions, MAX_INPUT_BYTES, MAX_METADATA_BYTES, MAX_WORKING_BYTES } from "./limits.ts";
import type { ImportOptions } from "./psd.ts";

/** Peak reservation for input and decode buffers, without allocating pixel planes. Does not include the live editor. */
export function inspectInputBudget(bytes: Uint8Array, options: ImportOptions = {}): number {
  checkBytes(bytes.length, MAX_INPUT_BYTES);
  if (!bytes.length) throw new Error("INVALID_FILE");
  // Structured cloning a typed-array slice clones its entire backing buffer, not only its visible bytes.
  const encoded = bytes.buffer.byteLength * 2 + (bytes.byteLength !== bytes.buffer.byteLength ? bytes.byteLength : 0);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = inspectProjectZip(bytes);
    const metadata = unzipSync(bytes, { filter: (entry) => entry.name === "document.json" })["document.json"];
    if (!metadata) throw new Error("INVALID_PROJECT");
    const manifest = JSON.parse(strFromU8(metadata)) as { width?: unknown; height?: unknown };
    if (typeof manifest.width !== "number" || typeof manifest.height !== "number") throw new Error("INVALID_PROJECT");
    const documentPixels = checkDimensions(manifest.width, manifest.height);
    const planes = [...entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    return encoded + planes + metadata.length * 3 + documentPixels * 4;
  }
  if (bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53) {
    if (bytes.length < 30) throw new Error("INVALID_PSD");
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint16(4) !== 1 || v.getUint16(22) !== 8 || v.getUint16(24) !== 3) return encoded + MAX_METADATA_BYTES;
    const documentPixels = checkDimensions(v.getUint32(18), v.getUint32(14));
    const endSection = (start: number, limit = bytes.length): number => {
      if (start + 4 > limit) throw new Error("INVALID_PSD");
      const end = start + 4 + v.getUint32(start);
      if (end > limit) throw new Error("INVALID_PSD");
      return end;
    };
    const colorEnd = endSection(26),
      resourcesEnd = endSection(colorEnd),
      layersEnd = endSection(resourcesEnd);
    let metadataBytes = resourcesEnd - 26,
      decodedPlanes = 0;
    checkBytes(metadataBytes, MAX_METADATA_BYTES);
    if (resourcesEnd + 4 < layersEnd) {
      const infoStart = resourcesEnd + 4,
        infoEnd = endSection(infoStart, layersEnd);
      let at = infoStart + 4;
      if (at + 2 <= infoEnd) {
        const count = Math.abs(v.getInt16(at));
        at += 2;
        if (count > 2_048) throw new Error("LAYER_LIMIT");
        for (let i = 0; i < count; i++) {
          if (at + 18 > infoEnd) throw new Error("INVALID_PSD");
          const width = v.getInt32(at + 12) - v.getInt32(at + 4),
            height = v.getInt32(at + 8) - v.getInt32(at);
          if (width < 0 || height < 0) throw new Error("INVALID_PSD");
          if (width && height) {
            if (options.unsupported !== "composite") checkDimensions(width, height);
            decodedPlanes += width * height * 4;
          }
          const channelCount = v.getUint16(at + 16),
            extraAt = at + 18 + channelCount * 6 + 12;
          if (channelCount > 56 || extraAt + 4 > infoEnd) throw new Error("INVALID_PSD");
          const recordEnd = endSection(extraAt, infoEnd),
            maskAt = extraAt + 4;
          metadataBytes += recordEnd - at;
          checkBytes(metadataBytes, MAX_METADATA_BYTES);
          if (maskAt + 4 <= recordEnd && v.getUint32(maskAt) >= 18) {
            if (maskAt + 22 > recordEnd) throw new Error("INVALID_PSD");
            const maskWidth = v.getInt32(maskAt + 16) - v.getInt32(maskAt + 8),
              maskHeight = v.getInt32(maskAt + 12) - v.getInt32(maskAt + 4);
            if (maskWidth < 0 || maskHeight < 0) throw new Error("INVALID_PSD");
            if (maskWidth && maskHeight) {
              if (options.unsupported !== "composite") checkDimensions(maskWidth, maskHeight);
              decodedPlanes += maskWidth * maskHeight * 4 + width * height;
            }
          }
          at = recordEnd;
        }
      }
      // The layer bitmap payload is inside infoEnd; only the remaining global metadata is structural data.
      metadataBytes += layersEnd - infoEnd;
      checkBytes(metadataBytes, MAX_METADATA_BYTES);
    }
    return (
      encoded + metadataBytes * 3 + documentPixels * 12 + (options.unsupported === "composite" ? 0 : decodedPlanes * 2)
    );
  }
  const header = imageHeader(bytes);
  return encoded + header.width * header.height * 12;
}
export function requireInputBudget(bytes: Uint8Array, options: ImportOptions = {}): number {
  const required = inspectInputBudget(bytes, options);
  const reserved = options.reservedBytes ?? 0;
  if (!Number.isSafeInteger(reserved) || reserved < 0) throw new Error("MEMORY_LIMIT");
  checkBytes(required + reserved, MAX_WORKING_BYTES);
  return required;
}
