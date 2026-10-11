// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { checkSourceImages } from "./source-check.ts";
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  void checkSourceImages(event.data, 24_000_000).then(
    () => self.postMessage({ valid: true }),
    () => self.postMessage({ valid: false }),
  );
};
