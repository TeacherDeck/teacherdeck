// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { checkSourceImages } from "./source-check.ts";
import type { SourceCheckRequest, SourceCheckResponse } from "./source-check-client.ts";

self.onmessage = (event: MessageEvent<SourceCheckRequest>) => {
  const { bytes, maxPixels } = event.data;
  void checkSourceImages(bytes, maxPixels)
    .then(
      () => self.postMessage({ ok: true } satisfies SourceCheckResponse),
      (error: unknown) => {
        // PRV-003: never send parser messages, which may contain source object contents.
        const code =
          error instanceof Error && error.message === "SOURCE_IMAGE_TOO_LARGE"
            ? "SOURCE_IMAGE_TOO_LARGE"
            : "INVALID_PDF";
        self.postMessage({ ok: false, code } satisfies SourceCheckResponse);
      },
    )
    .finally(() => bytes.fill(0));
};
