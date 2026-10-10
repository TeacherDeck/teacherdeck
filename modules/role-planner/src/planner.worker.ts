// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { generate, type RoleState } from "./logic.ts";
self.onmessage = (event: MessageEvent<{ state: RoleState; draftId: string }>) => {
  try {
    const result = generate(event.data.state, event.data.draftId);
    self.postMessage({ ok: true, draft: result.draft });
  } catch (failure) {
    self.postMessage({ ok: false, error: failure instanceof Error ? failure.message : "배정 조건을 확인해 주세요." });
  }
};
