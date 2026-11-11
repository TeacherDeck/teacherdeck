// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "./client.ts";

export interface DocumentSessionOptions {
  /** Persist the complete current workspace, including unfinished input. */
  save: () => Promise<void>;
  /** A partial export may succeed while other edits still need to be saved. */
  isSaved?: () => boolean;
  onError?: () => void;
}

/** Framework-independent window 1.2 protection. Never applies a first edit before host acknowledgement. */
export function createDocumentSession(deck: Pick<Deck, "window" | "on">, options: DocumentSessionOptions) {
  let handle = "";
  let dirty = false;
  let disposed = false;
  let revision = 0;
  let transition: Promise<boolean> | null = null;
  let saving: Promise<boolean> | null = null;
  let registration: Promise<void> | null = null;
  let off: (() => void) | null = null;
  function connect(): Promise<void> {
    disposed = false;
    off ??= deck.on("window.documentSaveRequested", ({ documentHandle, requestId }) => {
      if (documentHandle !== handle || disposed) return;
      void save()
        .then((saved) => deck.window.completeDocumentSave({ documentHandle, requestId, saved }))
        .catch(() => options.onError?.());
    });
    registration ??= deck.window.registerDocument().then((value) => {
      handle = value.documentHandle;
    });
    return registration;
  }
  const state = (nextDirty: boolean, nextSaving: boolean) =>
    deck.window.setDocumentState({ documentHandle: handle, dirty: nextDirty, saving: nextSaving });
  function change(apply: () => void): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    // Count requests before queuing them so an in-flight save cannot approve
    // unloading while an unapplied edit is waiting behind that save.
    revision++;
    if (dirty && transition === null && saving === null) {
      apply();
      return Promise.resolve(true);
    }
    const before = transition ?? saving ?? connect().then(() => true);
    const pending = before
      .then(async () => {
        if (disposed) return false;
        if (!dirty) {
          await state(true, false);
          dirty = true;
        }
        if (disposed) return false;
        apply();
        return true;
      })
      .catch(() => {
        options.onError?.();
        return false;
      });
    transition = pending;
    void pending.then(() => {
      if (transition === pending) transition = null;
    });
    return pending;
  }
  function save(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (saving !== null) return saving;
    const savedRevision = revision;
    const before = transition ?? connect().then(() => true);
    const pending = before
      .then(async () => {
        if (disposed) return false;
        await state(dirty, true);
        try {
          await options.save();
          const nextDirty = revision !== savedRevision || options.isSaved?.() === false;
          await state(nextDirty, false);
          dirty = nextDirty;
          // A request may arrive while the clean acknowledgement is pending.
          if (!dirty && revision !== savedRevision) {
            await state(true, false);
            dirty = true;
          }
          return !dirty;
        } catch {
          // Failed writes remain protected, including retrying a previously clean workspace.
          dirty = true;
          await state(true, false);
          throw new Error("DOCUMENT_SAVE_FAILED");
        }
      })
      .catch(() => {
        options.onError?.();
        return false;
      });
    saving = pending;
    void pending.then(() => {
      if (saving === pending) saving = null;
    });
    return pending;
  }
  async function settle(): Promise<void> {
    if (disposed) return;
    await connect();
    while (transition !== null || saving !== null) await (transition ?? saving);
  }
  return {
    get ready() {
      return connect();
    },
    change,
    save,
    settle,
    dispose() {
      disposed = true;
      off?.();
      off = null;
    },
  };
}

export type DocumentSession = ReturnType<typeof createDocumentSession>;
