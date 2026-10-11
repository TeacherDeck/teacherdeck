// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { conversionError, planConversions, providerFor, replanRows } from "./logic.ts";
const file = (handle: string, name: string) => ({
  handle,
  name,
  ext: name.split(".").at(-1) ?? "",
  size: 100,
  modifiedAt: 0,
});
describe("real Office format planning", () => {
  it("maps all four originals without renaming source handles", () => {
    const files = [file("a", "합성.hwp"), file("b", "합성.xls"), file("c", "합성.ppt"), file("d", "합성.doc")];
    expect(planConversions(files, false).map((r) => r.format)).toEqual(["hwpx", "xlsx", "pptx", "docx"]);
    expect(files[0]?.name).toBe("합성.hwp");
  });
  it("retains explicit macro containers and optionally preserves legacy macros", () => {
    expect(
      planConversions(
        [file("a", "합성.xlsm"), file("b", "합성.xls"), file("c", "합성.ppt"), file("d", "합성.doc")],
        true,
      ).map((r) => r.format),
    ).toEqual(["xlsm", "xlsm", "pptm", "docm"]);
  });
  it("deduplicates handles and prevents case insensitive output collisions", () => {
    expect(
      planConversions(
        [file("a", "샘플.xls"), file("a", "샘플.xls"), file("b", "샘플.xlsx"), file("c", "무관.pdf")],
        false,
      ).map((r) => r.outputName),
    ).toEqual(["샘플.xlsx", "샘플 (2).xlsx"]);
    expect(providerFor(file("a", "무관.pdf"))).toBeNull();
  });
  it("returns private-data-free advice for errors", () => {
    expect(conversionError("INVALID_ARGS")).toContain("매크로");
    expect(conversionError("CANCELLED")).toContain("결과는 유지");
    expect(conversionError("BUSY", "열려 있는 PowerPoint를 닫은 뒤 다시 변환해 주세요.")).toContain(
      "PowerPoint를 닫은",
    );
    expect(conversionError("BUSY")).toContain("다른 문서 변환");
    expect(conversionError("BUSY", "private synthetic exception")).not.toContain("private");
  });
  it("explains that a timed-out worker stopped and approval belongs to the next attempt", () => {
    const advice = conversionError("TIMEOUT", "private synthetic exception");
    expect(advice).toContain("변환을 중지했어요");
    expect(advice).toContain("다시 시도할 때");
    expect(advice).toContain("문서 접근 승인");
    expect(advice).toContain("앞서 저장한 결과는 유지");
    expect(advice).not.toContain("열린 승인 창");
    expect(advice).not.toContain("private");
  });
  it("retains published results while replanning failed macro documents with collision-safe names", () => {
    const input = [file("a", "합성.xls"), file("b", "합성.xlsx"), file("c", "결과.doc")];
    const plans = planConversions(input, false);
    const old = plans.map((row, index) => ({
      ...row,
      state: index === 2 ? ("converted" as const) : ("failed" as const),
    }));
    const next = replanRows(old, planConversions(input, true));
    expect(next.map((row) => row.outputName)).toEqual(["합성.xlsm", "합성 (2).xlsm", "결과.docx"]);
    expect(next[2]).toBe(old[2]);
    expect(next[0]?.state).toBe("failed");
  });
});
