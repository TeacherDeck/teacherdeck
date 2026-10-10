// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Module screen: header + iframes. Keeps keepAlive modules mounted while hidden (modules.md §3).
// SEC-002: modules load from the module origin with sandbox="allow-scripts allow-same-origin".
import { Badge, Body1, Caption1, MessageBar, MessageBarBody, makeStyles, tokens } from "@fluentui/react-components";
import { deckTokens } from "@deck/ui";
import { useEffect, useRef } from "react";
import { type ModuleBridge, moduleEntryOrigin } from "../bridge/ModuleBridge.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { STATE_BADGES } from "../labels.ts";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", height: "100%" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: deckTokens.inlineGap,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXXL}`,
  },
  icon: { width: tokens.fontSizeHero700, height: tokens.fontSizeHero700 },
  frames: { flexGrow: 1, position: "relative" },
  frame: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    border: "none",
    backgroundColor: "transparent",
  },
  hidden: { visibility: "hidden" },
});

export interface ModuleHostProps {
  bridge: ModuleBridge;
  modules: ModuleEntry[];
  /** Mounted module ids, active first. */
  mounted: string[];
  active: string | null;
  loadErrors: ReadonlySet<string>;
}

function Frame({ bridge, entry, visible }: { bridge: ModuleBridge; entry: ModuleEntry; visible: boolean }) {
  const s = useStyles();
  const ref = useRef<HTMLIFrameElement>(null);
  const entryUrl = entry.entryUrl ?? "";
  const validOrigin = moduleEntryOrigin(entry.resolution.id, entryUrl);
  useEffect(() => {
    const win = ref.current?.contentWindow;
    if (win === null || win === undefined) return undefined;
    bridge.register(win, entry.resolution.id, entryUrl);
    return () => bridge.unregister(win);
  }, [bridge, entry.resolution.id, entryUrl]);
  return (
    <iframe
      ref={ref}
      title={entry.manifest?.name ?? entry.resolution.id}
      src={validOrigin === null ? "about:blank" : entryUrl}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      className={visible ? s.frame : `${s.frame} ${s.hidden}`}
      aria-hidden={!visible}
    />
  );
}

export function ModuleHost({ bridge, modules, mounted, active, loadErrors }: ModuleHostProps) {
  const s = useStyles();
  const byId = new Map(modules.map((m) => [m.resolution.id, m]));
  const current = active === null ? undefined : byId.get(active);
  return (
    <div className={s.wrap}>
      {current !== undefined && (
        <header className={s.header}>
          {current.iconUrl !== null && <img className={s.icon} src={current.iconUrl} alt="" />}
          <Body1>{current.manifest?.name ?? current.resolution.id}</Body1>
          <Caption1>v{current.resolution.picked?.version ?? "?"}</Caption1>
          {STATE_BADGES[current.resolution.state] !== null && (
            <Badge appearance="tint" color="warning">
              {STATE_BADGES[current.resolution.state]}
            </Badge>
          )}
        </header>
      )}
      {active !== null && loadErrors.has(active) && (
        <MessageBar intent="error">
          <MessageBarBody>도구를 불러오지 못했어요. 앱을 다시 시작해 보세요.</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.frames}>
        {mounted.map((id) => {
          const entry = byId.get(id);
          return entry === undefined ? null : <Frame key={id} bridge={bridge} entry={entry} visible={id === active} />;
        })}
      </div>
    </div>
  );
}
