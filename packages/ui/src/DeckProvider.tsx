// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { FluentProvider, type Theme, makeStyles, tokens } from "@fluentui/react-components";
import type { Deck, ThemePayload } from "@deck/sdk";
import { type ReactNode, useEffect, useState } from "react";
import { createDeckTheme, payloadToTheme } from "./tokens/index.ts";

const useStyles = makeStyles({
  // UI-004: transparent root so the Mica backdrop shows through; surfaces use layer tokens.
  transparent: { backgroundColor: "transparent", minHeight: "100vh", color: tokens.colorNeutralForeground1 },
  opaque: { backgroundColor: tokens.colorNeutralBackground2, minHeight: "100vh", color: tokens.colorNeutralForeground1 },
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
  const styles = useStyles();
  const [payload, setPayload] = useState<ThemePayload | undefined>(deck?.theme);
  useEffect(() => deck?.on("theme.changed", setPayload), [deck]);

  const resolved = theme !== undefined ? toTheme(theme) : payload !== undefined ? payloadToTheme(payload) : createDeckTheme("light");
  const transparent = mica ?? payload?.mica ?? false;
  return (
    <FluentProvider theme={resolved} className={transparent ? styles.transparent : styles.opaque}>
      {children}
    </FluentProvider>
  );
}
