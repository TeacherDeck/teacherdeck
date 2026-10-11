// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// SmartFileRenamer's date/category priorities, with explicit inference and user-keyword precedence.
function validMonth(matches: Iterable<RegExpMatchArray>): string {
  for (const match of matches) {
    const value = Number(match[1]);
    if (value >= 1 && value <= 12) return String(value).padStart(2, "0");
  }
  return "";
}
export function documentDate(content: string): { year: string; month: string; inferred: boolean } {
  const schoolYear = /(20\d{2})\s*학년도/.exec(content);
  const year = schoolYear ? `${schoolYear[1]}학년도` : (/\b(20\d{2})(?:\s*년|[.\-/]|\b)/.exec(content)?.[1] ?? "");
  for (const pattern of [
    /(\d{1,2})\s*월\s*(?:고\d|중\d|전국연합|모의|학력|평가|고사|시험)/g,
    /(?:고\d|중\d|모의)\s*(\d{1,2})\s*월/g,
  ]) {
    const month = validMonth(content.matchAll(pattern));
    if (month) return { year, month, inferred: false };
  }
  // Remove whole dates first: regex backtracking must not turn an editing day into a month.
  const withoutDays = content
    .replace(/(?:20\d{2}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}(?!\d)/g, " ");
  const month =
    validMonth(withoutDays.matchAll(/(\d{1,2})\s*월/g)) ||
    validMonth(withoutDays.matchAll(/20\d{2}\s*[.\-/]\s*(\d{1,2})(?![\d.\-/])/g));
  if (month) return { year, month, inferred: false };
  const compact = withoutDays.replace(/\s/g, "");
  const semester = /([12])학기(?:(중간|기말)(?:고사)?)?/.exec(compact);
  if (semester) {
    const months: Record<string, string> =
      semester[1] === "1" ? { 중간: "04", 기말: "06" } : { 중간: "10", 기말: "12" };
    return { year, month: months[semester[2] ?? ""] ?? (semester[1] === "1" ? "03" : "09"), inferred: true };
  }
  const quarter = /([1-4])(?:\/4)?분기/.exec(compact);
  const inferred = quarter
    ? String(Number(quarter[1]) * 3).padStart(2, "0")
    : compact.includes("상반기")
      ? "06"
      : compact.includes("하반기")
        ? "12"
        : "";
  return { year, month: inferred, inferred: Boolean(inferred) };
}
const SUBJECTS: Record<string, string[]> = {
  과학: ["통합과학", "과학탐구", "생명과학", "지구과학", "물리학", "물리", "화학", "생물"],
  수학: ["공통수학", "확률과통계", "미적분", "고등수학", "중등수학", "기하", "대수", "수학"],
  사회: [
    "통합사회",
    "사회탐구",
    "사회문화",
    "생활과윤리",
    "윤리와사상",
    "한국지리",
    "세계지리",
    "법과정치",
    "정치",
    "경제",
    "윤리",
  ],
  역사: ["한국근현대사", "세계근현대사", "동아시아사", "한국사", "세계사", "역사"],
  국어: ["화법과작문", "언어와매체", "현대문학", "고전문학", "문학", "독서", "국어"],
  영어: ["영문법", "영어회화", "영어독해", "영어듣기", "영작문", "영어"],
  기타: [
    "일본어",
    "중국어",
    "독일어",
    "프랑스어",
    "스페인어",
    "음악",
    "미술",
    "체육",
    "기술가정",
    "정보",
    "한문",
    "논술",
  ],
};
const ALIASES: Record<string, string> = {
  확통: "확률과통계",
  사문: "사회문화",
  생윤: "생활과윤리",
  윤사: "윤리와사상",
  화작: "화법과작문",
  언매: "언어와매체",
  지학: "지구과학",
};
const DOCUMENTS = [
  "모의고사",
  "학력평가",
  "모의평가",
  "수능",
  "중간고사",
  "기말고사",
  "수행평가",
  "형성평가",
  "생활기록부",
  "세부능력",
  "세특",
  "출석부",
  "시간표",
  "교육계획",
  "회의록",
  "가정통신문",
  "실험보고서",
  "탐구보고서",
  "수업자료",
  "학습지",
  "보고서",
  "계획서",
  "안내문",
];
function findSubject(text: string): { main: string; sub: string } | undefined {
  const compact = text.replace(/\s/g, "");
  const choices = Object.entries(SUBJECTS)
    .flatMap(([main, words]) => words.map((word) => ({ main, word })))
    .sort((a, b) => b.word.length - a.word.length);
  for (const { main, word } of choices) {
    const at = compact.indexOf(word);
    if (at >= 0) {
      const suffix = /^(?:II|I|Ⅱ|Ⅰ|[12])(?=$|[^A-Za-z0-9])/.exec(compact.slice(at + word.length))?.[0] ?? "";
      return { main: main === "기타" ? word : main, sub: `${word}${suffix}` };
    }
  }
  for (const [alias, full] of Object.entries(ALIASES)) if (compact.includes(alias)) return findSubject(full);
  return undefined;
}
export function documentCategory(
  content: string,
  keywords: readonly string[],
): { subject: string; main: string; sub: string } {
  const clean = content.replace(
    /대학\s*수학\s*능력\s*시험|수학\s*능력\s*(?:시험|평가)|과학\s*기술|사회\s*과학|자연\s*과학|한국\s*교육\s*과정|교육\s*과정\s*평가\s*원/g,
    " ",
  );
  const custom = keywords.find((keyword) => keyword && clean.includes(keyword));
  let found: ReturnType<typeof findSubject>;
  for (const bracket of clean.matchAll(/[([<【]([^\])>】\n]{2,30})[\])>】]/g)) {
    found = findSubject(bracket[1] ?? "");
    if (found) break;
  }
  if (!found) found = findSubject(clean);
  // Fixed subject periods belong to the CSAT, not an arbitrary school's timetable.
  if (!found && /대학\s*수학\s*능력\s*시험|수능/.test(content)) {
    const period = /(?:제\s*)?([1-3])\s*교시/.exec(content)?.[1];
    if (period)
      found = findSubject(({ "1": "국어", "2": "수학", "3": "영어" } as Record<string, string>)[period] ?? "");
  }
  return {
    subject: custom ?? found?.sub ?? DOCUMENTS.find((word) => content.includes(word)) ?? "",
    main: found?.main ?? "",
    sub: found?.sub ?? "",
  };
}
