// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { type Meeting, readMeeting } from "./meeting.ts";
import { MAX_BYTES } from "./storage.ts";
export interface Roster {
  name: string;
  people: string[];
  title: string;
  place: string;
}
export interface Archived {
  key: string;
  title: string;
  count: number;
}
export interface Library {
  rosters: Roster[];
  archive: Archived[];
}
export const LIBRARY_KEY = "library.v1";
export const EMPTY_LIBRARY: Library = { rosters: [], archive: [] };
export async function loadLibrary(deck: Pick<Deck, "storage">): Promise<Library> {
  const value = await deck.storage.get<Library>(LIBRARY_KEY);
  if (value === null) return { rosters: [], archive: [] };
  if (
    !Array.isArray(value.rosters) ||
    value.rosters.length > 40 ||
    !value.rosters.every(
      (r) =>
        r &&
        typeof r.name === "string" &&
        typeof r.title === "string" &&
        typeof r.place === "string" &&
        Array.isArray(r.people) &&
        r.people.length <= 12 &&
        r.people.every((p) => typeof p === "string"),
    ) ||
    !Array.isArray(value.archive) ||
    value.archive.length > 20 ||
    !value.archive.every(
      (a) =>
        a &&
        typeof a.key === "string" &&
        /^archive\.[a-z0-9-]+$/.test(a.key) &&
        typeof a.title === "string" &&
        Number.isInteger(a.count),
    )
  )
    throw new Error("INVALID_LIBRARY");
  return value;
}
export async function archiveMeeting(
  deck: Pick<Deck, "storage">,
  meeting: Meeting,
  library: Library,
): Promise<Library> {
  if (!meeting.entries.length && !meeting.draft.trim()) return library;
  if (library.archive.length >= 20) throw new Error("ARCHIVE_FULL");
  if (new TextEncoder().encode(JSON.stringify(meeting)).length > MAX_BYTES) throw new Error("MEETING_TOO_LARGE");
  const key = `archive.${crypto.randomUUID()}`;
  await deck.storage.set(key, meeting);
  const next = {
    ...library,
    archive: [{ key, title: meeting.title, count: meeting.entries.length }, ...library.archive],
  };
  try {
    await deck.storage.set(LIBRARY_KEY, next);
  } catch (error) {
    await deck.storage.delete(key).catch(() => undefined);
    throw error;
  }
  return next;
}
export async function archivedMeeting(deck: Pick<Deck, "storage">, key: string): Promise<Meeting> {
  const value = await deck.storage.get(key);
  if (value === null) throw new Error("INVALID_MEETING");
  return readMeeting(value);
}
/** Removes only this module's selected archive; external backup files remain untouched. */
export async function removeArchive(deck: Pick<Deck, "storage">, key: string, library: Library): Promise<Library> {
  if (!library.archive.some((item) => item.key === key)) throw new Error("INVALID_ARCHIVE");
  const next = { ...library, archive: library.archive.filter((item) => item.key !== key) };
  await deck.storage.set(LIBRARY_KEY, next);
  try {
    await deck.storage.delete(key);
  } catch (error) {
    await deck.storage.set(LIBRARY_KEY, library);
    throw error;
  }
  return next;
}
