// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { publicClipboard } from "./clipboard.ts";
import { emptyMeeting, parseEntry, type Entry } from "./meeting.ts";
describe("public structured clipboard", () => {
  it("preserves headings, bold speakers and multiline tables while excluding private entries", () => {
    const result = publicClipboard({
      ...emptyMeeting(),
      title: "합성 회의",
      speakers: ["가상 화자"],
      place: "가상 장소",
      entries: [
        "# 첫 안건",
        "첫 줄\n둘째 줄",
        "! 결정 <예시>",
        "* 자료 준비 @가상담당 ~내일",
        "// 비공개 비밀",
        "# 빈 안건",
      ].map((raw, i) => parseEntry(raw, ["가상 화자"], "가상 화자", String(i)) as Entry),
    });
    expect(result.plainText).toContain("첫 줄\n");
    expect(JSON.stringify(result)).not.toContain("비공개 비밀");
    expect(result.blocks).toContainEqual({ kind: "heading", level: 1, runs: [{ text: "합성 회의" }] });
    expect(result.blocks).toContainEqual({ kind: "paragraph", runs: [{ text: "기록된 발언 없음" }] });
    const rows = result.blocks.flatMap((block) => (block.kind === "table" ? block.rows : []));
    expect(rows.flat()).toContainEqual({ runs: [{ text: "가상 화자", bold: true }] });
    expect(rows.flat()).toContainEqual({ runs: [{ text: "[발언] " }, { text: "첫 줄\n둘째 줄" }] });
    expect(rows).toContainEqual([
      { runs: [{ text: "가상담당" }] },
      { runs: [{ text: "자료 준비" }] },
      { runs: [{ text: "내일" }] },
    ]);
  });
});
