// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { averagePast, parseRoster, type Teacher } from "./planner.ts";
/** Accepts the original extractTimetable's flattened four-column TSV without workbook access. */
export function parseTimetable(text: string, previous: Teacher[], mean = averagePast(previous)): Teacher[] | null {
  const fourth = new Map<string, Set<number>>();
  const labels = ["일", "월", "화", "수", "목", "금", "토"];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const [name = "", day = "", period = "", ...rest] = raw.split("\t").map((x) => x.trim());
    if (name === "교사명" && day === "요일") continue;
    const weekday = labels.indexOf(day.replace("요일", ""));
    const n = Number(period);
    if (
      !name ||
      name.length > 100 ||
      weekday < 1 ||
      weekday > 5 ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > 20 ||
      rest.length > 1
    )
      return null;
    if (!fourth.has(name)) fourth.set(name, new Set());
    if (n === 4) fourth.get(name)?.add(weekday);
  }
  if (!fourth.size) return null;
  const names = [...new Set([...previous.map((t) => t.name), ...fourth.keys()])];
  const teachers = parseRoster(
    names.map((name) => `${name}\t${previous.find((t) => t.name === name)?.past ?? mean}`).join("\n"),
    previous,
  );
  if (!teachers) return null;
  return teachers.map((t) => {
    const days = fourth.get(t.name);
    return days
      ? { ...t, slotWeekdays: [[1, 2, 3, 4, 5].filter((d) => !days.has(d)), [...days], [0, 1, 2, 3, 4, 5, 6]] }
      : t;
  });
}
