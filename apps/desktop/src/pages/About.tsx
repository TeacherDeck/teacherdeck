// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// About / credits = GPLv3 Appropriate Legal Notices (design-system.md §5).
// GEN-007: never remove or weaken the attribution below; About.test.tsx guards it.
import {
  Body1,
  Caption1,
  Link,
  Subtitle2,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { SettingsExpander, Subtitle, deckTokens } from "@deck/ui";
import licenseText from "../../../../LICENSE?raw";
import additionalTerms from "../../../../LICENSE-ADDITIONAL-TERMS?raw";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import thirdParty from "../generated/third-party.json" with { type: "json" };
import type { ModuleNotices, NoticeComponent, NoticeGroup } from "./moduleNotices.ts";

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
  notices: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  pre: {
    whiteSpace: "pre-wrap",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    maxHeight: "50vh",
    overflowY: "auto",
  },
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
      : [
          {
            id: m.resolution.id,
            name: m.manifest.name,
            version: m.manifest.version,
            authors: m.manifest.authors.map((a) => a.name),
          },
        ],
  );
}

/** "427개 · MIT 210 · Apache-2.0 120 · 외 5종": component count and the most common licenses. */
export function licenseSummary(components: readonly { license: string }[], top = 3): string {
  const counts = new Map<string, number>();
  for (const c of components) counts.set(c.license, (counts.get(c.license) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
  const parts = ranked.slice(0, top).map(([license, n]) => `${license} ${n}`);
  if (ranked.length > top) parts.push(`외 ${ranked.length - top}종`);
  return [`${components.length}개`, ...parts].join(" · ");
}

function ComponentTable({
  label,
  components,
}: {
  label: string;
  components: readonly { name: string; version: string; license: string; note?: string; source?: string }[];
}) {
  return (
    <Table size="small" aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHeaderCell>이름</TableHeaderCell>
          <TableHeaderCell>버전</TableHeaderCell>
          <TableHeaderCell>라이선스</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {components.map((c) => (
          <TableRow key={`${c.source ?? ""}:${c.name}@${c.version}`}>
            <TableCell>
              {c.name}
              {c.note !== undefined && <Caption1> · {c.note}</Caption1>}
            </TableCell>
            <TableCell>{c.version}</TableCell>
            <TableCell>{c.license}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function OriginalNotices({ component, texts }: { component: NoticeComponent; texts: ModuleNotices["texts"] }) {
  const s = useStyles();
  return (
    <SettingsExpander
      header={`${component.name} ${component.version} 원문 고지`}
      description={`${component.license} · 원문 ${component.texts.length}개`}
    >
      {component.texts.map((key) => {
        const text = texts[key];
        return text === undefined ? null : (
          <div key={key} className={s.notices}>
            <Caption1>{text.title}</Caption1>
            <pre className={s.pre}>{text.text}</pre>
          </div>
        );
      })}
    </SettingsExpander>
  );
}

function groupDescription(group: NoticeGroup, installed: string | undefined): string {
  const basis =
    group.version === null
      ? ""
      : installed !== undefined && installed !== group.version
        ? ` · ${group.version} 기준 고지`
        : "";
  return `${licenseSummary(group.components)}${basis}`;
}

/** Per-tool notices (ADR-0030). Loaded only when the About screen opens. */
function ToolNotices({ modules }: { modules: ModuleEntry[] }) {
  const [notices, setNotices] = useState<ModuleNotices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import("../generated/module-notices.json").then(
      (m) => live && setNotices(m.default as ModuleNotices),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <Body1>도구별 라이선스를 불러오지 못했어요. 앱을 다시 열어 주세요.</Body1>;
  if (notices === null) return <Caption1>도구별 라이선스를 불러오는 중이에요.</Caption1>;
  const installed = new Map(
    modules.flatMap((m) => (m.manifest === null ? [] : [[m.resolution.id, m.manifest.version]])),
  );
  const own = notices.groups.filter((g) => g.components.length > 0);
  const commonOnly = notices.groups.filter((g) => g.components.length === 0);
  return (
    <>
      {own.map((group) => (
        <SettingsExpander
          key={group.id}
          header={group.name}
          description={groupDescription(group, installed.get(group.id))}
        >
          {group.note !== undefined && <Caption1>{group.note}</Caption1>}
          <ComponentTable label={`${group.name} 오픈소스 라이선스`} components={group.components} />
          {group.shared > 0 && <Caption1>앱 공통의 화면 구성 요소 {group.shared}개도 함께 써요.</Caption1>}
          {group.components
            .filter((c) => c.texts.length > 0)
            .map((c) => (
              <OriginalNotices key={`${c.name}@${c.version}`} component={c} texts={notices.texts} />
            ))}
        </SettingsExpander>
      ))}
      {commonOnly.length > 0 && (
        <Caption1>{commonOnly.map((g) => g.name).join(", ")}은 앱 공통 구성 요소만 써요.</Caption1>
      )}
    </>
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
      <Subtitle as="h1">정보</Subtitle>
      <section className={s.block} aria-label="앱 정보">
        <Subtitle2>TeacherDeck {appVersion}</Subtitle2>
        <Body1>{attributionLine(additionalTerms)}</Body1>
        <Caption1>Copyright (C) 2026 신민성, 정영주</Caption1>
        <Body1>
          이 프로그램은 GNU 일반 공중 사용 허가서 3판(GPL-3.0-only)과 제7조(b) 추가조항에 따라 배포돼요. 이 프로그램은
          어떠한 보증도 없이 제공돼요.
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
      <section className={s.notices} aria-label="오픈소스 라이선스">
        <Subtitle2>오픈소스 라이선스</Subtitle2>
        <SettingsExpander header="앱 공통" description={`셸·호스트 구성 요소 ${licenseSummary(thirdParty)}`}>
          <ComponentTable label="앱 공통 오픈소스 라이선스" components={thirdParty} />
        </SettingsExpander>
        <ToolNotices modules={modules} />
      </section>
    </div>
  );
}
