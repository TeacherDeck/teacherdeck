// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// About / credits = GPLv3 Appropriate Legal Notices (design-system.md §5).
// GEN-007: never remove or weaken the attribution below; About.test.tsx guards it.
import { Body1, Caption1, Link, Subtitle2, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { SettingsExpander, deckTokens } from "@deck/ui";
import licenseText from "../../../../LICENSE?raw";
import additionalTerms from "../../../../LICENSE-ADDITIONAL-TERMS?raw";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import thirdParty from "../generated/third-party.json" with { type: "json" };

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, padding: deckTokens.pagePadding },
  block: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.layer,
  },
  pre: { whiteSpace: "pre-wrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, maxHeight: "50vh", overflowY: "auto" },
});

/** The 7(b) attribution line, taken verbatim from LICENSE-ADDITIONAL-TERMS. */
export function attributionLine(terms: string): string {
  const m = /"([^"]*Original authors:[^"]*)"/.exec(terms.replace(/\s*\n\s*/g, " "));
  return m?.[1] ?? "";
}

export interface ModuleCredit {
  id: string;
  name: string;
  version: string;
  authors: string[];
}

/** Module authors aggregated from manifests (MOD-012). */
export function moduleCredits(modules: ModuleEntry[]): ModuleCredit[] {
  return modules.flatMap((m) =>
    m.manifest === null
      ? []
      : [{ id: m.resolution.id, name: m.manifest.name, version: m.manifest.version, authors: m.manifest.authors.map((a) => a.name) }],
  );
}

export interface AboutProps {
  appVersion: string;
  modules: ModuleEntry[];
}

export function About({ appVersion, modules }: AboutProps) {
  const s = useStyles();
  const credits = moduleCredits(modules);
  return (
    <div className={s.page}>
      <Title3 as="h1">정보</Title3>
      <section className={s.block} aria-label="앱 정보">
        <Subtitle2>TeacherDeck {appVersion}</Subtitle2>
        <Body1>{attributionLine(additionalTerms)}</Body1>
        <Caption1>Copyright (C) 2026 신민성, 정영주</Caption1>
        <Body1>
          이 프로그램은 GNU 일반 공중 사용 허가서 3판(GPL-3.0-only)과 제7조(b) 추가조항에 따라 배포돼요. 이
          프로그램은 어떠한 보증도 없이 제공돼요.
        </Body1>
        <Link href="https://github.com/TeacherDeck" target="_blank" rel="noreferrer">
          소스 코드
        </Link>
      </section>

      <section className={s.block} aria-label="도구 저자">
        <Subtitle2>도구 저자</Subtitle2>
        {credits.length === 0 ? (
          <Body1>설치된 도구가 없어요.</Body1>
        ) : (
          credits.map((c) => (
            <Body1 key={c.id}>
              {c.name} {c.version} — {c.authors.join(", ")}
            </Body1>
          ))
        )}
      </section>

      <SettingsExpander header="라이선스 전문(GPL-3.0)" description="GNU General Public License v3.0">
        <pre className={s.pre}>{licenseText}</pre>
      </SettingsExpander>
      <SettingsExpander header="추가조항(제7조(b))" description="저자 표기 유지 조건">
        <pre className={s.pre}>{additionalTerms}</pre>
      </SettingsExpander>
      <SettingsExpander header="오픈소스 라이선스" description={`이 앱에 포함된 구성 요소 ${thirdParty.length}개`}>
        <Table size="small" aria-label="오픈소스 라이선스">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>이름</TableHeaderCell>
              <TableHeaderCell>버전</TableHeaderCell>
              <TableHeaderCell>라이선스</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {thirdParty.map((t) => (
              <TableRow key={`${t.source}:${t.name}@${t.version}`}>
                <TableCell>{t.name}</TableCell>
                <TableCell>{t.version}</TableCell>
                <TableCell>{t.license}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SettingsExpander>
    </div>
  );
}
