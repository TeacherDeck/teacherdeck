// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { boundRect, detect, readTerms, TYPES, type PageInfo } from "./logic.ts";
const page = (texts: string[]): PageInfo => ({
  number: 1,
  width: 600,
  height: 800,
  boxes: texts.map((text, i) => ({ text, x: 20, y: 30 + i * 30, width: 400, height: 20 })),
});
describe("local personal data candidates", () => {
  it("covers phones and resident numbers split into text runs", () => {
    const found = detect([page(["010-", "0000-", "0000", "990101-1000000"])], [], TYPES);
    expect(found.map((c) => c.kind)).toEqual(["전화번호", "주민번호"]);
    expect(found[0]?.rect).toEqual({ x: 20, y: 30, width: 400, height: 80 });
  });
  it("requires labels for ambiguous numbers, names, dates and addresses", () => {
    const found = detect(
      [
        page([
          "123456789012",
          "가상가",
          "계좌번호: 123-456-789012",
          "생년월일: 1999.01.01",
          "주소: 가상시 예시로 0",
          "학번: 10301",
          "성명: 가상가",
        ]),
      ],
      [],
      TYPES,
    );
    expect(found.map((c) => c.kind)).toEqual(["계좌번호", "생년월일", "주소", "학번", "이름"]);
  });
  it("finds supplied names across divided text objects and all pages", () => {
    const other = { ...page(["가상가"]), number: 2 };
    const found = detect([page(["가상", "가"]), other], ["가상가"], ["검색어"]);
    expect(found).toHaveLength(2);
    expect(found.map((c) => c.page)).toEqual([1, 2]);
    expect(found[0]?.rect.height).toBe(50);
  });
  it("respects disabled types and rejects huge candidate sets", () => {
    expect(detect([page(["010-0000-0000"])], [], [])).toEqual([]);
    expect(() =>
      detect(
        [page(["예시"])],
        Array.from({ length: 257 }, () => "예시"),
        TYPES,
      ),
    ).toThrow("TOO_MANY_TERMS");
  });
  it("reads CSV quoted fields and multiline terms without using remarks", () => {
    expect(
      readTerms(
        '\uFEFF마스킹할_텍스트,비고\r\n"가상,가",예시\r\n"줄1\n줄2",메모\r\n가상나,메모\r\n가상나,중복',
        true,
        true,
      ),
    ).toEqual(["가상,가", "줄1\n줄2", "가상나"]);
    expect(readTerms("가상가\n\n가상가\n가상나", false, false)).toEqual(["가상가", "가상나"]);
    expect(() => readTerms('"닫히지 않은 값', true, false)).toThrow("INVALID_CSV");
  });
  it("bounds manual masks and refuses nonfinite coordinates", () => {
    expect(boundRect({ x: -5, y: 795, width: 2000, height: 30 }, 600, 800)).toEqual({
      x: 0,
      y: 795,
      width: 600,
      height: 5,
    });
    expect(() => boundRect({ x: NaN, y: 0, width: 10, height: 10 }, 100, 100)).toThrow("INVALID_RECT");
  });
});
