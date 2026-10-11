// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { DeckCallError, type Deck, type DestinationGrant } from "@deck/sdk";
import type { OutputFormat } from "./qr.ts";

const check = (signal: AbortSignal) => {
  if (signal.aborted) throw new DeckCallError("CANCELLED", "저장을 취소했어요.");
};

/** Reuse a session-only append-new grant; no paths, input history, or persistent storage. */
export class QrOutput {
  destination: DestinationGrant | null = null;
  private readonly deck: Deck;
  constructor(deck: Deck) {
    this.deck = deck;
  }

  async select(): Promise<DestinationGrant | null> {
    const destination = await this.deck.fs.pickDestination({ remember: false });
    if (destination) this.destination = destination;
    return destination;
  }

  async save(format: OutputFormat, makeBlob: () => Promise<Blob>, signal: AbortSignal): Promise<boolean> {
    check(signal);
    const destination = this.destination ?? (await this.select());
    check(signal);
    if (!destination) return false;
    const blob = await makeBlob();
    check(signal);
    try {
      await this.deck.fs.writeBlob(
        { batchId: destination.grantHandle, suggestedName: `QR 코드.${format}`, blob },
        { signal },
      );
      return true;
    } catch (error) {
      if (error instanceof DeckCallError && ["NOT_FOUND", "PERMISSION_DENIED"].includes(error.code))
        this.destination = null;
      throw error;
    }
  }
}
