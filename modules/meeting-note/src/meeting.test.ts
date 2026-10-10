// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { emptyMeeting, parseEntry, publicText, readMeeting, speakerIndex } from "./meeting.ts";
describe("meeting syntax", () => {
  it("preserves kinds, one-line speaker override and literal escape", () => {
    expect(parseEntry("! 2 가결", ["가상 화자 A", "가상 화자 B"], "가상 화자 A", "1")).toMatchObject({
      kind: "결정",
      speaker: "가상 화자 B",
      text: "가결",
    });
    expect(parseEntry("! \\3 학년 예산", [], "", "2")).toMatchObject({ text: "3 학년 예산" });
    expect(parseEntry("2:1로 가결", [], "", "3")?.text).toBe("2:1로 가결");
    expect(parseEntry("* 준비 @가상담당 ~10/10", [], "", "4")).toMatchObject({
      kind: "조치",
      text: "준비",
      owner: "가상담당",
      due: "10/10",
    });
    expect(parseEntry("? 질문", [], "", "5")?.kind).toBe("질의");
    expect(parseEntry("# 안건", [], "", "6")?.kind).toBe("안건");
    expect(parseEntry("\\! 본문", [], "", "7")).toMatchObject({ kind: "발언", text: "! 본문" });
  });
  it("never exposes private text or private agenda headings", () => {
    const meeting = emptyMeeting();
    meeting.entries = [parseEntry("// # 숨김 제목", [], "", "1"), parseEntry("! 공개 결정", [], "", "2")].filter(
      (e) => e !== null,
    );
    expect(publicText(meeting)).not.toContain("숨김 제목");
    expect(publicText(meeting)).toContain("공개 결정");
    expect(parseEntry("   ", [], "", "3")).toBeNull();
  });
  it("refuses malformed stored state and maps all twelve shortcuts", () => {
    expect(readMeeting(null)).toEqual(emptyMeeting());
    expect(() => readMeeting({ version: 1, entries: [] })).toThrow("INVALID_MEETING");
    expect(speakerIndex("Digit0")).toBe(9);
    expect(speakerIndex("Equal")).toBe(11);
    expect(speakerIndex("Enter")).toBeNull();
  });
});
