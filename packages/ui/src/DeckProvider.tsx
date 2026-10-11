// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { FluentProvider, type Theme, makeStaticStyles, makeStyles, tokens } from "@fluentui/react-components";
import type { Deck, ThemePayload } from "@deck/sdk";
import { type ReactNode, useEffect, useState } from "react";
import { createDeckTheme, payloadToTheme } from "./tokens/index.ts";

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
});

const useStyles = makeStyles({
  // UI-004: transparent root so the Mica backdrop shows through; surfaces use layer tokens.
  transparent: {
    backgroundColor: "transparent",
    minHeight: "100vh",
    overflowX: "clip",
    color: tokens.colorNeutralForeground1,
  },
  opaque: {
    backgroundColor: tokens.colorNeutralBackground2,
    minHeight: "100vh",
    overflowX: "clip",
    color: tokens.colorNeutralForeground1,
  },
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
  // Tint native scrollbars with the theme so they don't stay light in dark mode. Not via
  // color-scheme: a root color-scheme repaints the canvas and makes iframes opaque, which
  // breaks the transparent root (UI-004). Theme tokens live on the provider element, so the
  // root gets resolved values; nested providers (gallery previews) restore it on unmount.
  const thumb = resolved.colorNeutralStroke1;
  useEffect(() => {
    const root = document.documentElement.style;
    const previous = root.scrollbarColor;
    root.scrollbarColor = `${thumb} transparent`;
    return () => {
      root.scrollbarColor = previous;
    };
  }, [thumb]);
  return (
    <FluentProvider theme={resolved} className={transparent ? styles.transparent : styles.opaque}>
      {children}
    </FluentProvider>
  );
}
