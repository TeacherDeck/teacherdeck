// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

export interface SourceCheckRequest {
  bytes: Uint8Array<ArrayBuffer>;
  maxPixels: number;
}
export type SourceCheckResponse = { ok: true } | { ok: false; code: "SOURCE_IMAGE_TOO_LARGE" | "INVALID_PDF" };

/** MOD-014: parsing compressed PDF objects belongs in a disposable local Worker. */
export function checkSourceImagesInWorker(bytes: Uint8Array, maxPixels: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("CANCELLED"));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./source-check.worker.ts", import.meta.url), { type: "module" });
    } catch {
      reject(new Error(signal.aborted ? "CANCELLED" : "PDF_CHECK_FAILED"));
      return;
    }
    let settled = false;
    let copy: Uint8Array<ArrayBuffer> | undefined;
    const finish = (code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      // A failed transfer can leave a live copy on this side; successful transfers detach it.
      if (copy?.byteLength) copy.fill(0);
      copy = undefined;
      if (code) reject(new Error(code));
      else resolve();
    };
    const abort = () => finish("CANCELLED");
    const timeout = setTimeout(() => finish("PDF_TIMEOUT"), 90_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      if (typeof response !== "object" || response === null || !("ok" in response)) {
        finish("PDF_CHECK_FAILED");
      } else if (response.ok === true) {
        finish();
      } else if (
        response.ok === false &&
        "code" in response &&
        (response.code === "SOURCE_IMAGE_TOO_LARGE" || response.code === "INVALID_PDF")
      ) {
        finish(response.code);
      } else {
        finish("PDF_CHECK_FAILED");
      }
    };
    worker.onerror = (event) => {
      // PRV-003: suppress the browser's default report, which can include parsed input.
      event.preventDefault();
      finish("PDF_CHECK_FAILED");
    };
    worker.onmessageerror = () => finish("PDF_CHECK_FAILED");
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      // Keep the original usable by PDF.js and the unchanged-original fallback.
      copy = bytes.slice();
      worker.postMessage({ bytes: copy, maxPixels } satisfies SourceCheckRequest, [copy.buffer]);
      copy = undefined;
    } catch {
      finish(signal.aborted ? "CANCELLED" : "PDF_CHECK_FAILED");
    }
  });
}
