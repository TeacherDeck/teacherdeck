// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { FluentProvider, type Theme, makeStaticStyles, makeStyles, tokens } from "@fluentui/react-components";
import type { Deck, ThemePayload } from "@deck/sdk";
import { type ReactNode, useEffect, useState } from "react";
import { createDeckTheme, deckTokens, payloadToTheme } from "./tokens/index.ts";

const THUMB_VAR = "--deck-scrollbar-thumb";
const THUMB_HOVER_VAR = "--deck-scrollbar-thumb-hover";

// Clip sideways overflow without creating another scroll container. `overflow-x: hidden`
// implicitly turns overflow-y into auto; an unbounded body then traps wheel chaining when
// overscroll is disabled. Only the document viewport owns the outer overscroll boundary.
const useDocumentStyles = makeStaticStyles({
  html: { overscrollBehaviorY: "none" },
  "html, body": {
    margin: 0,
    padding: 0,
    overflowX: "clip",
    touchAction: "pan-y",
  },
  "*, *::before, *::after": { boxSizing: "border-box" },
  // Slim themed scrollbars everywhere. Theme tokens are CSS variables on the provider element,
  // which the document viewport's scrollbar can't see, so DeckProvider copies the thumb colors
  // onto the root. No color-scheme: it repaints the canvas and makes iframes opaque (UI-004).
  "::-webkit-scrollbar": {
    width: deckTokens.scrollbarSize,
    height: deckTokens.scrollbarSize,
    backgroundColor: "transparent",
  },
  "::-webkit-scrollbar-track, ::-webkit-scrollbar-corner": { backgroundColor: "transparent" },
  "::-webkit-scrollbar-button": { display: "none" },
  "::-webkit-scrollbar-thumb": {
    backgroundColor: `var(${THUMB_VAR})`,
    backgroundClip: "padding-box",
    border: `${deckTokens.scrollbarThumbInset} solid transparent`,
    borderRadius: deckTokens.scrollbarThumbRadius,
  },
  "::-webkit-scrollbar-thumb:hover": { backgroundColor: `var(${THUMB_HOVER_VAR})` },
});

const useStyles = makeStyles({
  // Fluent copies the provider className onto every portal mount node (applyStylesToPortals), so
  // it must not size, paint or clip: a full-height background here covered the app whenever a
  // Dropdown or Menu opened, and overflow clipping on the zero-height mount node makes popup
  // positioning squeeze lists to max-height 0. Transparent replaces Fluent's default background.
  provider: { backgroundColor: "transparent", color: tokens.colorNeutralForeground1 },
  // UI-004: transparent root so the Mica backdrop shows through; surfaces use layer tokens.
  transparent: { backgroundColor: "transparent", minHeight: "100vh", overflowX: "clip" },
  opaque: { backgroundColor: tokens.colorNeutralBackground2, minHeight: "100vh", overflowX: "clip" },
});

export interface DeckProviderProps {
  /** Modules: pass the connected deck; the theme follows `init` and `theme.changed`. */
  deck?: Pick<Deck, "theme" | "on">;
  /** Shell: pass the theme directly. */
  theme?: Theme | ThemePayload;
  /** Shell: whether Mica is active (modules read it from the payload). */
  mica?: boolean;
  children: ReactNode;
}

function toTheme(t: Theme | ThemePayload): Theme {
  return "tokens" in t && "mode" in t ? payloadToTheme(t as ThemePayload) : (t as Theme);
}

/** Root provider for the shell and every module (UI-004). */
export function DeckProvider({ deck, theme, mica, children }: DeckProviderProps) {
  useDocumentStyles();
  const styles = useStyles();
  const [payload, setPayload] = useState<ThemePayload | undefined>(deck?.theme);
  useEffect(() => deck?.on("theme.changed", setPayload), [deck]);

  const resolved =
    theme !== undefined ? toTheme(theme) : payload !== undefined ? payloadToTheme(payload) : createDeckTheme("light");
  const transparent = mica ?? payload?.mica ?? false;
  // Scrollbar thumb colors for the document styles above, resolved from this theme. Nested
  // providers (gallery previews) restore the outer values on unmount.
  const thumb = resolved.colorNeutralStroke1;
  const thumbHover = resolved.colorNeutralStroke1Hover;
  useEffect(() => {
    const root = document.documentElement.style;
    const previous = [root.getPropertyValue(THUMB_VAR), root.getPropertyValue(THUMB_HOVER_VAR)] as const;
    root.setProperty(THUMB_VAR, thumb);
    root.setProperty(THUMB_HOVER_VAR, thumbHover);
    return () => {
      root.setProperty(THUMB_VAR, previous[0]);
      root.setProperty(THUMB_HOVER_VAR, previous[1]);
    };
  }, [thumb, thumbHover]);
  return (
    <FluentProvider theme={resolved} className={styles.provider}>
      <div className={transparent ? styles.transparent : styles.opaque}>{children}</div>
    </FluentProvider>
  );
}
