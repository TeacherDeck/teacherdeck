// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shared patterns (design-system.md §6). Register every new component in the shell UI gallery
// (apps/desktop/src/pages/Gallery.tsx); a test fails otherwise.
import {
  Body1,
  Button,
  Caption1,
  Card,
  Subtitle2,
  Title3,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowUploadRegular, ChevronDownRegular, ChevronRightRegular, LockClosedRegular } from "@fluentui/react-icons";
import type { Deck } from "@deck/sdk";
import { type ReactNode, useId, useState } from "react";
import { deckTokens } from "./tokens/index.ts";

const useStyles = makeStyles({
  layout: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  header: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: tokens.spacingHorizontalL,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.layer,
  },
  row: { display: "flex", alignItems: "center", gap: deckTokens.inlineGap },
  grow: { flexGrow: 1, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
  icon: { fontSize: tokens.fontSizeBase500, color: tokens.colorNeutralForeground2, display: "flex" },
  card: { padding: tokens.spacingHorizontalL, backgroundColor: deckTokens.layer },
  expanderBody: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    marginTop: tokens.spacingVerticalM,
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
  dropActive: { border: `${tokens.strokeWidthThick} dashed ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
});

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
    <main className={s.layout}>
      <header className={s.header}>
        <Title3 as="h1">{title}</Title3>
        {description !== undefined && <Body1>{description}</Body1>}
      </header>
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
      <Subtitle2 as="h2">{title}</Subtitle2>
      {children}
    </section>
  );
}
ToolLayout.Section = ToolSection;

/* ---------- SettingsCard / SettingsExpander ---------- */

export interface SettingsCardProps {
  icon?: ReactNode;
  header: string;
  description?: string;
  /** Control on the right (switch, dropdown, button). */
  action?: ReactNode;
}

/** One settings row (PowerToys SettingsCard). */
export function SettingsCard({ icon, header, description, action }: SettingsCardProps) {
  const s = useStyles();
  return (
    <Card className={s.card}>
      <div className={s.row}>
        {icon !== undefined && <span className={s.icon}>{icon}</span>}
        <div className={s.grow}>
          <Body1>{header}</Body1>
          {description !== undefined && <Caption1>{description}</Caption1>}
        </div>
        {action}
      </div>
    </Card>
  );
}

export interface SettingsExpanderProps extends Omit<SettingsCardProps, "action"> {
  defaultExpanded?: boolean;
  children: ReactNode;
}

/** Expandable group of settings (PowerToys SettingsExpander). Keyboard: Enter/Space toggles. */
export function SettingsExpander({ icon, header, description, defaultExpanded = false, children }: SettingsExpanderProps) {
  const s = useStyles();
  const [open, setOpen] = useState(defaultExpanded);
  const bodyId = useId();
  return (
    <Card className={s.card}>
      <div className={s.row}>
        {icon !== undefined && <span className={s.icon}>{icon}</span>}
        <div className={s.grow}>
          <Body1>{header}</Body1>
          {description !== undefined && <Caption1>{description}</Caption1>}
        </div>
        <Button
          appearance="subtle"
          icon={open ? <ChevronDownRegular /> : <ChevronRightRegular />}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `${header} 접기` : `${header} 펼치기`}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      {open && (
        <div id={bodyId} className={s.expanderBody}>
          {children}
        </div>
      )}
    </Card>
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
    <div className={s.empty} role="status">
      {icon !== undefined && <span className={s.emptyIcon}>{icon}</span>}
      <Subtitle2>{title}</Subtitle2>
      {description !== undefined && <Body1>{description}</Body1>}
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

/** Renders children only when the optional capability is available (MOD-007). */
export function CapabilityGate({ deck, cap, feature, children }: CapabilityGateProps) {
  if (deck.has(cap)) return <>{children}</>;
  return (
    <EmptyState
      icon={<LockClosedRegular />}
      title={`${feature}은(는) 앱 업데이트 후 사용 가능해요`}
      description="설정 > 정보에서 업데이트를 확인해 주세요."
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
export function DropZone({ active = false, title = "파일을 여기에 끌어 놓으세요", description, onPick }: DropZoneProps) {
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
