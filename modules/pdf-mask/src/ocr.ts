// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Input } from "./batch.ts";
import { renderPage } from "./pdf.ts";
import { ocrBoxes } from "./ocr-layout.ts";

export interface OcrSummary {
  read: number;
  empty: number;
  uncertain: number;
}
interface Reply {
  jobId?: string;
  status?: string;
  data?: unknown;
}

/** Pinned Tesseract 6.0.1 worker protocol; owning the worker permits abort during initialization. */
export class LocalOcr {
  private readonly worker: Worker;
  private serial = 0;
  private pending: {
    id: string;
    resolve(value: unknown): void;
    reject(reason: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private closed = false;
  private readonly signal: AbortSignal;
  private readonly base: string;
  constructor(signal: AbortSignal, base: string) {
    this.signal = signal;
    this.base = base;
    this.worker = new Worker(`${base}worker.min.js`);
    this.worker.onmessage = (event: MessageEvent<Reply>) => {
      const pending = this.pending;
      if (!pending || event.data.jobId !== pending.id || event.data.status === "progress") return;
      clearTimeout(pending.timer);
      this.pending = null;
      if (event.data.status === "resolve") pending.resolve(event.data.data);
      else pending.reject(new Error("OCR_FAILED"));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close("OCR_FAILED");
    };
    signal.addEventListener("abort", this.abort, { once: true });
    if (signal.aborted) this.close("CANCELLED");
  }
  private readonly abort = () => this.close("CANCELLED");
  private request(action: string, payload: unknown): Promise<unknown> {
    if (this.closed || this.signal.aborted) return Promise.reject(new Error("CANCELLED"));
    if (this.pending) return Promise.reject(new Error("OCR_BUSY"));
    return new Promise((resolve, reject) => {
      const id = `ocr-${++this.serial}`;
      const timer = setTimeout(() => this.close("OCR_TIMEOUT"), 90_000);
      this.pending = { id, resolve, reject, timer };
      try {
        this.worker.postMessage({ workerId: "local-ocr", jobId: id, action, payload });
      } catch {
        this.close("OCR_FAILED");
      }
    });
  }
  async initialize(): Promise<void> {
    await this.request("load", { options: { lstmOnly: true, corePath: this.base, logging: false } });
    await this.request("loadLanguage", {
      langs: ["kor", "eng"],
      options: {
        langPath: this.base.replace(/\/$/, ""),
        cacheMethod: "none",
        gzip: false,
        lstmOnly: true,
      },
    });
    await this.request("initialize", { langs: ["kor", "eng"], oem: 1, config: { user_defined_dpi: "150" } });
    await this.request("setParameters", { params: { tessedit_pageseg_mode: "11", user_defined_dpi: "150" } });
  }
  recognize(bytes: Uint8Array): Promise<unknown> {
    return this.request("recognize", { image: bytes, options: {}, output: { text: true, blocks: true } });
  }
  close(reason = "CANCELLED"): void {
    if (this.closed) return;
    this.closed = true;
    this.signal.removeEventListener("abort", this.abort);
    this.worker.terminate();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(reason));
      this.pending = null;
    }
  }
}

/** Return new pages only after the whole requested scan succeeds. Keep prior manual work on failure. */
export async function recognizePages(
  input: Input,
  numbers: readonly number[],
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<{ input: Input; summary: OcrSummary }> {
  const summary: OcrSummary = { read: 0, empty: 0, uncertain: 0 };
  if (!numbers.length) return { input, summary };
  const reader = new LocalOcr(signal, new URL("./ocr-assets/", document.baseURI).href);
  const pages = [...input.pages];
  try {
    await reader.initialize();
    for (const number of numbers) {
      if (signal.aborted) throw new Error("CANCELLED");
      const index = pages.findIndex((p) => p.number === number);
      const info = pages[index];
      if (!info) throw new Error("OCR_INVALID_PAGE");
      const page = await input.doc.getPage(number);
      try {
        const image = await renderPage(page, 150, [], signal);
        const result = await reader.recognize(new Uint8Array(await image.arrayBuffer()));
        const output = ocrBoxes(result, info, Math.ceil((info.width * 150) / 72), Math.ceil((info.height * 150) / 72));
        if (!output.boxes.length) summary.empty++;
        if (output.confidence < 70) summary.uncertain++;
        // Re-running OCR replaces its earlier boxes, retaining actual PDF text separately.
        const sourceBoxes = info.sourceBoxes ?? info.boxes;
        pages[index] = {
          ...info,
          sourceBoxes,
          boxes: [...sourceBoxes, ...output.boxes],
          ocr: output.boxes.length ? "read" : "empty",
          ocrConfidence: output.confidence,
        };
      } finally {
        page.cleanup();
      }
      summary.read++;
      progress(summary.read, numbers.length);
    }
    if (signal.aborted) throw new Error("CANCELLED");
    return { input: { ...input, pages }, summary };
  } finally {
    reader.close();
  }
}
