// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { type Meeting, readMeeting } from "./meeting.ts";
export const MEETING_KEY = "meeting.v1";
export const MAX_BYTES = 250 * 1024;
export async function loadMeeting(deck: Pick<Deck, "storage">): Promise<Meeting> {
  return readMeeting(await deck.storage.get(MEETING_KEY));
}
export function createWriter(deck: Pick<Deck, "storage">) {
  let chain = Promise.resolve();
  return (meeting: Meeting): Promise<void> => {
    const serialized = JSON.stringify(meeting);
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) return Promise.reject(new Error("MEETING_TOO_LARGE"));
    const snapshot: unknown = JSON.parse(serialized);
    const write = chain.then(() => deck.storage.set(MEETING_KEY, snapshot)).then(() => undefined);
    chain = write.catch(() => undefined);
    return write;
  };
}
