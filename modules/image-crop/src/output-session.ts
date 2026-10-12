// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, OutputBatch } from "@deck/sdk";
/** Keeps at most one append-only grant open, reusing it until the source changes. */
export class OutputSession {
  private batch: OutputBatch | null = null;
  private opening: Promise<OutputBatch | null> | null = null;
  private source: string | undefined;
  private closed = false;
  readonly usedNames = new Set<string>();
  private readonly deck: Pick<Deck, "fs">;
  private parentHandle: string | undefined;
  constructor(deck: Pick<Deck, "fs">, parentHandle?: string) {
    this.deck = deck;
    this.parentHandle = parentHandle;
  }
  async get(signal: AbortSignal, sourceHandle?: string): Promise<OutputBatch | null> {
    if (this.closed || signal.aborted) return null;
    if (this.opening) await this.opening;
    if (this.closed || signal.aborted) return null;
    if (this.batch && (this.parentHandle || this.source === sourceHandle)) return this.batch;
    if (this.batch) {
      await this.deck.fs.closeOutputFolder({ batchId: this.batch.batchId });
      this.batch = null;
    }
    this.opening = this.open(signal, sourceHandle);
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  private async open(signal: AbortSignal, sourceHandle?: string): Promise<OutputBatch | null> {
    if (!this.parentHandle && !sourceHandle) {
      const parent = await this.deck.fs.pickFolder();
      if (!parent || signal.aborted || this.closed) return null;
      this.parentHandle = parent.handle;
    }
    if (!this.parentHandle && !sourceHandle) return null;
    const batch = await this.deck.fs.openOutputFolder(
      this.parentHandle ? { parentHandle: this.parentHandle } : { sourceHandle: sourceHandle ?? "" },
    );
    if (this.closed || signal.aborted) {
      await this.deck.fs.closeOutputFolder({ batchId: batch.batchId });
      return null;
    }
    this.source = sourceHandle;
    this.batch = batch;
    return batch;
  }
  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.opening;
    } catch {
      /* No output was acquired. */
    }
    const batch = this.batch;
    this.batch = null;
    if (batch) await this.deck.fs.closeOutputFolder({ batchId: batch.batchId });
  }
}
