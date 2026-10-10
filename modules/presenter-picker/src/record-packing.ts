// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
interface Packed {
  encoding: "deck-event-table-v1";
  base: Record<string, unknown>;
  fields: { name: string; string: boolean }[];
  dictionary: string[];
  rows: number[][];
}
export function packRecords(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("events" in value) ||
    !Array.isArray(value.events) ||
    !value.events.length
  )
    return value;
  const base = { ...value } as Record<string, unknown>;
  const events = value.events as Record<string, unknown>[];
  const first = events[0];
  if (!first) return value;
  const fields = Object.entries(first).map(([name, item]) => ({ name, string: typeof item === "string" }));
  const dictionary: string[] = [],
    index = new Map<string, number>();
  const rows = events.map((event) =>
    fields.map((field) => {
      const item = event[field.name];
      if (field.string && typeof item === "string") {
        let n = index.get(item);
        if (n === undefined) {
          n = dictionary.length;
          dictionary.push(item);
          index.set(item, n);
        }
        return n;
      }
      if (!field.string && typeof item === "number" && Number.isFinite(item)) return item;
      throw new Error("기록 필드 형식을 확인해 주세요.");
    }),
  );
  delete base["events"];
  return { encoding: "deck-event-table-v1", base, fields, dictionary, rows } satisfies Packed;
}
export function unpackRecords(value: unknown): unknown {
  if (!value || typeof value !== "object" || !("encoding" in value)) return value;
  const p = value as Partial<Packed>;
  const fail = (): never => {
    throw new Error("저장 기록 형식이 손상되었어요.");
  };
  if (
    p.encoding !== "deck-event-table-v1" ||
    !p.base ||
    typeof p.base !== "object" ||
    !Array.isArray(p.fields) ||
    p.fields.length > 20 ||
    !Array.isArray(p.dictionary) ||
    p.dictionary.length > 100000 ||
    p.dictionary.some((s) => typeof s !== "string") ||
    !Array.isArray(p.rows) ||
    p.rows.length > 10000
  )
    return fail();
  const fields = p.fields,
    dictionary = p.dictionary;
  if (
    fields.some(
      (f) =>
        !f ||
        typeof f.name !== "string" ||
        typeof f.string !== "boolean" ||
        ["__proto__", "constructor", "prototype"].includes(f.name),
    ) ||
    new Set(fields.map((f) => f.name)).size !== fields.length
  )
    return fail();
  const events = p.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== fields.length) return fail();
    return Object.fromEntries(
      fields.map((field, i) => {
        const n = row[i];
        if (typeof n !== "number" || !Number.isFinite(n)) return fail();
        const item = field.string ? dictionary[n] : n;
        if (field.string && (!Number.isInteger(n) || typeof item !== "string")) return fail();
        return [field.name, item];
      }),
    );
  });
  return { ...p.base, events };
}
