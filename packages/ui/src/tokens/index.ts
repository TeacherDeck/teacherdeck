// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Design tokens and theme conversion (design-system.md §2, §4). The only place allowed to hold raw
// style values (eslint deck/no-raw-style-values exempts this directory, UI-002).
import { type Theme, tokens, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import type { ThemePayload } from "@deck/sdk";

/** WinUI text font (design-system.md §4). System fonts only: Hangul falls back to Malgun Gothic. */
export const FONT_STACK = '"Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif';
/** WinUI display font for text 20px and larger (Subtitle and up). */
export const FONT_STACK_DISPLAY = '"Segoe UI Variable Display", "Segoe UI", "Malgun Gothic", sans-serif';

/**
 * WinUI brushes Fluent v9 has no token for. They ride in the theme object, so FluentProvider
 * emits them as CSS variables and `themeToPayload` carries them to modules unchanged.
 */
const WINUI_LIGHT = {
  /** CardBackgroundFillColorDefault: translucent so Mica shows through. */
  deckCardFill: "rgba(255, 255, 255, 0.7)",
  /** ControlFillColorSecondary: hover on clickable cards. */
  deckCardFillHover: "rgba(249, 249, 249, 0.5)",
  /** CardStrokeColorDefault. */
  deckCardStroke: "rgba(0, 0, 0, 0.0578)",
  deckFontFamilyDisplay: FONT_STACK_DISPLAY,
};
const WINUI_DARK: typeof WINUI_LIGHT = {
  deckCardFill: "rgba(255, 255, 255, 0.0512)",
  deckCardFillHover: "rgba(255, 255, 255, 0.0837)",
  deckCardStroke: "rgba(0, 0, 0, 0.1)",
  deckFontFamilyDisplay: FONT_STACK_DISPLAY,
};

/** Fluent theme plus the WinUI extras above. */
export type DeckTheme = Theme & typeof WINUI_LIGHT;

const cssVar = (name: keyof typeof WINUI_LIGHT) => `var(--${name})`;

/** Semantic aliases over Fluent tokens and WinUI extras. Use these or `tokens.*`, never literals. */
export const deckTokens = {
  pagePadding: tokens.spacingHorizontalXXL,
  sectionGap: tokens.spacingVerticalXXL,
  itemGap: tokens.spacingVerticalM,
  inlineGap: tokens.spacingHorizontalM,
  /** WinUI stacks settings cards 4px apart. */
  cardGap: tokens.spacingVerticalXS,
  /** In-page surfaces use 4px (WinUI ControlCornerRadius). */
  cardRadius: tokens.borderRadiusMedium,
  /** Overlays and the shell content frame use 8px (WinUI OverlayCornerRadius). */
  overlayRadius: tokens.borderRadiusXLarge,
  cardPadding: tokens.spacingHorizontalL,
  cardMinHeight: "68px",
  /** Left inset of expander rows so their text lines up with the header text. */
  expanderIndent: "56px",
  /** Minimum row height of list items (WinUI ListViewItem). */
  listItemHeight: "40px",
  cardFill: cssVar("deckCardFill"),
  cardFillHover: cssVar("deckCardFillHover"),
  cardStroke: cssVar("deckCardStroke"),
  fontFamilyDisplay: cssVar("deckFontFamilyDisplay"),
  /** Surface for custom panels on a transparent (Mica) root (UI-004). Same as a card. */
  layer: cssVar("deckCardFill"),
  layerSubtle: tokens.colorSubtleBackground,
  stroke: tokens.colorNeutralStroke2,
  /** Shell window chrome (custom title bar, WinUI caption buttons). */
  titleBarHeight: "40px",
  captionButtonWidth: "46px",
  /** Caption glyphs: Segoe Fluent Icons on Windows 11, Segoe MDL2 Assets on Windows 10 (same code points). */
  captionIconFont: '"Segoe Fluent Icons", "Segoe MDL2 Assets"',
  captionIconSize: "10px",
} as const;

/** Fluent theme for a color mode with the deck fonts and WinUI extras. */
export function createDeckTheme(mode: "light" | "dark"): DeckTheme {
  const base = mode === "dark" ? webDarkTheme : webLightTheme;
  return { ...base, fontFamilyBase: FONT_STACK, ...(mode === "dark" ? WINUI_DARK : WINUI_LIGHT) };
}

/** Serializes a theme for `init` / `theme.changed` (design-system.md §2). */
export function themeToPayload(mode: "light" | "dark", mica: boolean): ThemePayload {
  const theme = createDeckTheme(mode);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) out[k] = String(v);
  return { mode, mica, tokens: out };
}

/** Rebuilds the theme a module should render with. Unknown or missing tokens fall back to defaults. */
export function payloadToTheme(payload: ThemePayload): DeckTheme {
  const base = createDeckTheme(payload.mode);
  const merged: Record<string, string | number> = { ...base };
  for (const [k, v] of Object.entries(payload.tokens)) {
    if (k in base) merged[k] = typeof base[k as keyof DeckTheme] === "number" ? Number(v) : v;
  }
  return merged as unknown as DeckTheme;
}
