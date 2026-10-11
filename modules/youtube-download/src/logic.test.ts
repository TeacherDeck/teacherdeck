// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { expect, it } from "vitest";
import { byteLabel, errorLabel, progress, stageLabel, terminal, videoUrl } from "./logic.ts";
it("normalizes only one public video and ignores playlist selection parameters", () => {
  for (const url of [
    "https://youtu.be/ABCDEFGHI_1?si=synthetic",
    " https://www.youtube.com/watch?v=ABCDEFGHI_1&list=synthetic ",
    "https://m.youtube.com/shorts/ABCDEFGHI_1",
    "https://youtube.com/embed/ABCDEFGHI_1",
    "https://youtube.com/live/ABCDEFGHI_1#t=20",
  ])
    expect(videoUrl(url)).toBe("https://www.youtube.com/watch?v=ABCDEFGHI_1");
});
it("rejects arbitrary hosts, credentials, encoded IDs, duplicate videos and malformed addresses", () => {
  for (const url of [
    "http://youtube.com/watch?v=ABCDEFGHI_1",
    "https://youtube.com.invalid/watch?v=ABCDEFGHI_1",
    "https://youtube.com@invalid/watch?v=ABCDEFGHI_1",
    "https://youtube.com:443/watch?v=ABCDEFGHI_1",
    "https://youtu.be/ABCDEFGHI_1/extra",
    "https://youtube.com/watch?v=ABCDEFGHI_1&v=BCDEFGHIJ_2",
    "https://youtube.com/watch?v=ABCDEFGHI%5f1",
    "https://youtube.com/watch?v=ABCDEFGHI_1?extra",
    "https://youtube.com/playlist?list=synthetic",
    "https://youtu.be/ABCDEFGHI_1\n--cookies",
    "file:///synthetic",
    "https://youtu.be/ABCDEFGHI_1?" + "x".repeat(2048),
  ])
    expect(videoUrl(url)).toBeNull();
});
it("keeps unknown progress indeterminate and clamps displayed percentages", () => {
  expect(progress(10, undefined)).toBeUndefined();
  expect(progress(20, 40)).toBe(50);
  expect(progress(60, 40)).toBe(100);
  expect(progress(-4, 40)).toBe(0);
  expect(byteLabel(1024 * 1024)).toBe("1.0 MiB");
});
it("distinguishes preparation, validation and terminal states without exposing engine errors", () => {
  expect(terminal("preparing-engine")).toBe(false);
  expect(terminal("validating")).toBe(false);
  expect(terminal("complete")).toBe(true);
  expect(terminal("cancelled")).toBe(true);
  expect(terminal("failed")).toBe(true);
  expect(stageLabel("preparing-engine")).toContain("처음에는");
  expect(stageLabel("downloading")).toContain("MP4로 합치고");
  expect(errorLabel("TIMEOUT")).toContain("30분");
  expect(errorLabel("INTERNAL")).not.toContain("INTERNAL");
});
it("shows only exact fixed host guidance with the matching error code", () => {
  const guidance = [
    "이 영상은 YouTube가 로그인이나 접근 확인을 요구하고 있어요. 로그인·쿠키 연동은 지원하지 않으니 다른 공개 영상을 선택해 주세요.",
    "인터넷 보안 인증서를 확인하지 못했어요. PC 날짜와 학교망 연결 상태를 확인해 주세요.",
    "YouTube에 연결하지 못했어요. 인터넷 연결이나 학교망 차단 여부를 확인해 주세요.",
    "영상을 받지 못했어요. 공개 영상인지와 인터넷 연결을 확인해 주세요. 지원하는 MP4 형식이 없는 영상은 받을 수 없어요.",
  ];
  for (const message of guidance) {
    expect(errorLabel("CAPABILITY_UNAVAILABLE", message)).toBe(message);
    expect(errorLabel("INTERNAL", message)).not.toBe(message);
    expect(errorLabel("CAPABILITY_UNAVAILABLE", message + " 합성 내부 상세")).not.toContain("합성 내부 상세");
  }
  const limit = "영상 크기가 512MiB를 넘어요. 더 작은 영상을 선택해 주세요.";
  expect(errorLabel("INVALID_ARGS", limit)).toBe(limit);
  expect(errorLabel("CAPABILITY_UNAVAILABLE", limit)).not.toBe(limit);
  expect(errorLabel("CAPABILITY_UNAVAILABLE", "합성 도움 프로세스 원문")).not.toContain("합성 도움 프로세스 원문");
});
