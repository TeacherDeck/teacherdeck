// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-006 violation: calls the fs capability without declaring it in module.json.
import type { Deck } from "@deck/sdk";

export async function run(deck: Deck): Promise<unknown> {
  return deck.fs.pickFiles();
}
