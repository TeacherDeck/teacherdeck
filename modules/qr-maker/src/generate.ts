// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { QrImage } from "./qr.ts";

export type GenerateQr = (text: string, signal: AbortSignal) => Promise<QrImage>;

/** A replaced request terminates its worker; it cannot publish an old preview. */
export const generateQr: GenerateQr = (text, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("CANCELLED"));
      return;
    }
    const worker = new Worker(new URL("./qr.worker.ts", import.meta.url), { type: "module" });
    const close = () => {
      worker.terminate();
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    };
    const fail = () => {
      close();
      reject(new Error("QR 코드를 만들지 못했어요. 내용을 줄이거나 도구를 다시 열어 주세요."));
    };
    const cancel = () => {
      close();
      reject(new Error("CANCELLED"));
    };
    const timeout = setTimeout(fail, 15000);
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = fail;
    worker.onmessage = (event: MessageEvent<{ ok: boolean; image?: QrImage }>) => {
      if (!event.data.ok || !event.data.image) {
        fail();
        return;
      }
      close();
      resolve(event.data.image);
    };
    worker.postMessage(text);
  });
