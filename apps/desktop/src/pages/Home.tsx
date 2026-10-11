// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Deck home (design-system.md §1): greeting and search, favorites, then every tool grouped by
// category. Category pages and searches show one grid. Each card has a star toggle for favorites,
// staggers in when motion is on (UI-009) and carries resolver badges (versioning.md §3).
import { Badge, Button, SearchBox, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { AppsRegular, StarFilled, StarRegular } from "@fluentui/react-icons";
import { Body, BodyStrong, Caption, EmptyState, Subtitle, deckTokens } from "@deck/ui";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_ICONS, CATEGORY_ORDER } from "../categories.tsx";
import type { Category } from "../generated/Category.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { CATEGORY_LABELS, STATE_BADGES } from "../labels.ts";

/** Cards after this many appear together instead of waiting for their turn. */
const STAGGER_LIMIT = 8;

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  // Greeting on the left, search on the right; the search drops below on narrow windows.
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: deckTokens.itemGap,
  },
  heading: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, minWidth: 0 },
  search: { width: "min(100%, 320px)" },
  section: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
    gap: deckTokens.itemGap,
  },
  // Grid cell holding the card and its star toggle, which cannot nest inside the card button.
  cell: { position: "relative", minWidth: 0 },
  // Same surface as SettingsCard (WinUI card brushes). Large icon on the left, text on the right,
  // pinned to the top so every card in a row lines up regardless of description length.
  card: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    textAlign: "start",
    whiteSpace: "normal",
    width: "100%",
    height: "100%",
    minWidth: 0,
    minHeight: deckTokens.cardMinHeight,
    padding: deckTokens.itemGap,
    // Room for the star toggle in the top-right corner.
    paddingInlineEnd: `calc(${tokens.spacingHorizontalXXL} + ${tokens.spacingHorizontalS})`,
    gap: deckTokens.inlineGap,
    fontWeight: tokens.fontWeightRegular,
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    ":hover": {
      backgroundColor: deckTokens.cardFillHover,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1Hover}`,
    },
    ":hover:active": {
      backgroundColor: deckTokens.cardFill,
      border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    },
  },
  // Lift on hover, settle on press (design-system.md §1 셸 모션). Transform only (UI-009). Applied
  // to the cell so the star moves with its card.
  cellMotion: {
    transitionProperty: "transform",
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    ":hover": { transform: `translateY(${deckTokens.motionCardLift})` },
    ":hover:active": { transform: `scale(${deckTokens.motionPressScale})` },
  },
  // "backwards" fill: the start frame holds during the stagger delay, and the finished animation
  // stops overriding the hover transform.
  cellEnter: {
    animationName: {
      from: { opacity: 0, transform: `translateY(calc(${deckTokens.motionPageOffset} / 2))` },
      to: { opacity: 1, transform: "none" },
    },
    animationDuration: tokens.durationGentle,
    animationTimingFunction: tokens.curveDecelerateMid,
    animationFillMode: "backwards",
  },
  // Module icon shown large; tools without one fall back to their category glyph.
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: deckTokens.cardIconSize,
    height: deckTokens.cardIconSize,
    color: tokens.colorNeutralForeground2,
    fontSize: deckTokens.cardIconSize,
  },
  iconImage: { width: "100%", height: "100%" },
  favoritesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 220px), 1fr))",
    gap: tokens.spacingVerticalS,
  },
  compactCard: { minHeight: deckTokens.listItemHeight, alignItems: "center" },
  compactIcon: { width: tokens.fontSizeBase600, height: tokens.fontSizeBase600, fontSize: tokens.fontSizeBase600 },
  text: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, minWidth: 0, flexGrow: 1 },
  star: { position: "absolute", top: tokens.spacingVerticalS, insetInlineEnd: tokens.spacingHorizontalS },
  // Colors sit on the glyph itself so Fluent's hover/pressed icon colors cannot repaint the star.
  starOff: { color: tokens.colorNeutralForeground3 },
  starOn: { color: tokens.colorPaletteMarigoldForeground1 },
  // Two lines at most so rows keep one height; the full text is in the tooltip.
  description: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
  },
  badges: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
});

/** Time-of-day greeting for the deck home (UI-007 해요체). */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 11) return "좋은 아침이에요";
  if (hour >= 11 && hour < 17) return "오늘 수업도 힘내세요";
  if (hour >= 17 && hour < 22) return "오늘도 수고 많으셨어요";
  return "늦은 시간까지 수고 많으세요";
}

const DATE_FORMAT = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" });

export interface HomeProps {
  modules: ModuleEntry[];
  /** Restrict to one category. */
  category?: Category;
  dev: boolean;
  /** Favorite module ids in the order they were starred. */
  favorites?: string[];
  /** Tools added since the previous launch; they get a "새 도구" badge. */
  fresh?: ReadonlySet<string>;
  /** Plays card motion (design-system.md §1 셸 모션). */
  motion?: boolean;
  /** Clock for the greeting and date; tests pass a fixed one. */
  now?: Date;
  onOpen(id: string): void;
  onNeedsUpdate(): void;
  /** Stars or unstars a tool; without it cards have no star toggle. */
  onToggleFavorite?(id: string): void;
}

export function Home(props: HomeProps) {
  // A category change begins a fresh search, including transitions from the deck home.
  return <CategoryHome key={props.category ?? "all"} {...props} />;
}

const NO_IDS: string[] = [];
const NO_FRESH: ReadonlySet<string> = new Set();

function CategoryHome({
  modules,
  category,
  dev,
  favorites = NO_IDS,
  fresh = NO_FRESH,
  motion = false,
  now,
  onOpen,
  onNeedsUpdate,
  onToggleFavorite,
}: HomeProps) {
  const s = useStyles();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [clock] = useState(() => now ?? new Date());

  // Ctrl+F jumps to the search box instead of the WebView find bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const listed = useMemo(
    () =>
      modules
        .filter((m) => dev || m.resolution.state !== "invalid")
        .filter((m) => category === undefined || m.manifest?.category === category),
    [modules, category, dev],
  );
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q === ""
        ? listed
        : listed.filter((m) => `${m.manifest?.name ?? ""} ${m.manifest?.description ?? ""}`.toLowerCase().includes(q)),
    [listed, q],
  );
  const dashboard = category === undefined && q === "";

  // Running index across sections so the stagger flows down the whole page.
  let order = 0;
  const card = (m: ModuleEntry, compact = false) => (
    <ModuleCard
      key={m.resolution.id}
      entry={m}
      index={order++}
      favorite={favorites.includes(m.resolution.id)}
      fresh={fresh.has(m.resolution.id)}
      motion={motion}
      compact={compact}
      onOpen={onOpen}
      onNeedsUpdate={onNeedsUpdate}
      {...(onToggleFavorite === undefined ? {} : { onToggleFavorite })}
    />
  );

  const byId = new Map(listed.map((m) => [m.resolution.id, m]));
  const starred = dashboard ? favorites.flatMap((id) => byId.get(id) ?? []) : [];
  const sections: { key: string; label: string; items: ModuleEntry[] }[] = dashboard
    ? [
        ...CATEGORY_ORDER.map((c) => ({
          key: c,
          label: CATEGORY_LABELS[c],
          items: listed.filter((m) => m.manifest?.category === c),
        })),
        // Invalid modules have no manifest and therefore no category (dev builds only).
        { key: "other", label: "기타", items: listed.filter((m) => m.manifest === null) },
      ].filter((sec) => sec.items.length > 0)
    : [];

  return (
    <div className={s.page}>
      <header className={s.header}>
        {category === undefined ? (
          <div className={s.heading}>
            <Caption secondary>{DATE_FORMAT.format(clock)}</Caption>
            <Subtitle as="h1">{greeting(clock.getHours())}</Subtitle>
          </div>
        ) : (
          <Subtitle as="h1">{CATEGORY_LABELS[category]}</Subtitle>
        )}
        <SearchBox
          input={{ ref: searchRef }}
          className={s.search}
          placeholder="도구 검색"
          aria-label="도구 검색"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
        />
      </header>
      {matches.length === 0 ? (
        <EmptyState
          icon={<AppsRegular />}
          title={q === "" ? "아직 설치된 도구가 없어요" : "검색 결과가 없어요"}
          description={q === "" ? "앱을 업데이트하면 새 도구가 추가돼요." : "다른 단어로 검색해 보세요."}
        />
      ) : dashboard ? (
        <>
          {starred.length > 0 && (
            <section className={s.section} aria-labelledby="deck-favorites">
              <BodyStrong as="h2" id="deck-favorites">
                즐겨찾기
              </BodyStrong>
              <div className={s.favoritesGrid}>{starred.map((m) => card(m, true))}</div>
            </section>
          )}
          {sections.map((sec) => (
            <section key={sec.key} className={s.section} aria-labelledby={`deck-${sec.key}`}>
              <BodyStrong as="h2" id={`deck-${sec.key}`}>
                {sec.label}
              </BodyStrong>
              <div className={s.grid}>{sec.items.map((m) => card(m))}</div>
            </section>
          ))}
        </>
      ) : (
        <div className={s.grid}>{matches.map((m) => card(m))}</div>
      )}
    </div>
  );
}

interface ModuleCardProps {
  entry: ModuleEntry;
  index: number;
  favorite: boolean;
  fresh: boolean;
  motion: boolean;
  compact: boolean;
  onOpen(id: string): void;
  onNeedsUpdate(): void;
  onToggleFavorite?(id: string): void;
}

function ModuleCard({
  entry: m,
  index,
  favorite,
  fresh,
  motion,
  compact,
  onOpen,
  onNeedsUpdate,
  onToggleFavorite,
}: ModuleCardProps) {
  const s = useStyles();
  const id = m.resolution.id;
  const name = m.manifest?.name ?? id;
  const badge = STATE_BADGES[m.resolution.state];
  const runnable = m.entryUrl !== null;
  const category = m.manifest?.category;
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const delay: CSSProperties | undefined = motion
    ? {
        animationDelay: `calc(${deckTokens.motionStagger} * ${Math.min(index, STAGGER_LIMIT)})`,
      }
    : undefined;

  return (
    <div className={mergeClasses(s.cell, motion && s.cellMotion, motion && s.cellEnter)} style={delay}>
      <Tooltip content={m.manifest?.description ?? name} relationship="description" withArrow>
        <Button
          className={mergeClasses(s.card, compact && s.compactCard)}
          onClick={() => (runnable ? onOpen(id) : onNeedsUpdate())}
          aria-label={`${name} ${runnable ? "열기" : "업데이트 확인"}`}
        >
          <span className={mergeClasses(s.icon, compact && s.compactIcon)}>
            {m.iconUrl !== null && failedIconUrl !== m.iconUrl ? (
              <img className={s.iconImage} src={m.iconUrl} alt="" onError={() => setFailedIconUrl(m.iconUrl)} />
            ) : (
              category !== undefined && CATEGORY_ICONS[category]
            )}
          </span>
          <span className={s.text}>
            <BodyStrong>{name}</BodyStrong>
            {!compact && (
              <span className={s.description}>
                <Body secondary>{m.manifest?.description ?? ""}</Body>
              </span>
            )}
            {(fresh || badge !== null) && (
              <span className={s.badges}>
                {fresh && (
                  <Badge appearance="filled" color="brand">
                    새 도구
                  </Badge>
                )}
                {badge !== null && (
                  <Badge appearance="tint" color={m.resolution.state === "invalid" ? "danger" : "warning"}>
                    {badge}
                  </Badge>
                )}
              </span>
            )}
          </span>
        </Button>
      </Tooltip>
      {onToggleFavorite !== undefined && (
        <Button
          className={s.star}
          appearance="subtle"
          size="small"
          aria-pressed={favorite}
          icon={favorite ? <StarFilled className={s.starOn} /> : <StarRegular className={s.starOff} />}
          aria-label={`${name} 즐겨찾기`}
          title={favorite ? "즐겨찾기에서 빼기" : "즐겨찾기에 추가"}
          onClick={() => onToggleFavorite(id)}
        />
      )}
    </div>
  );
}
