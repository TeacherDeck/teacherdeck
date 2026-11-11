// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Content-free shell save/discard/cancel coordinator (ADR-0030).
import type { DocumentAction } from "../generated/DocumentAction.ts";
import type { DocumentActionResult } from "../generated/DocumentActionResult.ts";
import type { DocumentState } from "../generated/DocumentState.ts";

export type DocumentDecision = "save" | "discard" | "cancel";
export interface DocumentPrompt {
  moduleId: string;
  state: DocumentState;
}
export interface DocumentProtectionHost {
  documentAction(moduleId: string, action: DocumentAction): Promise<DocumentActionResult>;
  moduleUnloaded(moduleId: string): Promise<void>;
}

/** Host state is read for every transition; success never follows an optimistic UI dirty flag. */
export class DocumentProtection {
  private cancelled = false;
  private readonly host: DocumentProtectionHost;
  private readonly ask: (prompt: DocumentPrompt) => Promise<DocumentDecision>;
  private readonly onDiscard: (moduleId: string) => void;
  private readonly onSaving: (prompt: DocumentPrompt | null) => void;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly clock: () => number;
  constructor(
    host: DocumentProtectionHost,
    ask: (prompt: DocumentPrompt) => Promise<DocumentDecision>,
    onDiscard: (moduleId: string) => void,
    onSaving: (prompt: DocumentPrompt | null) => void = () => undefined,
    wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    clock: () => number = Date.now,
  ) {
    this.host = host;
    this.ask = ask;
    this.onDiscard = onDiscard;
    this.onSaving = onSaving;
    this.wait = wait;
    this.clock = clock;
  }

  /** UI cancellation does not revoke or clear the document itself. */
  cancel(): void {
    this.cancelled = true;
  }

  /** Leaves no iframe removed when a save fails or the user cancels. */
  async allow(moduleIds: readonly string[]): Promise<boolean> {
    this.cancelled = false;
    const discarded: { moduleId: string; documentHandle: string; requestId: string }[] = [];
    const prepared: { moduleId: string; requestId: string }[] = [];
    try {
      for (const moduleId of new Set(moduleIds)) {
        const { state, requestId } = await this.host.documentAction(moduleId, { kind: "prepare" });
        if (state === null || requestId === null) continue;
        prepared.push({ moduleId, requestId });
        if (!state.dirty && !state.saving) continue;
        const decision = await this.ask({ moduleId, state });
        if (decision === "cancel" || state.saving) return false;
        if (decision === "discard") {
          discarded.push({ moduleId, documentHandle: state.documentHandle, requestId });
          continue;
        }
        await this.host.documentAction(moduleId, { kind: "requestSave", requestId });
        this.onSaving({ moduleId, state: { ...state, saving: true } });
        const deadline = this.clock() + 60_000;
        let saved = false;
        while (!this.cancelled && this.clock() < deadline) {
          const result = await this.host.documentAction(moduleId, { kind: "saveResult", requestId });
          if (result.saved !== null) {
            saved = result.saved && result.state?.dirty === false && result.state.saving === false;
            break;
          }
          await this.wait(100);
        }
        this.onSaving(null);
        if (this.cancelled) return false;
        if (!saved) return false;
      }
      // Ask all decisions before discarding; a later Cancel keeps earlier unsaved documents too.
      for (const { moduleId, documentHandle, requestId } of discarded) {
        await this.host.documentAction(moduleId, { kind: "discard", documentHandle, requestId });
        await this.host.moduleUnloaded(moduleId);
        this.onDiscard(moduleId);
      }
      // A new edit while another document was being considered makes the transition unsafe.
      for (const moduleId of new Set(moduleIds)) {
        const { state } = await this.host.documentAction(moduleId, { kind: "status" });
        if (state?.dirty || state?.saving) return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      this.onSaving(null);
      await Promise.allSettled(
        prepared.map(({ moduleId, requestId }) =>
          this.host.documentAction(moduleId, { kind: "cancelSave", requestId }),
        ),
      );
    }
  }
}
