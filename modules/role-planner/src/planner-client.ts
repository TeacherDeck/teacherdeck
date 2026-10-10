// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { draftErrors, type Assignment, type RoleState } from "./logic.ts";
export function generateInWorker(state: RoleState, draftId: string, signal: AbortSignal): Promise<RoleState> {
  if (signal.aborted) return Promise.reject(new DOMException("배정을 취소했어요.", "AbortError"));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./planner.worker.ts", import.meta.url), { type: "module" });
    let finished = false;
    const cleanup = () => {
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      if (finished) return;
      cleanup();
      reject(new DOMException("배정을 취소했어요.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      if (finished) return;
      cleanup();
      reject(new Error("배정 시간이 길어 중단했어요. 이전 배정은 유지했어요. 다시 시도해 주세요."));
    }, 30000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; draft?: Assignment[]; error?: string }>) => {
      if (finished) return;
      cleanup();
      if (!event.data.ok || !Array.isArray(event.data.draft)) {
        reject(new Error(event.data.error ?? "배정하지 못했어요. 이전 배정은 유지했어요."));
        return;
      }
      const issues = draftErrors(state, event.data.draft);
      if (issues.length) {
        reject(new Error("배정 조건을 확인해 주세요. 이전 배정은 유지했어요."));
        return;
      }
      resolve({ ...state, draft: event.data.draft, draftId });
    };
    worker.onerror = () => {
      if (finished) return;
      cleanup();
      reject(new Error("배정하지 못했어요. 이전 배정은 유지했어요. 다시 시도해 주세요."));
    };
    try {
      worker.postMessage({ state, draftId });
    } catch {
      cleanup();
      reject(new Error("배정하지 못했어요. 이전 배정은 유지했어요."));
    }
  });
}
