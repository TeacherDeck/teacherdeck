// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

export const STATE_KEY = "state.v1";
export const MAX_BYTES = 224 * 1024;
export interface Item {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  tone: "neutral" | "yellow" | "blue" | "green";
  archived: boolean;
  updatedAt: string;
}
export interface Document {
  format: "teacherdeck-quick-note";
  version: 1;
  items: Item[];
}
export const emptyDocument = (): Document => ({ format: "teacherdeck-quick-note", version: 1, items: [] });

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
    source["format"] !== "teacherdeck-quick-note" ||
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
      (!item["title"] && !item["body"]) ||
      !text(item["body"], 4000) ||
      typeof item["pinned"] !== "boolean" ||
      !["neutral", "yellow", "blue", "green"].includes(String(item["tone"])) ||
      typeof item["archived"] !== "boolean" ||
      typeof item["updatedAt"] !== "string" ||
      item["updatedAt"].length > 40 ||
      !Number.isFinite(Date.parse(item["updatedAt"])) ||
      Object.keys(item).some((key) => !["id", "title", "body", "pinned", "tone", "archived", "updatedAt"].includes(key))
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
    .filter((item) => item.archived === archived && (item.title + " " + item.body).toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}
