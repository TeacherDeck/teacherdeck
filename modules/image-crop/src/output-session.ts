// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, OutputBatch } from "@deck/sdk";
/** One output batch per editing task. Closing never deletes the saved files. */
export class OutputSession {
  private batch: OutputBatch | null = null;
  private opening: Promise<OutputBatch | null> | null = null;
  private closed = false;
  readonly usedNames = new Set<string>();
  private readonly deck: Pick<Deck, "fs">;
  private readonly suggestedName: string;
  constructor(deck: Pick<Deck, "fs">, suggestedName: string) {
    this.deck = deck;
    this.suggestedName = suggestedName;
  }
  async get(signal: AbortSignal): Promise<OutputBatch | null> {
    if (this.closed || signal.aborted) return null;
    if (this.batch) return this.batch;
    if (!this.opening) this.opening = this.open(signal);
    try {
      return await this.opening;
    } finally {
      this.opening = null;
    }
  }
  private async open(signal: AbortSignal): Promise<OutputBatch | null> {
    const parent = await this.deck.fs.pickFolder();
    if (!parent || signal.aborted || this.closed) return null;
    const batch = await this.deck.fs.createOutputFolder({
      parentHandle: parent.handle,
      suggestedName: this.suggestedName,
    });
    // Unmount may happen while the native folder dialog or creation is pending.
    if (this.closed) {
      await this.deck.fs.closeOutputFolder({ batchId: batch.batchId });
      return null;
    }
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
