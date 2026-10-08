// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Design tokens and theme conversion (design-system.md §2, §4). The only place allowed to hold raw
// style values (eslint deck/no-raw-style-values exempts this directory, UI-002).
import { type Theme, tokens, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import type { ThemePayload } from "@deck/sdk";

/** Font stack (design-system.md §4). Pretendard is bundled by the shell; Segoe UI is a system font. */
export const FONT_STACK = '"Segoe UI Variable Text", "Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';

/** Semantic spacing aliases over Fluent tokens. Use these or `tokens.*`, never literals. */
export const deckTokens = {
  pagePadding: tokens.spacingHorizontalXXL,
  sectionGap: tokens.spacingVerticalXL,
  itemGap: tokens.spacingVerticalM,
  inlineGap: tokens.spacingHorizontalM,
  cardRadius: tokens.borderRadiusXLarge,
  cardShadow: tokens.shadow4,
  /** Layer for cards on a transparent (Mica) root (UI-004). */
  layer: tokens.colorNeutralBackground1,
  layerSubtle: tokens.colorSubtleBackground,
  stroke: tokens.colorNeutralStroke2,
} as const;

/** Fluent theme for a color mode with the deck font stack. */
export function createDeckTheme(mode: "light" | "dark"): Theme {
  const base = mode === "dark" ? webDarkTheme : webLightTheme;
  return { ...base, fontFamilyBase: FONT_STACK };
}

/** Serializes a theme for `init` / `theme.changed` (design-system.md §2). */
export function themeToPayload(mode: "light" | "dark", mica: boolean): ThemePayload {
  const theme = createDeckTheme(mode);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) out[k] = String(v);
  return { mode, mica, tokens: out };
}

/** Rebuilds the Fluent theme a module should render with. Unknown or missing tokens fall back to defaults. */
export function payloadToTheme(payload: ThemePayload): Theme {
  const base = createDeckTheme(payload.mode);
  const merged: Record<string, string | number> = { ...base };
  for (const [k, v] of Object.entries(payload.tokens)) {
    if (k in base) merged[k] = typeof base[k as keyof Theme] === "number" ? Number(v) : v;
  }
  return merged as unknown as Theme;
}
