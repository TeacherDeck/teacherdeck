// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS

import { expect, it } from "vitest";
import {
  emptyDocument,
  mergeDocuments,
  readDocument,
  visibleItems,
  dateOrdinal,
  dayLabel,
  localDate,
  type Item,
} from "./logic.ts";
const item: Item = {
  id: "one",
  title: "합성 일정",
  date: "2026-10-12",
  group: "수업",
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
  expect(() => readDocument({ ...emptyDocument(), items: [{ ...item, date: "2026-02-29" }] })).toThrow();
});
it("searches content and keeps archives separate with deterministic ordering", () => {
  const document = { ...emptyDocument(), items: [item, { ...item, id: "two", title: "보관 자료", archived: true }] };
  expect(visibleItems(document, "수업", false).map((item) => item.id)).toEqual(["one"]);
  expect(visibleItems(document, "", true).map((item) => item.id)).toEqual(["two"]);
});

it("uses local calendar dates across leap days and DST boundary dates", () => {
  expect(dayLabel("2026-03-09", "2026-03-07")).toBe("D-2");
  expect(dayLabel("2026-10-10", "2026-10-11")).toBe("D+1");
  expect(dayLabel("2026-10-11", "2026-10-11")).toBe("D-Day · 당일");
  expect(dayLabel("2028-03-01", "2028-02-28")).toBe("D-2");
  for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-1", "0099-01-01"])
    expect(dateOrdinal(value)).toBeNull();
  const now = new Date(2026, 9, 11, 23, 59);
  expect(localDate(now)).toBe("2026-10-11");
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
