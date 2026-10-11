// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { getDocument, GlobalWorkerOptions, Util, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Extraction } from "./batch.ts";
import { DEFAULT_INSETS, studentIdentity, wordLines, type Insets, type Rect, type Word } from "./pdf-boxes.ts";
import type { Student } from "./roster.ts";
GlobalWorkerOptions.workerSrc = workerUrl;
type Detected = { box: Rect; crop: Rect | null; text: string };
async function validateSource(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error("CANCELLED");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./source-check.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error("CANCELLED"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("SOURCE_TIMEOUT"));
    }, 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ valid: boolean }>) => {
      finish();
      if (event.data.valid) resolve();
      else reject(new Error("INVALID_SOURCE"));
    };
    worker.onerror = () => {
      finish();
      reject(new Error("INVALID_SOURCE"));
    };
    const copy = bytes.slice();
    worker.postMessage(copy, [copy.buffer]);
  });
}
function analyze(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  words: Word[],
  insets: Insets,
  signal: AbortSignal,
): Promise<Detected[]> {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./pdf-boxes.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(new Error("CANCELLED"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("PAGE_TIMEOUT"));
    }, 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ items?: Detected[]; error?: string }>) => {
      finish();
      if (event.data.error || !event.data.items) reject(new Error("INVALID_PAGE"));
      else resolve(event.data.items);
    };
    worker.onerror = () => {
      finish();
      reject(new Error("INVALID_PAGE"));
    };
    worker.postMessage({ pixels, width, height, words, insets }, [pixels.buffer]);
  });
}
async function readableRotation(page: PDFPageProxy): Promise<number> {
  const viewport = page.getViewport({ scale: 1 });
  const text = await page.getTextContent();
  const votes = new Map<number, number>();
  for (const item of text.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const transform = Util.transform(viewport.transform, item.transform);
    const angle =
      (((Math.round((Math.atan2(transform[1] ?? 0, transform[0] ?? 1) * 180) / Math.PI / 90) * 90) % 360) + 360) % 360;
    votes.set(angle, (votes.get(angle) ?? 0) + item.str.trim().length);
  }
  const dominant = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return (((page.rotate - dominant) % 360) + 360) % 360;
}
export async function pageWords(page: PDFPageProxy, scale: number, rotation = page.rotate): Promise<Word[]> {
  const viewport = page.getViewport({ scale, rotation });
  const content = await page.getTextContent();
  const words: Word[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const transform = Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1] ?? 0, transform[0] ?? 1);
    const height = Math.hypot(transform[2] ?? 0, transform[3] ?? 1);
    const style = content.styles[item.fontName];
    const ascent = (style?.ascent ?? (style?.descent ? 1 + style.descent : 0.8)) * height;
    const originX = (transform[4] ?? 0) + Math.sin(angle) * ascent;
    const originY = (transform[5] ?? 0) - Math.cos(angle) * ascent;
    const w = item.width * viewport.scale * viewport.userUnit,
      dx = Math.cos(angle),
      dy = Math.sin(angle);
    const corners = [
      [originX, originY],
      [originX + dx * w, originY + dy * w],
      [originX - dy * height, originY + dx * height],
      [originX + dx * w - dy * height, originY + dy * w + dx * height],
    ];
    const xs = corners.map((point) => point[0] ?? 0),
      ys = corners.map((point) => point[1] ?? 0);
    words.push({
      text: item.str,
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
  }
  return words;
}
function png(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("IMAGE_ENCODE"));
      else
        void blob.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new Error("IMAGE_ENCODE")),
        );
    }, "image/png"),
  );
}
export async function extractPdf(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
  insets: Insets = DEFAULT_INSETS,
): Promise<Omit<Extraction, "file">> {
  await validateSource(bytes, signal);
  const assets = new URL("./pdf-assets/", document.baseURI).href;
  const loading = getDocument({
    data: bytes,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    disableFontFace: true,
    stopAtErrors: true,
    canvasMaxAreaInBytes: 96_000_000,
    maxImageSize: 24_000_000,
    verbosity: 0,
  });
  const abort = () => {
    void loading.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  const photos: Extraction["photos"] = [],
    students: Student[] = [],
    warnings: string[] = [];
  let retained = 0;
  try {
    if (signal.aborted) throw new Error("CANCELLED");
    const doc = await loading.promise;
    if (doc.numPages > 100) throw new Error("PAGE_LIMIT");
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (signal.aborted) throw new Error("CANCELLED");
      const page = await doc.getPage(pageNumber),
        scale = 200 / 72,
        rotation = await readableRotation(page),
        viewport = page.getViewport({ scale, rotation });
      const width = Math.ceil(viewport.width),
        height = Math.ceil(viewport.height);
      if (width * height > 24_000_000) throw new Error("PAGE_LIMIT");
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
        const rendering = page.render({ canvas, viewport });
        const cancelRender = () => rendering.cancel();
        signal.addEventListener("abort", cancelRender, { once: true });
        try {
          await rendering.promise;
        } finally {
          signal.removeEventListener("abort", cancelRender);
        }
        const words = await pageWords(page, scale, rotation);
        const header = wordLines(words.filter((word) => word.y + word.height < height * 0.2)).join(" ");
        const items = await analyze(ctx.getImageData(0, 0, width, height).data, width, height, words, insets, signal);
        if (!items.length) warnings.push(`${pageNumber}쪽에서 사진 상자를 찾지 못했어요. 원본 페이지를 확인해 주세요.`);
        if (!words.length)
          warnings.push(`${pageNumber}쪽은 읽을 수 있는 글자가 없어 사진 이름을 자동으로 연결하지 않아요.`);
        for (const [index, item] of items.entries()) {
          if (signal.aborted) throw new Error("CANCELLED");
          if (!item.crop) {
            // A partial replacement would silently discard earlier photos and manual edits.
            throw new Error("EMPTY_CROP");
          }
          const crop = document.createElement("canvas");
          crop.width = item.crop.width;
          crop.height = item.crop.height;
          try {
            const cropCtx = crop.getContext("2d");
            if (!cropCtx) throw new Error("CANVAS_UNAVAILABLE");
            cropCtx.drawImage(
              canvas,
              item.crop.x,
              item.crop.y,
              item.crop.width,
              item.crop.height,
              0,
              0,
              crop.width,
              crop.height,
            );
            const image = await png(crop);
            retained += image.length;
            if (retained > 128 * 1024 * 1024 || photos.length >= 2000) throw new Error("PHOTO_LIMIT");
            const key = `pdf:${pageNumber}:${index}`;
            photos.push({ key, bytes: image, extension: "png", mime: "image/png" });
            const identity = studentIdentity(item.text, header);
            if (identity)
              students.push({
                ...identity,
                row: index,
                col: 0,
                text: item.text,
                sheet: `${pageNumber}쪽`,
                photoKey: key,
                identityConfirmed: true,
              });
          } finally {
            crop.width = 0;
            crop.height = 0;
          }
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    // Repeated identities may be duplicate pages or different students: never silently overwrite or confirm.
    const identities = new Map<string, Student[]>();
    for (const student of students) {
      const key = `${student.grade}:${student.classNumber}:${student.number}`;
      identities.set(key, [...(identities.get(key) ?? []), student]);
    }
    for (const repeated of identities.values())
      if (repeated.length > 1)
        for (const student of repeated) {
          student.identityConfirmed = false;
          student.identityWarning = "같은 학번이 여러 번 나와요. 원본의 중복 페이지나 학생 정보를 확인해 주세요.";
        }
    const confirmed = students.filter((student) => student.identityConfirmed).length;
    if (photos.length > confirmed)
      warnings.push(`학생 정보를 확정하지 못한 사진 ${photos.length - confirmed}장도 미확인 이름으로 보존해요.`);
    warnings.push("PDF 사진은 원작과 같이 200 DPI로 꺼내요. XLSX 사진은 문서 안의 원본 바이트를 그대로 저장해요.");
    return { photos, students, warnings };
  } finally {
    signal.removeEventListener("abort", abort);
    await loading.destroy();
  }
}
