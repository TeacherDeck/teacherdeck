// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { validPast, type Teacher } from "./planner.ts";
import { initialState, sanitizeState, type PlannerState } from "./state.ts";
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function name(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.trim() === v &&
    !!v &&
    v.length <= 100 &&
    ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  );
}
/** GAS has no year, private conditions or actual-performer ledger. Never infer performance. */
export function decodeLegacy(text: string, year: number): Record<string, PlannerState> | null {
  try {
    if (
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 2100 ||
      new TextEncoder().encode(text).length > 5 * 1024 * 1024
    )
      return null;
    const value: unknown = JSON.parse(text);
    if (
      !object(value) ||
      !Array.isArray(value["months"]) ||
      !value["months"].length ||
      value["months"].length > 12 ||
      !Array.isArray(value["counts"]) ||
      value["counts"].length > 500
    )
      return null;
    const teachers = new Map<string, Teacher>();
    for (const count of value["counts"]) {
      if (
        !object(count) ||
        !name(count["name"]) ||
        typeof count["count"] !== "number" ||
        !validPast(count["count"]) ||
        teachers.has(count["name"])
      )
        return null;
      teachers.set(count["name"], {
        id: `legacy-${teachers.size + 1}`,
        name: count["name"],
        past: count["count"],
        fixed: [],
        excluded: [],
        weekdays: [],
        participating: true,
      });
    }
    // Keep historic named assignees missing from active counts, but do not auto-assign them.
    for (const month of value["months"]) {
      if (!object(month) || !Array.isArray(month["data"]) || month["data"].length > 31) return null;
      for (const day of month["data"]) {
        if (!object(day)) return null;
        for (const field of ["final1", "final2"]) {
          const assignee = day[field];
          if (typeof assignee !== "string") return null;
          if (!assignee || assignee === "배정불가") continue;
          if (!name(assignee)) return null;
          if (!teachers.has(assignee))
            teachers.set(assignee, {
              id: `legacy-${teachers.size + 1}`,
              name: assignee,
              past: 0,
              fixed: [],
              excluded: [],
              weekdays: [],
              participating: false,
            });
        }
      }
    }
    if (teachers.size > 500) return null;
    const result: Record<string, PlannerState> = {};
    for (const month of value["months"]) {
      if (!object(month) || typeof month["sheetName"] !== "string" || !Array.isArray(month["data"])) return null;
      const match = /^(\d{1,2})월 데이터$/.exec(month["sheetName"]),
        number = Number(match?.[1]);
      if (number < 1 || number > 12 || !match) return null;
      const monthKey = `${year}-${String(number).padStart(2, "0")}`;
      if (Object.hasOwn(result, monthKey)) return null;
      const state = initialState(new Date(year, number - 1, 1));
      state.input.perDay = 2;
      state.input.weekends = false;
      state.input.teachers = [...teachers.values()].map((t) => ({ ...t, fixed: [], excluded: [], weekdays: [] }));
      const days: number[] = [];
      for (const record of month["data"]) {
        if (
          !object(record) ||
          typeof record["date"] !== "string" ||
          typeof record["dayKor"] !== "string" ||
          typeof record["exclude"] !== "boolean" ||
          typeof record["exam"] !== "boolean" ||
          typeof record["memo"] !== "string" ||
          record["memo"].length > 2000
        )
          return null;
        const date = /^(\d{1,2})\/(\d{1,2})$/.exec(record["date"]),
          day = Number(date?.[2]);
        if (
          !date ||
          Number(date[1]) !== number ||
          day < 1 ||
          day > new Date(Date.UTC(year, number, 0)).getUTCDate() ||
          days.includes(day)
        )
          return null;
        const weekday = "일월화수목금토"[new Date(Date.UTC(year, number - 1, day)).getUTCDay()];
        if (record["dayKor"] !== "" && record["dayKor"] !== weekday && record["dayKor"] !== `${weekday}요일`)
          return null;
        const assignees = [record["final1"], record["final2"]].filter(
          (v): v is string => typeof v === "string" && !!v && v !== "배정불가",
        );
        if (new Set(assignees).size !== assignees.length || (record["exam"] && !!record["final2"])) return null;
        const slots = [record["final1"], record["final2"]];
        days.push(day);
        state.assignments[String(day)] = slots.map((assignee) =>
          typeof assignee === "string" ? (teachers.get(assignee)?.id ?? "") : "",
        );
        const missing = slots.flatMap((assignee, index) => (assignee === "배정불가" ? [index] : []));
        if (missing.length) state.legacyMissing = { ...state.legacyMissing, [day]: missing };
        if (record["exclude"]) state.input.excluded.push(day);
        if (record["exam"]) state.input.exam?.push(day);
        if (record["memo"]) state.memo = { ...state.memo, [day]: record["memo"] };
      }
      state.legacyDays = days;
      // Missing original rows cannot accidentally become new duty dates during a re-plan.
      for (let day = 1; day <= new Date(Date.UTC(year, number, 0)).getUTCDate(); day++)
        if (!days.includes(day)) state.input.excluded.push(day);
      if (!sanitizeState(state)) return null;
      result[monthKey] = state;
    }
    return result;
  } catch {
    return null;
  }
}
