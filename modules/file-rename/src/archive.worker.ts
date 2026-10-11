// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Inflate, Unzip, UnzipInflate } from "fflate";
const worker = self as unknown as {
  onmessage: (event: MessageEvent<{ bytes: Uint8Array; kind: "zip" | "hwp" }>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
export function unpack(bytes: Uint8Array): Record<string, Uint8Array> {
  if (bytes.length > 32 * 1024 * 1024) throw new Error("INPUT_LIMIT");
  const parts: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let total = 0;
  let files = 0;
  let ended = 0;
  const seen = new Set<string>();
  const zip = new Unzip((file) => {
    if (
      ++files > 4096 ||
      seen.has(file.name) ||
      file.name.startsWith("/") ||
      /[\\:%?#]/.test(file.name) ||
      file.name.split("/").some((p) => p === ".." || p === ".")
    )
      throw new Error("ARCHIVE_LIMIT");
    seen.add(file.name);
    if (file.compression !== 0 && file.compression !== 8) throw new Error("ARCHIVE_LIMIT");
    const wanted = /^(?:xl\/.*\.(?:xml|rels)|Contents\/section\d+\.xml)$/.test(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error("INVALID_ARCHIVE");
      total += chunk.length;
      length += chunk.length;
      if (total > 64 * 1024 * 1024 || (wanted && length > 4 * 1024 * 1024)) {
        file.terminate();
        throw new Error("ARCHIVE_LIMIT");
      }
      if (wanted) chunks.push(chunk);
      if (final) {
        ended++;
        if (wanted) {
          const data = new Uint8Array(length);
          let at = 0;
          for (const part of chunks) {
            data.set(part, at);
            at += part.length;
          }
          parts[file.name] = data;
        }
      }
    };
    file.start();
  });
  zip.register(UnzipInflate);
  for (let at = 0; at < bytes.length; at += 4096) zip.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length);
  if (!files || files !== ended) throw new Error("INVALID_ARCHIVE");
  return parts;
}
function inflateBounded(bytes: Uint8Array): Uint8Array {
  let size = 0;
  const chunks: Uint8Array[] = [];
  const stream = new Inflate((chunk) => {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("DOCUMENT_LIMIT");
    chunks.push(chunk);
  });
  for (let at = 0; at < bytes.length; at += 4096) stream.push(bytes.subarray(at, at + 4096), at + 4096 >= bytes.length);
  const output = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}
/** HWP5 Compound File body text; encrypted/distribution and cyclic chains are rejected. */
export function hwpText(bytes: Uint8Array): string {
  if (
    bytes.length < 512 ||
    bytes.length > 32 * 1024 * 1024 ||
    Array.from(bytes.subarray(0, 8)).join(",") !== "208,207,17,224,161,177,26,225"
  )
    throw new Error("INVALID_HWP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(26, true);
  const sector = 2 ** view.getUint16(30, true);
  const mini = 2 ** view.getUint16(32, true);
  if (
    !((major === 3 && sector === 512) || (major === 4 && sector === 4096)) ||
    mini !== 64 ||
    view.getUint32(56, true) !== 4096 ||
    view.getUint16(28, true) !== 0xfffe
  )
    throw new Error("INVALID_HWP");
  const end = 0xfffffffe;
  const free = 0xffffffff;
  const max = Math.floor(bytes.length / sector) - 1;
  const block = (id: number) => {
    if (id < 0 || id >= max) throw new Error("INVALID_HWP");
    return bytes.subarray((id + 1) * sector, (id + 2) * sector);
  };
  const words = (part: Uint8Array) => {
    const v = new DataView(part.buffer, part.byteOffset, part.length);
    return Array.from({ length: part.length / 4 }, (_, i) => v.getUint32(i * 4, true));
  };
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = view.getUint32(76 + i * 4, true);
    if (id !== free) difat.push(id);
  }
  let next = view.getUint32(68, true);
  const difatSeen = new Set<number>();
  const extra = view.getUint32(72, true);
  if (extra > 256) throw new Error("INVALID_HWP");
  for (let i = 0; i < extra; i++) {
    if (difatSeen.has(next)) throw new Error("INVALID_HWP");
    difatSeen.add(next);
    const ids = words(block(next));
    next = ids.pop() ?? end;
    difat.push(...ids.filter((id) => id !== free));
  }
  const fatCount = view.getUint32(44, true);
  if (!fatCount || fatCount > 16384 || difat.length !== fatCount || new Set(difat).size !== difat.length)
    throw new Error("INVALID_HWP");
  const fat = difat.flatMap((id) => words(block(id)));
  const chain = (start: number, table: number[], read: (id: number) => Uint8Array, size?: number) => {
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let id = start;
    let length = 0;
    while (id !== end && id !== free) {
      if (seen.has(id) || seen.size > 65536 || id >= table.length) throw new Error("INVALID_HWP");
      seen.add(id);
      const chunk = read(id);
      length += chunk.length;
      if (length > 64 * 1024 * 1024) throw new Error("DOCUMENT_LIMIT");
      chunks.push(chunk);
      id = table[id] ?? end;
    }
    if (size !== undefined && (size > length || (length > size && length - size >= (chunks.at(-1)?.length ?? sector))))
      throw new Error("INVALID_HWP");
    const all = new Uint8Array(size ?? length);
    let at = 0;
    for (const chunk of chunks) {
      const take = chunk.subarray(0, all.length - at);
      all.set(take, at);
      at += take.length;
    }
    return all;
  };
  const directories = chain(view.getUint32(48, true), fat, block);
  const records: { name: string; type: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= directories.length; at += 128) {
    const d = new DataView(directories.buffer, directories.byteOffset + at, 128);
    const nameLength = d.getUint16(64, true);
    const type = d.getUint8(66);
    if (!type) continue;
    if (nameLength < 2 || nameLength > 64 || nameLength % 2) throw new Error("INVALID_HWP");
    const name = new TextDecoder("utf-16le").decode(directories.subarray(at, at + nameLength - 2));
    const size = Number(d.getBigUint64(120, true));
    if (!Number.isSafeInteger(size) || size > 32 * 1024 * 1024) throw new Error("DOCUMENT_LIMIT");
    records.push({ name, type, start: d.getUint32(116, true), size });
  }
  const root = records.find((r) => r.type === 5);
  if (!root) throw new Error("INVALID_HWP");
  const miniStream = chain(root.start, fat, block, root.size);
  const miniCount = view.getUint32(64, true);
  if (miniCount > 16384) throw new Error("INVALID_HWP");
  const miniFat = miniCount ? words(chain(view.getUint32(60, true), fat, block, miniCount * sector)) : [];
  const read = (record: { start: number; size: number }) =>
    record.size < view.getUint32(56, true)
      ? chain(
          record.start,
          miniFat,
          (id) => {
            if ((id + 1) * mini > miniStream.length) throw new Error("INVALID_HWP");
            return miniStream.subarray(id * mini, (id + 1) * mini);
          },
          record.size,
        )
      : chain(record.start, fat, block, record.size);
  const header = records.find((r) => r.name === "FileHeader" && r.type === 2);
  if (!header) throw new Error("INVALID_HWP");
  const headerBytes = read(header);
  if (headerBytes.length < 40 || !new TextDecoder().decode(headerBytes.subarray(0, 17)).startsWith("HWP Document File"))
    throw new Error("INVALID_HWP");
  const flags = new DataView(headerBytes.buffer).getUint32(36, true);
  if (flags & (2 | 4 | 16)) throw new Error("PROTECTED_HWP");
  const sections = records
    .filter((r) => r.type === 2 && /^Section\d+$/.test(r.name))
    .sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7)));
  if (!sections.length) throw new Error("NO_DOCUMENT_TEXT");
  let text = "";
  for (const section of sections.slice(0, 4)) {
    const source = read(section);
    const data = flags & 1 ? inflateBounded(source) : source;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 0;
    while (at + 4 <= data.length) {
      const record = v.getUint32(at, true);
      at += 4;
      const tag = record & 0x3ff;
      let size = record >>> 20;
      if (size === 0xfff) {
        if (at + 4 > data.length) throw new Error("INVALID_HWP");
        size = v.getUint32(at, true);
        at += 4;
      }
      if (at + size > data.length) throw new Error("INVALID_HWP");
      if (tag === 67) {
        let line = "";
        for (let pos = at; pos + 2 <= at + size; pos += 2) {
          const code = v.getUint16(pos, true);
          if (code === 10 || code === 13) line += "\n";
          else if (code === 9) line += " ";
          else if (code >= 32) line += String.fromCharCode(code);
          else if ([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23].includes(code)) pos += 14;
        }
        text += line + "\n";
      }
      at += size;
      if (text.length > 4000) return text.slice(0, 4000);
    }
  }
  return text;
}
worker.onmessage = (event: MessageEvent<{ bytes: Uint8Array; kind: "zip" | "hwp" }>) => {
  try {
    if (event.data.kind === "hwp") worker.postMessage({ text: hwpText(event.data.bytes) });
    else {
      const parts = unpack(event.data.bytes);
      worker.postMessage(
        { parts },
        Object.values(parts).map((part) => part.buffer as ArrayBuffer),
      );
    }
  } catch {
    worker.postMessage({ error: "문서를 분석하지 못했어요. 보호 여부와 형식을 확인하고 값을 직접 입력해 주세요." });
  }
};
