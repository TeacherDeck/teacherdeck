// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-014: encoding and mask selection run outside the UI thread.
import { encodeQr } from "./qr.ts";

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, image: encodeQr(event.data) });
  } catch {
    self.postMessage({ ok: false });
  }
};
