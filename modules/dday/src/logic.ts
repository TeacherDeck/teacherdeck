// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

export const STATE_KEY = "state.v1";
export const MAX_BYTES = 224 * 1024;
export interface Item {
  id: string;
  title: string;
  date: string;
  group: string;
  archived: boolean;
  updatedAt: string;
}
export interface Document {
  format: "teacherdeck-dday";
  version: 1;
  items: Item[];
}
export const emptyDocument = (): Document => ({ format: "teacherdeck-dday", version: 1, items: [] });

/** Adding a saved item never replaces another item's identity. */
export function mergeDocuments(current: Document, incoming: Document): Document {
  const checked = readDocument(incoming),
    ids = new Set(current.items.map((item) => item.id));
  return readDocument({
    ...current,
    items: [
      ...current.items,
      ...checked.items.map((item) => {
        let id = item.id;
        while (ids.has(id)) id = crypto.randomUUID();
        ids.add(id);
        return { ...item, id };
      }),
    ],
  });
}
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
export function readDocument(value: unknown): Document {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_DOCUMENT");
  const source = value as Record<string, unknown>;
  if (
    source["format"] !== "teacherdeck-dday" ||
    source["version"] !== 1 ||
    !Array.isArray(source["items"]) ||
    source["items"].length > 200 ||
    Object.keys(source).some((key) => !["format", "version", "items"].includes(key))
  )
    throw new Error("INVALID_DOCUMENT");
  const ids = new Set<string>();
  for (const raw of source["items"]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_DOCUMENT");
    const item = raw as Record<string, unknown>;
    if (
      !text(item["id"], 80) ||
      !item["id"] ||
      ids.has(item["id"]) ||
      !text(item["title"], 120) ||
      !item["title"].trim() ||
      dateOrdinal(item["date"]) === null ||
      !text(item["group"], 80) ||
      typeof item["archived"] !== "boolean" ||
      typeof item["updatedAt"] !== "string" ||
      item["updatedAt"].length > 40 ||
      !Number.isFinite(Date.parse(item["updatedAt"])) ||
      Object.keys(item).some((key) => !["id", "title", "date", "group", "archived", "updatedAt"].includes(key))
    )
      throw new Error("INVALID_DOCUMENT");
    ids.add(item["id"]);
  }
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > MAX_BYTES) throw new Error("DOCUMENT_TOO_LARGE");
  return JSON.parse(encoded) as Document;
}
export function visibleItems(document: Document, query: string, archived: boolean): Item[] {
  const needle = query.trim().toLocaleLowerCase();
  return document.items
    .filter(
      (item) =>
        item.archived === archived &&
        (item.title + " " + item.group + " " + item.date).toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "ko"));
}

/** UTC ordinals of local calendar parts avoid DST and date-only UTC parsing. */
export function dateOrdinal(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined || year < 1900 || year > 9999) return null;
  const time = Date.UTC(year, month - 1, day),
    actual = new Date(time);
  return actual.getUTCFullYear() === year && actual.getUTCMonth() === month - 1 && actual.getUTCDate() === day
    ? time / 86400000
    : null;
}
export function localDate(now = new Date()): string {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join(
    "-",
  );
}
export function dayLabel(date: string, today: string): string {
  const target = dateOrdinal(date),
    current = dateOrdinal(today);
  if (target === null || current === null) throw new Error("INVALID_DATE");
  const difference = target - current;
  return difference === 0 ? "D-Day · 당일" : difference > 0 ? `D-${difference}` : `D+${-difference}`;
}
