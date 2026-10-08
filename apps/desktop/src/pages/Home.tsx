// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Deck home: module cards, search and resolver badges (design-system.md §1).
import { Badge, Body1, Caption1, Card, SearchBox, Title3, makeStyles, tokens } from "@fluentui/react-components";
import { AppsRegular } from "@fluentui/react-icons";
import { EmptyState, deckTokens } from "@deck/ui";
import { useMemo, useState } from "react";
import type { Category } from "../generated/Category.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { CATEGORY_LABELS, STATE_BADGES } from "../labels.ts";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: deckTokens.itemGap },
  card: { backgroundColor: deckTokens.layer, padding: tokens.spacingHorizontalL, gap: tokens.spacingVerticalS },
  head: { display: "flex", alignItems: "center", gap: deckTokens.inlineGap },
  icon: { width: tokens.fontSizeHero800, height: tokens.fontSizeHero800 },
  search: { maxWidth: "420px" },
});

export interface HomeProps {
  modules: ModuleEntry[];
  /** Restrict to one category. */
  category?: Category;
  dev: boolean;
  onOpen(id: string): void;
  onNeedsUpdate(): void;
}

export function Home({ modules, category, dev, onOpen, onNeedsUpdate }: HomeProps) {
  const s = useStyles();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return modules
      .filter((m) => dev || m.resolution.state !== "invalid")
      .filter((m) => category === undefined || m.manifest?.category === category)
      .filter((m) => q === "" || `${m.manifest?.name ?? ""} ${m.manifest?.description ?? ""}`.toLowerCase().includes(q));
  }, [modules, category, dev, query]);

  return (
    <div className={s.page}>
      <Title3 as="h1">{category === undefined ? "덱" : CATEGORY_LABELS[category]}</Title3>
      <SearchBox
        className={s.search}
        placeholder="도구 검색"
        aria-label="도구 검색"
        value={query}
        onChange={(_, d) => setQuery(d.value)}
      />
      {visible.length === 0 ? (
        <EmptyState
          icon={<AppsRegular />}
          title={query === "" ? "아직 설치된 도구가 없어요" : "검색 결과가 없어요"}
          description={query === "" ? "앱을 업데이트하면 새 도구가 추가돼요." : "다른 단어로 검색해 보세요."}
        />
      ) : (
        <div className={s.grid}>
          {visible.map((m) => {
            const badge = STATE_BADGES[m.resolution.state];
            const runnable = m.entryUrl !== null;
            return (
              <Card
                key={m.resolution.id}
                className={s.card}
                onClick={() => (runnable ? onOpen(m.resolution.id) : onNeedsUpdate())}
                aria-label={`${m.manifest?.name ?? m.resolution.id} 열기`}
              >
                <div className={s.head}>
                  {m.iconUrl !== null && <img className={s.icon} src={m.iconUrl} alt="" />}
                  <Body1>{m.manifest?.name ?? m.resolution.id}</Body1>
                </div>
                <Caption1>{m.manifest?.description ?? ""}</Caption1>
                {badge !== null && (
                  <Badge appearance="tint" color={m.resolution.state === "invalid" ? "danger" : "warning"}>
                    {badge}
                  </Badge>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
