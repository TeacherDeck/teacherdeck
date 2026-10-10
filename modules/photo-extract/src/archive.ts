// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Unzip, UnzipInflate } from "fflate";
export const MAX_INPUT = 32 * 1024 * 1024;
export const MAX_OUTPUT = 128 * 1024 * 1024;
export type Parts = Record<string, Uint8Array<ArrayBuffer>>;
export function validPartPath(path: string): boolean {
  return (
    path.length <= 240 &&
    !/[\\:%?#]/.test(path) &&
    !Array.from(path).some((char) => char.charCodeAt(0) < 32) &&
    !path.startsWith("/") &&
    path.split("/").every((p, i, all) => p !== ".." && p !== "." && (p !== "" || i === all.length - 1))
  );
}
/** Decode in small compressed chunks; count actual output, including ignored package parts. */
export function unzipLimited(bytes: Uint8Array, limit = MAX_OUTPUT): Parts {
  if (bytes.length > MAX_INPUT || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("INVALID_ARCHIVE");
  const parts: Parts = Object.create(null) as Parts;
  const seen = new Set<string>();
  let output = 0;
  let files = 0;
  let complete = 0;
  const unzip = new Unzip((file) => {
    if (!validPartPath(file.name) || seen.has(file.name) || ++files > 4096 || (file.originalSize ?? 0) > limit)
      throw new Error("INVALID_ARCHIVE");
    seen.add(file.name);
    if (file.compression !== 0 && file.compression !== 8) throw new Error("INVALID_ARCHIVE");
    const wanted =
      file.name.startsWith("xl/") &&
      (file.name.endsWith(".xml") || file.name.endsWith(".rels") || file.name.startsWith("xl/media/"));
    let size = 0;
    const chunks: Uint8Array[] = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error("INVALID_ARCHIVE");
      output += chunk.length;
      size += chunk.length;
      if (
        output > limit ||
        (wanted && /\.(xml|rels)$/.test(file.name) && size > 4 * 1024 * 1024) ||
        (file.name.startsWith("xl/media/") && size > 16 * 1024 * 1024)
      ) {
        file.terminate();
        throw new Error("ARCHIVE_LIMIT");
      }
      if (wanted) chunks.push(chunk);
      if (final) {
        complete++;
        if (wanted) {
          const data = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            data.set(c, offset);
            offset += c.length;
          }
          parts[file.name] = data;
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let at = 0; at < bytes.length; at += 4096) unzip.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length);
  if (!files || complete !== files) throw new Error("INVALID_ARCHIVE");
  return parts;
}
