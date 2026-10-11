// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { writeFreshPdf, type RasterPage } from "./writer.ts";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RasterPage[]>) => void) | null;
  postMessage(data: unknown, transfer: Transferable[]): void;
};
scope.onmessage = (event) => {
  void writeFreshPdf(event.data)
    .then((bytes) => scope.postMessage({ ok: true, bytes }, [bytes.buffer]))
    .catch(() => scope.postMessage({ ok: false }, []));
};
