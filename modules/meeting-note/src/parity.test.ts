// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { type Entry, emptyMeeting, parseEntry } from "./meeting.ts";
import { activeSpeakers, identifySpeakers, reviseSpeakers } from "./speakers.ts";
import { mergeRosters } from "./roster-files.ts";
import { publicDuration, structuredExport } from "./export.ts";
describe("original feature parity", () => {
  it("keeps duplicate people and recorded departed speakers independent", () => {
    const meeting = identifySpeakers({
      ...emptyMeeting(),
      speakers: ["가상 동명", "가상 동명"],
      selected: "가상 동명",
    });
    meeting.entries = [
      parseEntry(
        "2 둘째 발언",
        meeting.speakers,
        meeting.selected,
        "a",
        meeting.speakerIds,
        meeting.selectedId,
      ) as Entry,
    ];
    const next = reviseSpeakers(meeting, ["가상 동명"]);
    expect(next.speakers).toEqual(["가상 동명", "가상 동명"]);
    expect(next.entries[0]?.speakerId).toBe(next.speakerIds?.[1]);
    expect(next.speakerIds?.[0]).not.toBe(next.speakerIds?.[1]);
    expect(activeSpeakers(next)).toEqual(["가상 동명"]);
    const restored = identifySpeakers(next);
    expect(activeSpeakers(restored)).toEqual(["가상 동명"]);
    const editedAgain = reviseSpeakers(restored, activeSpeakers(restored));
    expect(editedAgain.speakers).toEqual(next.speakers);
    expect(editedAgain.entries[0]?.speakerId).toBe(next.entries[0]?.speakerId);
  });
  it("updates inherited-object-like committee names and refuses overflow without truncation", () => {
    const old = [{ name: "constructor", people: ["가상 A"], title: "", place: "" }];
    expect(mergeRosters(old, { presets: [{ name: "constructor", people: ["가상 B"] }] })).toEqual([
      { ...old[0], people: ["가상 B"] },
    ]);
    expect(old[0]?.people).toEqual(["가상 A"]);
    expect(() => mergeRosters([], [{ name: "잘못된 명단", people: [null] }])).toThrow("INVALID_ROSTER");
  });
  it("excludes private metadata and escapes HTML, multiline action tables and empty agendas", () => {
    const meeting = {
      ...emptyMeeting(),
      startedAt: "2026-01-01T00:00:00Z",
      entries: [
        { ...(parseEntry("# 빈 안건", [], "", "a") as Entry), timestamp: "2026-01-01T00:00:00Z" },
        { ...(parseEntry("# 다음 안건", [], "", "b") as Entry), timestamp: "2026-01-01T00:01:00Z" },
        {
          ...(parseEntry("* <script>준비|자료\n둘째줄 @가상담당 ~내일", [], "", "c") as Entry),
          timestamp: "2026-01-01T00:10:00Z",
        },
        { ...(parseEntry("// 숨김", [], "", "d") as Entry), timestamp: "2026-01-01T01:00:00Z" },
      ],
    };
    expect(publicDuration(meeting)).toContain("(10분)");
    const html = structuredExport(meeting, "html");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("기록된 발언 없음");
    expect(html).not.toContain("숨김");
    const md = structuredExport(meeting, "md");
    expect(md).toContain("준비\\|자료<br>둘째줄");
  });
});
