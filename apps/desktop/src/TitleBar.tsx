// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Custom title bar for the borderless main window (design-system.md §1). The left part is a Tauri
// drag region: drag moves the window, double-click maximizes. Caption buttons copy WinUI: 46px wide,
// Segoe Fluent Icons glyphs, red close on hover.
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { deckTokens } from "@deck/ui";
import { useEffect, useState } from "react";
import type { WindowControls } from "./host.ts";

/** Segoe Fluent Icons / MDL2 code points. */
const GLYPH = { minimize: "", maximize: "", restore: "", close: "" } as const;

const useStyles = makeStyles({
  bar: {
    display: "flex",
    alignItems: "stretch",
    height: deckTokens.titleBarHeight,
    flexShrink: 0,
    userSelect: "none",
  },
  drag: {
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    paddingInlineStart: tokens.spacingHorizontalL,
    minWidth: 0,
  },
  logo: { width: tokens.fontSizeBase400, height: tokens.fontSizeBase400, flexShrink: 0 },
  title: {
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  caption: {
    width: deckTokens.captionButtonWidth,
    border: "none",
    padding: 0,
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    fontFamily: deckTokens.captionIconFont,
    fontSize: deckTokens.captionIconSize,
    cursor: "default",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":active": { backgroundColor: tokens.colorSubtleBackgroundPressed, color: tokens.colorNeutralForeground2 },
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: `calc(${tokens.strokeWidthThick} * -1)`,
    },
  },
  close: {
    ":hover": {
      backgroundColor: tokens.colorPaletteRedBackground3,
      color: tokens.colorNeutralForegroundStaticInverted,
    },
    ":active": {
      backgroundColor: tokens.colorPaletteRedForeground1,
      color: tokens.colorNeutralForegroundStaticInverted,
    },
  },
});

export interface TitleBarProps {
  title: string;
  controls: WindowControls;
}

export function TitleBar({ title, controls }: TitleBarProps) {
  const s = useStyles();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    const sync = () =>
      void controls
        .isMaximized()
        .then((m) => alive && setMaximized(m))
        .catch(() => undefined);
    sync();
    const off = controls.onResized(sync);
    return () => {
      alive = false;
      void off.then((fn) => fn()).catch(() => undefined);
    };
  }, [controls]);

  const run = (action: () => Promise<void>) => () => void action().catch(() => undefined);

  return (
    <header className={s.bar}>
      <div className={s.drag} data-tauri-drag-region="deep">
        <img className={s.logo} src="/app-icon.png" alt="" />
        <span className={s.title}>{title}</span>
      </div>
      <button type="button" className={s.caption} aria-label="최소화" title="최소화" onClick={run(controls.minimize)}>
        {GLYPH.minimize}
      </button>
      <button
        type="button"
        className={s.caption}
        aria-label={maximized ? "이전 크기로 복원" : "최대화"}
        title={maximized ? "이전 크기로 복원" : "최대화"}
        onClick={run(controls.toggleMaximize)}
      >
        {maximized ? GLYPH.restore : GLYPH.maximize}
      </button>
      <button
        type="button"
        className={mergeClasses(s.caption, s.close)}
        aria-label="닫기"
        title="닫기"
        onClick={run(controls.close)}
      >
        {GLYPH.close}
      </button>
    </header>
  );
}
