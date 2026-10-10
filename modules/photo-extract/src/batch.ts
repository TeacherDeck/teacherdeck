// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, FileHandleInfo, FolderHandleInfo } from "@deck/sdk";
import { MAX_INPUT, type Parts } from "./archive.ts";
import { parseParts, type Parsed, type Photo, type Sheet } from "./ooxml.ts";
import type { Student } from "./roster.ts";
export interface Extraction {
  file: FileHandleInfo;
  students: Student[];
  photos: Photo[];
  warnings: string[];
}
export interface PlannedPhoto extends Photo {
  id: string;
  filename: string;
  label: string;
  confirmed: boolean;
}
export function safeBase(value: string): string {
  const clean = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "_" : char))
    .join("")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
  return !clean || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean) ? `_${clean || "사진"}` : clean;
}
export function planPhotos(extractions: Extraction[], renamed: Record<string, string> = {}): PlannedPhoto[] {
  const occupied = new Set<string>();
  const result: PlannedPhoto[] = [];
  for (const extraction of extractions)
    for (const [index, photo] of extraction.photos.entries()) {
      const id = `${extraction.file.handle}:${photo.key}`;
      const matchedStudents = extraction.students.filter((s) => s.photoKey === photo.key);
      const student = matchedStudents.length === 1 ? matchedStudents[0] : undefined;
      const suggested = extraction.students.find((s) => s.suggestionKey === photo.key);
      const base = safeBase(
        renamed[id] ??
          (student
            ? `${student.grade}${String(student.classNumber).padStart(2, "0")}${String(student.number).padStart(2, "0")}_${student.name}`
            : `미확인_${String(index + 1).padStart(3, "0")}`),
      );
      let name = `${base}.${photo.extension}`;
      let suffix = 2;
      while (occupied.has(name.toLocaleLowerCase("en-US"))) name = `${base}_${suffix++}.${photo.extension}`;
      occupied.add(name.toLocaleLowerCase("en-US"));
      result.push({
        ...photo,
        id,
        filename: name,
        confirmed: Boolean(student),
        label: student
          ? `${student.grade}학년 ${student.classNumber}반 ${student.number}번 ${student.name}`
          : suggested
            ? `추측: ${suggested.grade}학년 ${suggested.classNumber}반 ${suggested.number}번 ${suggested.name} · 이름을 확인해 주세요`
            : matchedStudents.length > 1
              ? "여러 학생 칸에 연결된 사진 · 직접 확인해 주세요"
              : "주인 미확인 사진",
      });
    }
  return result;
}
function workerRequest<T>(request: unknown, transfer: Transferable[], signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error("CANCELLED"));
    };
    const timeout = setTimeout(() => {
      finish();
      reject(new Error("TIMEOUT"));
    }, 90000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<T & { error?: string }>) => {
      finish();
      if (event.data.error) reject(new Error("INVALID_ARCHIVE"));
      else resolve(event.data);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("INVALID_ARCHIVE"));
    };
    worker.postMessage(request, transfer);
  });
}
export type Decoder = (bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) => Promise<Parts>;
export const decodeArchive: Decoder = async (bytes, signal) =>
  (await workerRequest<{ parts: Parts }>({ kind: "unzip", bytes }, [bytes.buffer], signal)).parts;
export type Matcher = (sheets: Sheet[], signal: AbortSignal) => Promise<{ students: Student[]; warnings: string[] }>;
export const matchInWorker: Matcher = async (sheets, signal) =>
  await workerRequest<{ students: Student[]; warnings: string[] }>({ kind: "match", sheets }, [], signal);
export async function readExtraction(
  deck: Pick<Deck, "fs">,
  file: FileHandleInfo,
  signal: AbortSignal,
  decode: Decoder = decodeArchive,
  match: Matcher = matchInWorker,
): Promise<Extraction> {
  if (file.size > MAX_INPUT) throw new Error("INPUT_LIMIT");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of deck.fs.readChunks({ handle: file.handle }, { signal })) {
    if (signal.aborted) throw new Error("CANCELLED");
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("INPUT_LIMIT");
    chunks.push(chunk);
  }
  if (signal.aborted) throw new Error("CANCELLED");
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  const parts = await decode(bytes, signal);
  const parsed: Parsed = await parseParts(parts, signal, true);
  const matched = await match(parsed.sheets, signal);
  const students = matched.students;
  const confirmed = students.filter((s) => s.photoKey).length;
  const guessed = students.filter((s) => s.suggestionKey).length;
  const missing = students.filter((s) => !s.photoKey && !s.suggestionKey).length;
  const warnings = [...parsed.warnings, ...matched.warnings];
  if (guessed) warnings.push(`${guessed}장` + "은 위치로 추측했어요. 미확인 이름으로 저장하고 직접 확인해 주세요.");
  if (missing) warnings.push(`사진을 찾지 못한 학생 ${missing}명을 명단에 유지해요.`);
  if (!students.length)
    warnings.push("학생 정보를 찾지 못했어요. 문서 안의 사진은 모두 미확인 사진으로 저장할 수 있어요.");
  if (parsed.photos.length > confirmed + guessed)
    warnings.push(`주인을 찾지 못한 사진 ${parsed.photos.length - confirmed - guessed}장도 저장해요.`);
  return { file, students, photos: parsed.photos, warnings };
}
export interface SaveResult {
  folder: FolderHandleInfo;
  saved: string[];
  failed: string[];
  cancelled: boolean;
}
export async function savePhotos(
  deck: Pick<Deck, "fs">,
  photos: PlannedPhoto[],
  signal: AbortSignal,
  progress: (done: number) => void = () => undefined,
): Promise<SaveResult | null> {
  if (signal.aborted || !photos.length) return null;
  const parent = await deck.fs.pickFolder();
  if (!parent || signal.aborted) return null;
  const batch = await deck.fs.createOutputFolder({ parentHandle: parent.handle, suggestedName: "명렬표 사진" });
  const saved: string[] = [],
    failed: string[] = [];
  try {
    for (const photo of photos) {
      if (signal.aborted) break;
      try {
        await deck.fs.writeBlob(
          {
            batchId: batch.batchId,
            suggestedName: photo.filename,
            blob: new Blob([photo.bytes], { type: photo.mime }),
          },
          { signal },
        );
        saved.push(photo.id);
      } catch {
        if (!signal.aborted) failed.push(photo.id);
      }
      progress(saved.length + failed.length);
    }
  } finally {
    await deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
  return { folder: batch.folder, saved, failed, cancelled: signal.aborted };
}
