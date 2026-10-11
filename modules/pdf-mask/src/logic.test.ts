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
  it("detects split label and Korean name on one row without joining a distant column", () => {
    const runs = ["성", "명", ":", "가", "상", "가"].map((text, i) => ({
      text,
      x: 20 + i * 12,
      y: 30,
      width: 12,
      height: 20,
    }));
    const input = { ...page([]), boxes: runs };
    const found = detect([input], [], ["이름"]);
    expect(found).toHaveLength(1);
    expect(found[0]?.label).toBe("가상가");
    expect(found[0]?.rect).toEqual({ x: 56, y: 30, width: 36, height: 20 });
    const first = runs[0],
      second = runs[1];
    if (!first || !second) throw new Error("MISSING_SYNTHETIC_BOX");
    expect(detect([{ ...input, boxes: [first, { ...second, x: 500 }] }], [], ["이름"])).toEqual([]);
    expect(detect([page(["가상가가 제출한 문서"])], [], ["이름"])).toEqual([]);
  });
  it("detects labelled Latin names and a value under a label but stops at the next field", () => {
    const found = detect(
      [
        page([
          "Name: Synthetic User",
          "성명: Synthetic-Person Example",
          "성명:",
          "가상가",
          "Full Name: Synthetic User",
          "Name: Synthetic User Phone: 010-0000-0000",
        ]),
      ],
      [],
      ["이름"],
    );
    expect(found.map((candidate) => candidate.label)).toEqual([
      "Synthetic User",
      "Synthetic-Person Example",
      "가상가",
      "Synthetic User",
      "Synthetic User",
    ]);
    expect(detect([page(["Synthetic User submitted the file"])], [], ["이름"])).toEqual([]);
  });
  it("includes aligned multiline addresses without absorbing a new field, paragraph or column", () => {
    const found = detect([page(["주소: 가상시 예시로 0", "합성동 2호", "학번 10301", "12345"])], [], ["주소"]);
    expect(found[0]?.label).toBe("가상시 예시로 0\n합성동 2호");
    expect(found[0]?.rect.height).toBe(50);
    const input = page(["주소: 가상시 예시로 0", "합성동 2호"]);
    const next = input.boxes[1];
    if (!next) throw new Error("MISSING_SYNTHETIC_BOX");
    next.x = 500;
    expect(detect([input], [], ["주소"])[0]?.rect.height).toBe(20);
    expect(detect([page(["주소: 가상시 예시로 0", "문서를 확인해 주세요"])], [], ["주소"])[0]?.label).toBe(
      "가상시 예시로 0",
    );
  });
  it("covers the value when a Latin name repeats its field label", () => {
    const input = {
      ...page([]),
      boxes: [
        { text: "Name:", x: 20, y: 30, width: 50, height: 20 },
        { text: "Name", x: 75, y: 30, width: 40, height: 20 },
        { text: "User", x: 120, y: 30, width: 40, height: 20 },
      ],
    };
    const found = detect([input], [], ["이름"]);
    expect(found[0]?.label).toBe("Name User");
    expect(found[0]?.rect).toEqual({ x: 75, y: 30, width: 85, height: 20 });
  });
});
