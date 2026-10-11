// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

import { expect, it } from "vitest";
import { emptyDocument, mergeDocuments, readDocument, visibleItems, type Item } from "./logic.ts";
const item: Item = {
  id: "one",
  title: "합성 메모",
  body: "기억할 내용",
  pinned: false,
  tone: "neutral",
  archived: false,
  updatedAt: "2026-10-11T00:00:00Z",
};
it("round trips every stored field and rejects future formats instead of silently truncating", () => {
  const value = { ...emptyDocument(), items: [item] };
  expect(readDocument(JSON.parse(JSON.stringify(value)))).toEqual(value);
  for (const damaged of [
    { ...value, version: 2 },
    { ...value, extra: true },
    { ...value, items: [{ ...item, extra: true }] },
    { ...value, items: [item, item] },
  ])
    expect(() => readDocument(damaged)).toThrow();
});
it("rejects excess records and oversized UTF-8 content without dropping individual records", () => {
  expect(() =>
    readDocument({ ...emptyDocument(), items: Array.from({ length: 201 }, (_, i) => ({ ...item, id: String(i) })) }),
  ).toThrow();
  expect(() =>
    readDocument({
      ...emptyDocument(),
      items: Array.from({ length: 25 }, (_, i) => ({ ...item, id: String(i), body: "한".repeat(4000) })),
    }),
  ).toThrow();
});
it("searches content and keeps archives separate with deterministic ordering", () => {
  const document = { ...emptyDocument(), items: [item, { ...item, id: "two", title: "보관 자료", archived: true }] };
  expect(visibleItems(document, "기억할", false).map((item) => item.id)).toEqual(["one"]);
  expect(visibleItems(document, "", true).map((item) => item.id)).toEqual(["two"]);
});

it("sorts pinned notes first without changing saved order", () => {
  const value = {
    ...emptyDocument(),
    items: [item, { ...item, id: "two", pinned: true, updatedAt: "2025-01-01T00:00:00Z" }],
  };
  expect(visibleItems(value, "", false).map((item) => item.id)).toEqual(["two", "one"]);
  expect(value.items[0]?.id).toBe("one");
});

it("adds imported records without overwriting a matching identity and rejects overflowing additions", () => {
  const current = { ...emptyDocument(), items: [item] },
    imported = { ...emptyDocument(), items: [{ ...item, title: "가져온 항목" }] };
  const next = mergeDocuments(current, imported);
  expect(next.items).toHaveLength(2);
  expect(next.items[0]).toEqual(item);
  expect(next.items[1]?.title).toBe("가져온 항목");
  expect(next.items[1]?.id).not.toBe(item.id);
  expect(imported.items[0]?.id).toBe(item.id);
  expect(() =>
    mergeDocuments(
      { ...current, items: Array.from({ length: 200 }, (_, i) => ({ ...item, id: String(i) })) },
      imported,
    ),
  ).toThrow();
});
