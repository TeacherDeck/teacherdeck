// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Page patterns (design-system.md §6), shaped like Windows 11 Settings / PowerToys: a page title,
// group headers, and 4px-stacked cards on Mica. Register every new component in the shell UI gallery
// (apps/desktop/src/pages/Gallery.tsx); a test fails otherwise.
import { Button, createFocusOutlineStyle, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowUploadRegular, ChevronDownRegular, ChevronRightRegular, ChevronUpRegular } from "@fluentui/react-icons";
import type { Deck } from "@deck/sdk";
import { type ReactNode, createContext, useContext, useId, useState } from "react";
import { InfoBar } from "./controls.tsx";
import { deckTokens } from "./tokens/index.ts";
import { Body, BodyStrong, Caption, Subtitle, Title } from "./typography.tsx";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  pageHeader: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  group: { display: "flex", flexDirection: "column", gap: deckTokens.cardGap },
  groupHeader: { paddingBottom: tokens.spacingVerticalS },
  section: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  card: {
    display: "flex",
    alignItems: "center",
    gap: deckTokens.inlineGap,
    minHeight: deckTokens.cardMinHeight,
    boxSizing: "border-box",
    width: "100%",
    paddingInline: deckTokens.cardPadding,
    paddingBlock: tokens.spacingVerticalM,
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    color: tokens.colorNeutralForeground1,
    fontFamily: "inherit",
    textAlign: "start",
  },
  clickable: {
    cursor: "pointer",
    ":hover": { backgroundColor: deckTokens.cardFillHover },
    ":active": { color: tokens.colorNeutralForeground2 },
    ...createFocusOutlineStyle(),
  },
  // Rows inside an expander: no own surface, indented so text lines up with the header text.
  flat: {
    backgroundColor: "transparent",
    border: "none",
    borderRadius: tokens.borderRadiusNone,
    paddingInlineStart: deckTokens.expanderIndent,
  },
  texts: { flexGrow: 1, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, minWidth: 0 },
  icon: { fontSize: tokens.fontSizeBase500, color: tokens.colorNeutralForeground1, display: "flex", flexShrink: 0 },
  action: { display: "flex", alignItems: "center", gap: deckTokens.inlineGap, flexShrink: 0 },
  expander: {
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
  },
  expanderHeader: { backgroundColor: "transparent", border: "none", cursor: "pointer" },
  expanderToggle: {
    display: "flex", alignItems: "center", gap: deckTokens.inlineGap, flexGrow: 1, minWidth: 0,
    padding: 0, border: "none", backgroundColor: "transparent", color: "inherit",
    fontFamily: "inherit", textAlign: "start", cursor: "pointer",
    ...createFocusOutlineStyle(),
  },
  expanderBody: {
    display: "flex",
    flexDirection: "column",
    "& > *": { borderTop: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}` },
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalXXXL,
  },
  emptyIcon: { fontSize: tokens.fontSizeHero800, color: tokens.colorNeutralForeground3, display: "flex" },
  drop: {
    border: `${tokens.strokeWidthThick} dashed ${tokens.colorNeutralStroke1}`,
    borderRadius: deckTokens.cardRadius,
  },
  dropActive: {
    border: `${tokens.strokeWidthThick} dashed ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
  },
});

/* ---------- PageHeader / SettingsGroup ---------- */

export interface PageHeaderProps {
  title: string;
  description?: string;
}

/** Page title (WinUI Title, 28px) with an optional one-line description. */
export function PageHeader({ title, description }: PageHeaderProps) {
  const s = useStyles();
  return (
    <header className={s.pageHeader}>
      <Title as="h1">{title}</Title>
      {description !== undefined && <Body secondary>{description}</Body>}
    </header>
  );
}

export interface SettingsGroupProps {
  /** Group header, e.g. "동작". */
  header: string;
  /** SettingsCard / SettingsExpander items. */
  children: ReactNode;
}

/** Group header plus cards stacked 4px apart (PowerToys settings group). */
export function SettingsGroup({ header, children }: SettingsGroupProps) {
  const s = useStyles();
  return (
    <section className={s.group} aria-label={header}>
      <BodyStrong as="h2" className={s.groupHeader}>
        {header}
      </BodyStrong>
      {children}
    </section>
  );
}

/* ---------- ToolLayout (UI-008, MOD-011) ---------- */

export type ToolStep = "input" | "options" | "preview" | "run" | "result";

export interface ToolLayoutProps {
  title: string;
  description?: string;
  /** Sections in order: input → options → preview → run → result. */
  children: ReactNode;
}

/** Skeleton for batch file tools: 입력 → 옵션 → 미리보기 → 실행 → 결과 (UI-008). */
export function ToolLayout({ title, description, children }: ToolLayoutProps) {
  const s = useStyles();
  return (
    <main className={s.page}>
      <PageHeader title={title} {...(description === undefined ? {} : { description })} />
      {children}
    </main>
  );
}

export interface ToolSectionProps {
  step: ToolStep;
  title: string;
  children: ReactNode;
}

function ToolSection({ step, title, children }: ToolSectionProps) {
  const s = useStyles();
  return (
    <section className={s.section} data-step={step} aria-label={title}>
      <BodyStrong as="h2">{title}</BodyStrong>
      {children}
    </section>
  );
}
ToolLayout.Section = ToolSection;

/* ---------- SettingsCard / SettingsExpander ---------- */

/** True inside a SettingsExpander body: cards render as flat, indented rows. */
const InExpander = createContext(false);

interface CardContent {
  icon?: ReactNode;
  header: string;
  description?: string;
}

export type SettingsCardProps = CardContent &
  (
    | {
        /** Control on the right (ToggleSwitch with showHeader={false}, ComboBox, Button). */
        action?: ReactNode;
        onClick?: never;
      }
    | {
        /** Makes the whole card a button with a chevron (WinUI IsClickEnabled), e.g. to open a page. */
        onClick: () => void;
        action?: never;
      }
  );

function CardTexts({ icon, header, description }: CardContent) {
  const s = useStyles();
  return (
    <>
      {icon !== undefined && (
        <span className={s.icon} aria-hidden>
          {icon}
        </span>
      )}
      <span className={s.texts}>
        <Body>{header}</Body>
        {description !== undefined && <Caption secondary>{description}</Caption>}
      </span>
    </>
  );
}

/** One settings row (WinUI SettingsCard): icon, header, description, control on the right. */
export function SettingsCard({ icon, header, description, action, onClick }: SettingsCardProps) {
  const s = useStyles();
  const flat = useContext(InExpander);
  const texts = <CardTexts {...{ icon, header, ...(description === undefined ? {} : { description }) }} />;
  if (onClick !== undefined) {
    return (
      <button type="button" className={mergeClasses(s.card, s.clickable, flat && s.flat)} onClick={onClick}>
        {texts}
        <span className={s.icon} aria-hidden>
          <ChevronRightRegular />
        </span>
      </button>
    );
  }
  return (
    <div className={mergeClasses(s.card, flat && s.flat)}>
      {texts}
      {action !== undefined && <div className={s.action}>{action}</div>}
    </div>
  );
}

export interface SettingsExpanderProps extends CardContent {
  /** Control in the header, e.g. a ToggleSwitch that enables the whole group. */
  action?: ReactNode;
  defaultExpanded?: boolean;
  /** SettingsCard rows; they render flat and indented. */
  children: ReactNode;
}

/** Expandable group of settings (WinUI SettingsExpander). Click the header or press the chevron. */
export function SettingsExpander({
  icon,
  header,
  description,
  action,
  defaultExpanded = false,
  children,
}: SettingsExpanderProps) {
  const s = useStyles();
  const [open, setOpen] = useState(defaultExpanded);
  const bodyId = useId();
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={s.expander}>
      <div className={mergeClasses(s.card, s.expanderHeader)}>
          <button
            type="button"
            className={s.expanderToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={header}
            onClick={toggle}
          >
            <CardTexts {...{ icon, header, ...(description === undefined ? {} : { description }) }} />
            <span className={s.icon} aria-hidden>{open ? <ChevronUpRegular /> : <ChevronDownRegular />}</span>
          </button>
        {action !== undefined && <div className={s.action}>{action}</div>}
      </div>
      {open && (
        <div id={bodyId} role="group" aria-label={header} className={s.expanderBody}>
          <InExpander.Provider value>{children}</InExpander.Provider>
        </div>
      )}
    </div>
  );
}

/* ---------- EmptyState ---------- */

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** Tell the user what to do next (UI-007). */
  description?: string;
  action?: ReactNode;
}

/** Empty screen that guides the next action (UI-007). */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  const s = useStyles();
  return (
    <div className={s.empty}>
      {icon !== undefined && (
        <span className={s.emptyIcon} aria-hidden>
          {icon}
        </span>
      )}
      <Subtitle>{title}</Subtitle>
      {description !== undefined && <Body secondary>{description}</Body>}
      {action}
    </div>
  );
}

/* ---------- CapabilityGate (MOD-007) ---------- */

export interface CapabilityGateProps {
  deck: Pick<Deck, "has">;
  cap: string;
  /** What the feature is, e.g. "파일 선택". */
  feature: string;
  children: ReactNode;
}

/** Renders children only when the optional capability is available, else an InfoBar (MOD-007). */
export function CapabilityGate({ deck, cap, feature, children }: CapabilityGateProps) {
  if (deck.has(cap)) return <>{children}</>;
  return (
    <InfoBar
      title={`${feature}은(는) 앱 업데이트 후 사용 가능해요`}
      message="설정 > 정보에서 업데이트를 확인해 주세요."
    />
  );
}

/* ---------- DropZone ---------- */

export interface DropZoneProps {
  /** Highlight while files are dragged over the window. */
  active?: boolean;
  title?: string;
  description?: string;
  /** Opens the file picker (fs.pickFiles). */
  onPick?: () => void;
}

/** Drop target visual. Actual drops arrive as the `fs.dropped` event, not DOM drop events. */
export function DropZone({
  active = false,
  title = "파일을 여기에 끌어 놓으세요",
  description,
  onPick,
}: DropZoneProps) {
  const s = useStyles();
  return (
    <div className={mergeClasses(s.drop, active && s.dropActive)}>
      <EmptyState
        icon={<ArrowUploadRegular />}
        title={title}
        {...(description === undefined ? {} : { description })}
        {...(onPick === undefined ? {} : { action: <Button onClick={onPick}>파일 선택</Button> })}
      />
    </div>
  );
}
