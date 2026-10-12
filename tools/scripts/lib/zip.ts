// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Minimal read-only ZIP reader for pinned archives (wheels). Stored and deflate entries only.
import zlib from "node:zlib";

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Returns the bytes of the entry with exactly this name, or null when it is absent. */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== EOCD) end--;
  if (end < 0) throw new Error("ZIP 끝 레코드를 찾을 수 없어요.");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL) throw new Error("ZIP 중앙 디렉터리가 잘못됐어요.");
    const method = zip.readUInt16LE(at + 10);
    const compressed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      if (zip.readUInt32LE(local) !== LOCAL) throw new Error("ZIP 항목 머리가 잘못됐어요.");
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const raw = zip.subarray(start, start + compressed);
      const bytes = method === 0 ? Buffer.from(raw) : method === 8 ? zlib.inflateRawSync(raw) : null;
      if (bytes === null || bytes.length !== size) throw new Error("ZIP 항목을 읽을 수 없어요.");
      return bytes;
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}
