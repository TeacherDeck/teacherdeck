// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { strFromU8, strToU8, unzipSync, Zip, ZipDeflate } from "fflate";
import { assertMemoryBudget, EditorError, LIMITS, managedDocumentBytes, validateDocument } from "../core/model.ts";
import type { EditorDocument, Layer } from "../core/model.ts";
import { checkBytes, checkDimensions, MAX_INPUT_BYTES, MAX_METADATA_BYTES, MAX_LAYERS } from "./limits.ts";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PROJECT");
  return value as ObjectValue;
};
const number = (value: unknown, min: number, max: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error("INVALID_PROJECT");
  return value;
};
const text = (value: unknown, max: number): string => {
  if (typeof value !== "string" || value.length > max) throw new Error("INVALID_PROJECT");
  return value;
};
const bool = (value: unknown): boolean => {
  if (typeof value !== "boolean") throw new Error("INVALID_PROJECT");
  return value;
};
function color(value: unknown): void {
  if (!Array.isArray(value) || value.length !== 4) throw new Error("INVALID_PROJECT");
  value.forEach((part) => number(part, 0, 255));
}
function adjustments(value: unknown): void {
  const a = object(value);
  number(a["brightness"], -1, 1);
  number(a["contrast"], -1, 1);
  const levels = object(a["levels"]),
    curves = object(a["curves"]);
  for (const channel of ["rgb", "r", "g", "b"]) {
    const level = object(levels[channel]);
    const black = number(level["black"], 0, 255),
      white = number(level["white"], 0, 255);
    if (black >= white) throw new Error("INVALID_PROJECT");
    number(level["gamma"], 0.1, 10);
    number(level["outputBlack"], 0, 255);
    number(level["outputWhite"], 0, 255);
    const points = curves[channel];
    if (!Array.isArray(points) || points.length < 2 || points.length > 16) throw new Error("INVALID_PROJECT");
    let previous = -1;
    for (const point of points) {
      const p = object(point),
        x = number(p["x"], 0, 255);
      number(p["y"], 0, 255);
      if (x <= previous) throw new Error("INVALID_PROJECT");
      previous = x;
    }
  }
}
function validateLayer(value: unknown): ObjectValue {
  const l = object(value);
  text(l["id"], 128);
  text(l["name"], 200);
  bool(l["visible"]);
  bool(l["locked"]);
  number(l["opacity"], 0, 1);
  if (!["normal", "multiply", "screen"].includes(String(l["blend"]))) throw new Error("INVALID_PROJECT");
  const transform = object(l["transform"]);
  number(transform["x"], -100_000, 100_000);
  number(transform["y"], -100_000, 100_000);
  for (const axis of ["scaleX", "scaleY"]) {
    const scale = number(transform[axis], -LIMITS.maxScale, LIMITS.maxScale);
    if (Math.abs(scale) < LIMITS.minScale) throw new Error("INVALID_PROJECT");
  }
  number(transform["rotation"], -360_000, 360_000);
  if (transform["shear"] !== undefined) number(transform["shear"], -100, 100);
  if (l["kind"] === "pixel") {
    const pixels = object(l["pixels"]);
    checkDimensions(number(pixels["width"], 1, 10_000), number(pixels["height"], 1, 10_000));
    adjustments(l["adjustments"]);
  } else if (l["kind"] === "text") {
    const descriptor = object(l["text"]);
    text(descriptor["content"], LIMITS.maxTextLength);
    text(descriptor["fontFamily"], 200);
    number(descriptor["fontSize"], 1, 1_000);
    number(descriptor["lineHeight"], 0.5, 5);
    checkDimensions(number(descriptor["width"], 1, 10_000), number(descriptor["height"], 1, 10_000));
    color(descriptor["color"]);
    bool(descriptor["bold"]);
    bool(descriptor["italic"]);
    if (!["left", "center", "right"].includes(String(descriptor["align"]))) throw new Error("INVALID_PROJECT");
  } else if (l["kind"] === "shape") {
    const descriptor = object(l["shape"]);
    if (!["rectangle", "arrow"].includes(String(descriptor["type"]))) throw new Error("INVALID_PROJECT");
    checkDimensions(number(descriptor["width"], 1, 10_000), number(descriptor["height"], 1, 10_000));
    color(descriptor["color"]);
    number(descriptor["strokeWidth"], 1, 1_000);
  } else throw new Error("INVALID_PROJECT");
  return l;
}

/** Check central-directory sizes before fflate allocates any decompressed entry. No filesystem extraction. */
export function inspectProjectZip(bytes: Uint8Array): Map<string, { size: number; crc: number }> {
  if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error("INPUT_LIMIT");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) {
    if (v.getUint32(at, true) === 0x06054b50 && at + 22 + v.getUint16(at + 20, true) === bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0 || v.getUint16(end + 4, true) !== 0 || v.getUint16(end + 6, true) !== 0)
    throw new Error("INVALID_PROJECT");
  const count = v.getUint16(end + 10, true),
    size = v.getUint32(end + 12, true),
    start = v.getUint32(end + 16, true);
  if (count < 1 || count > 1 + MAX_LAYERS * 2 || count !== v.getUint16(end + 8, true) || start + size !== end)
    throw new Error("INVALID_PROJECT");
  let at = start,
    total = 0;
  const entries = new Map<string, { size: number; crc: number }>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || v.getUint32(at, true) !== 0x02014b50) throw new Error("INVALID_PROJECT");
    const flags = v.getUint16(at + 8, true),
      method = v.getUint16(at + 10, true);
    const packed = v.getUint32(at + 20, true),
      unpacked = v.getUint32(at + 24, true);
    const nameSize = v.getUint16(at + 28, true),
      extra = v.getUint16(at + 30, true),
      comment = v.getUint16(at + 32, true);
    const localAt = v.getUint32(at + 42, true);
    if (flags & 1 || ![0, 8].includes(method) || at + 46 + nameSize + extra + comment > end || localAt + 30 > start)
      throw new Error("INVALID_PROJECT");
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameSize));
    if (
      !/^(document\.json|pixels\/(?:[0-9]|1[0-5])\.rgba|masks\/(?:[0-9]|1[0-5])\.gray)$/.test(name) ||
      entries.has(name)
    )
      throw new Error("INVALID_PROJECT");
    if (name === "document.json" && unpacked > MAX_METADATA_BYTES) throw new Error("MEMORY_LIMIT");
    if (
      v.getUint32(localAt, true) !== 0x04034b50 ||
      v.getUint16(localAt + 8, true) !== method ||
      v.getUint16(localAt + 6, true) !== flags
    )
      throw new Error("INVALID_PROJECT");
    const localNameSize = v.getUint16(localAt + 26, true),
      localExtra = v.getUint16(localAt + 28, true);
    const payload = localAt + 30 + localNameSize + localExtra;
    if (payload + packed > start || strFromU8(bytes.subarray(localAt + 30, localAt + 30 + localNameSize)) !== name)
      throw new Error("INVALID_PROJECT");
    total += unpacked;
    checkBytes(total);
    entries.set(name, { size: unpacked, crc: v.getUint32(at + 16, true) });
    at += 46 + nameSize + extra + comment;
  }
  if (at !== end || !entries.has("document.json")) throw new Error("INVALID_PROJECT");
  return entries;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

export function decodeProject(bytes: Uint8Array): EditorDocument {
  const expected = inspectProjectZip(bytes);
  const files = unzipSync(bytes);
  for (const [name, entry] of expected) {
    const data = files[name];
    if (!data || data.length !== entry.size || crc32(data) !== entry.crc) throw new Error("INVALID_PROJECT");
  }
  const metadata = files["document.json"];
  if (!metadata) throw new Error("INVALID_PROJECT");
  const manifest = object(JSON.parse(strFromU8(metadata)) as unknown);
  if (manifest["format"] !== "teacherdeck-image" || manifest["version"] !== 1) throw new Error("INVALID_PROJECT");
  const width = number(manifest["width"], 1, 10_000),
    height = number(manifest["height"], 1, 10_000);
  checkDimensions(width, height);
  const source = manifest["layers"];
  if (!Array.isArray(source) || source.length > MAX_LAYERS) throw new Error("LAYER_LIMIT");
  const ids = new Set<string>(),
    used = new Set(["document.json"]);
  let managed = width * height * 4;
  const layers = source.map((value, index): Layer => {
    const l = validateLayer(value);
    const id = l["id"] as string;
    if (!id || ids.has(id)) throw new Error("INVALID_PROJECT");
    ids.add(id);
    if (l["kind"] === "pixel") {
      const pixelInfo = object(l["pixels"]),
        w = pixelInfo["width"] as number,
        h = pixelInfo["height"] as number;
      const plane = `pixels/${index}.rgba`,
        data = files[plane];
      if (!data || data.length !== w * h * 4 || pixelInfo["entry"] !== plane) throw new Error("INVALID_PROJECT");
      used.add(plane);
      managed += data.length;
      const maskEntry = l["mask"];
      let mask: Uint8Array | null = null;
      if (maskEntry !== null) {
        const key = `masks/${index}.gray`;
        const data = files[key];
        if (maskEntry !== key || !data || data.length !== w * h) throw new Error("INVALID_PROJECT");
        mask = data;
        managed += mask.length;
        used.add(key);
      }
      checkBytes(managed);
      return {
        ...l,
        pixels: { width: w, height: h, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) },
        mask,
      } as unknown as Layer;
    }
    return l as unknown as Layer;
  });
  if (used.size !== expected.size) throw new Error("INVALID_PROJECT");
  const document: EditorDocument = { version: 1, width, height, layers, selection: null, revision: 0 };
  validateDocument(document);
  assertMemoryBudget(document, bytes.length + MAX_METADATA_BYTES);
  return document;
}

/** Shared serialization keeps validation, size reservations and streamed output in agreement. */
function projectFiles(document: EditorDocument): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  let managed = document.width * document.height * 4;
  const layers = document.layers.map((layer, index) => {
    validateLayer(layer);
    if (layer.kind !== "pixel") return layer;
    const plane = `pixels/${index}.rgba`;
    const { width, height, data } = layer.pixels;
    if (data.length !== width * height * 4 || (layer.mask && layer.mask.length !== width * height))
      throw new Error("INVALID_PROJECT");
    files[plane] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    managed += data.length + (layer.mask?.length ?? 0);
    checkBytes(managed);
    const maskEntry = layer.mask ? `masks/${index}.gray` : null;
    if (maskEntry && layer.mask) files[maskEntry] = layer.mask;
    return { ...layer, pixels: { width, height, entry: plane }, mask: maskEntry };
  });
  files["document.json"] = strToU8(
    JSON.stringify({ format: "teacherdeck-image", version: 1, width: document.width, height: document.height, layers }),
  );
  checkBytes(files["document.json"].length, MAX_METADATA_BYTES);
  return files;
}
const ZIP_CHUNK_BYTES = 64 * 1024;
const ZIP_WORKSPACE_BYTES = 8 * 1024 * 1024;
function projectOutputBound(document: EditorDocument): { bound: number; metadataBytes: number; payload: number } {
  const layers = document.layers.map((layer, index) => {
    validateLayer(layer);
    return layer.kind === "pixel"
      ? {
          ...layer,
          pixels: { width: layer.pixels.width, height: layer.pixels.height, entry: `pixels/${index}.rgba` },
          mask: layer.mask ? `masks/${index}.gray` : null,
        }
      : layer;
  });
  const metadata = JSON.stringify({
    format: "teacherdeck-image",
    version: 1,
    width: document.width,
    height: document.height,
    layers,
  });
  const metadataBytes = strToU8(metadata).length;
  checkBytes(metadataBytes, MAX_METADATA_BYTES);
  const planes = document.layers.flatMap((layer) =>
    layer.kind === "pixel" ? [layer.pixels.data.byteLength, layer.mask?.byteLength ?? 0] : [],
  );
  const payload = metadataBytes + planes.reduce((sum, size) => sum + size, 0);
  // Deflate's stored-block upper bound plus ZIP headers keeps incompressible data in the reservation.
  const bound = payload + Math.ceil(payload / 7_000) * 5 + (planes.length + 1) * 256;
  return { bound, metadataBytes, payload };
}
/** Sequential 64KiB compression retains output chunks, one final Blob/archive and bounded deflate workspace. */
export function projectEncodingScratch(document: EditorDocument): number {
  const { bound, metadataBytes } = projectOutputBound(document);
  return bound * 2 + metadataBytes * 4 + ZIP_WORKSPACE_BYTES;
}
/** Reserve an editable project save before admitting an import or a new history state. */
export function projectSaveHeadroom(document: EditorDocument): number {
  const { bound, metadataBytes, payload } = projectOutputBound(document);
  // Even incompressible pixels must produce a file that this module can reopen.
  const reopenBytes = bound * 2 + payload + metadataBytes * 3 + document.width * document.height * 4;
  if (bound > MAX_INPUT_BYTES || reopenBytes > LIMITS.managedBytes)
    throw new EditorError("memory", "작업 파일을 안전하게 저장할 크기를 넘어요. 이미지나 레이어 크기를 줄여주세요.");
  const scale = Math.min(1, 1400 / Math.max(document.width, document.height));
  const visibleBytes = Math.ceil(document.width * scale) * Math.ceil(document.height * scale) * 12;
  return managedDocumentBytes({ ...document, selection: null }) + projectEncodingScratch(document) + visibleBytes;
}
function streamProject(document: EditorDocument, accept: (chunk: Uint8Array) => void): void {
  validateDocument(document);
  assertMemoryBudget(document, projectEncodingScratch(document));
  let size = 0;
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    size += chunk.length;
    checkBytes(size, MAX_INPUT_BYTES);
    accept(chunk);
  });
  for (const [name, bytes] of Object.entries(projectFiles(document))) {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    for (let at = 0; at < bytes.length; at += ZIP_CHUNK_BYTES)
      entry.push(bytes.subarray(at, at + ZIP_CHUNK_BYTES), at + ZIP_CHUNK_BYTES >= bytes.length);
  }
  zip.end();
}
export function encodeProjectBlob(document: EditorDocument): Blob {
  const chunks: Blob[] = [];
  streamProject(document, (chunk) => chunks.push(new Blob([Uint8Array.from(chunk)])));
  return new Blob(chunks, { type: "application/vnd.teacherdeck.image" });
}
export function encodeProject(document: EditorDocument): Uint8Array {
  const chunks: Uint8Array[] = [];
  streamProject(document, (chunk) => chunks.push(chunk));
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    result.set(chunk, at);
    at += chunk.length;
  }
  return result;
}
