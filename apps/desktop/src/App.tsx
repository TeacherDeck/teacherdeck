// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell root: navigation rail + pages (design-system.md §1), bridge wiring and theme push.
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import {
  DocumentRegular,
  FolderRegular,
  HomeRegular,
  ImageRegular,
  InfoRegular,
  PaintBrushRegular,
  PeopleTeamRegular,
  SettingsRegular,
  WrenchRegular,
} from "@fluentui/react-icons";
import { MODULE_ORIGIN, type InitPayload } from "@deck/sdk";
import { DeckProvider, EmptyState, deckTokens, themeToPayload } from "@deck/ui";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModuleBridge } from "./bridge/ModuleBridge.ts";
import { KeepAliveSet } from "./bridge/keepAlive.ts";
import type { Category } from "./generated/Category.ts";
import type { ModuleEntry } from "./generated/ModuleEntry.ts";
import type { ShellInfo } from "./generated/ShellInfo.ts";
import { host } from "./host.ts";
import { CATEGORY_LABELS } from "./labels.ts";
import { About } from "./pages/About.tsx";
import { Gallery } from "./pages/Gallery.tsx";
import { Home } from "./pages/Home.tsx";
import { ModuleHost } from "./pages/ModuleHost.tsx";
import { Settings } from "./pages/Settings.tsx";
import { type ThemePreference, loadPreference, savePreference, useColorMode } from "./theme.ts";

type Page =
  | { kind: "home" }
  | { kind: "category"; category: Category }
  | { kind: "module"; id: string }
  | { kind: "settings" }
  | { kind: "about" }
  | { kind: "gallery" };

const CATEGORY_ICONS: Record<Category, ReactElement> = {
  classroom: <PeopleTeamRegular />,
  file: <FolderRegular />,
  image: <ImageRegular />,
  document: <DocumentRegular />,
  utility: <WrenchRegular />,
};

const useStyles = makeStyles({
  shell: { display: "flex", height: "100vh" },
  rail: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    minWidth: "200px",
  },
  spacer: { flexGrow: 1 },
  railButton: { justifyContent: "flex-start" },
  content: {
    flexGrow: 1,
    overflowY: "auto",
    position: "relative",
    backgroundColor: deckTokens.layerSubtle,
    borderTopLeftRadius: deckTokens.overlayRadius,
  },
  moduleLayer: { position: "absolute", inset: 0 },
  hidden: { display: "none" },
});

function SecProbe({ origin }: { origin: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { kind?: string; result?: unknown } | null;
      if (e.origin === origin && e.source === ref.current?.contentWindow && data?.kind === "sec-probe") {
        void host.secProbeReport(data.result);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin]);
  return <iframe ref={ref} title="sec-probe" src={`${origin}/_probe/index.html`} sandbox="allow-scripts allow-same-origin" hidden />;
}

export function App() {
  const s = useStyles();
  const [info, setInfo] = useState<ShellInfo | null>(null);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>({ kind: "home" });
  const [mounted, setMounted] = useState<string[]>([]);
  const [loadErrors, setLoadErrors] = useState<ReadonlySet<string>>(new Set());
  const [pref, setPref] = useState<ThemePreference>(loadPreference);
  const mode = useColorMode(pref);
  const mica = info?.mica ?? false;
  const themePayload = useMemo(() => themeToPayload(mode, mica), [mode, mica]);
  const themeRef = useRef(themePayload);
  themeRef.current = themePayload;
  const keepAlive = useRef(new KeepAliveSet());
  const modulesRef = useRef(modules);
  modulesRef.current = modules;

  useEffect(() => {
    Promise.all([host.shellInfo(), host.listModules()])
      .then(([i, m]) => {
        setInfo(i);
        setModules(m);
      })
      .catch(() => setError("앱 정보를 불러오지 못했어요. 앱을 다시 시작해 주세요."));
  }, []);

  const bridge = useMemo(
    () =>
      new ModuleBridge(info?.moduleOrigin ?? MODULE_ORIGIN, {
        init: async (moduleId): Promise<InitPayload> => {
          const entry = modulesRef.current.find((m) => m.resolution.id === moduleId);
          const granted = await host.moduleActivated(moduleId);
          return {
            module: { id: moduleId, version: entry?.resolution.picked?.version ?? "0.0.0" },
            host: { app: info?.appVersion ?? "0.0.0", caps: info?.caps ?? {} },
            granted,
            theme: themeRef.current,
          };
        },
        invoke: (moduleId, cap, method, args) => host.hostInvoke(moduleId, cap, method, args),
        onLoadError: (moduleId) => setLoadErrors((prev) => new Set(prev).add(moduleId)),
        debug: (m) => console.debug(`[bridge] ${m}`),
      }),
    [info],
  );

  useEffect(() => {
    const onMessage = (e: MessageEvent) => bridge.handle(e);
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bridge]);

  useEffect(() => bridge.broadcast("theme.changed", themePayload), [bridge, themePayload]);

  useEffect(() => {
    const unlisten = host.onFsDropped((e) => bridge.sendEvent(e.moduleId, "fs.dropped", e.payload));
    return () => void unlisten.then((fn) => fn());
  }, [bridge]);

  const navigate = useCallback(
    (next: Page) => {
      const activeId = next.kind === "module" ? next.id : null;
      const keep = (id: string) => modulesRef.current.find((m) => m.resolution.id === id)?.manifest?.ui?.keepAlive === true;
      const before = page.kind === "module" ? page.id : null;
      const { mounted: nextMounted, evicted } = keepAlive.current.activate(activeId, keep);
      if (before !== null && before !== activeId && nextMounted.includes(before)) {
        bridge.sendEvent(before, "module.visibility", { visible: false });
        void host.moduleVisibility(before, false);
      }
      if (activeId !== null && activeId !== before && mounted.includes(activeId)) {
        bridge.sendEvent(activeId, "module.visibility", { visible: true });
        void host.moduleVisibility(activeId, true);
      }
      for (const id of evicted) void host.moduleUnloaded(id);
      void host.moduleActivated(activeId);
      setMounted(nextMounted);
      setPage(next);
    },
    [bridge, page, mounted],
  );

  const changeTheme = (p: ThemePreference) => {
    savePreference(p);
    setPref(p);
  };

  if (error !== null || info === null) {
    return (
      <DeckProvider theme={themePayload} mica={false}>
        {error === null ? <Spinner label="불러오는 중" /> : <EmptyState title="문제가 생겼어요" description={error} />}
      </DeckProvider>
    );
  }

  const railItem = (label: string, icon: ReactElement, target: Page, current: boolean) => (
    <Button
      key={label}
      className={s.railButton}
      appearance={current ? "secondary" : "subtle"}
      icon={icon}
      aria-current={current ? "page" : undefined}
      onClick={() => navigate(target)}
    >
      {label}
    </Button>
  );
  const usedCategories = [...new Set(modules.flatMap((m) => (m.manifest === null ? [] : [m.manifest.category])))];
  const activeModule = page.kind === "module" ? page.id : null;

  return (
    <DeckProvider theme={themePayload} mica={mica}>
      <div className={s.shell}>
        <nav className={s.rail} aria-label="메뉴">
          {railItem("덱", <HomeRegular />, { kind: "home" }, page.kind === "home")}
          {usedCategories.map((c) =>
            railItem(CATEGORY_LABELS[c], CATEGORY_ICONS[c], { kind: "category", category: c }, page.kind === "category" && page.category === c),
          )}
          <div className={s.spacer} />
          {info.dev && railItem("UI 갤러리", <PaintBrushRegular />, { kind: "gallery" }, page.kind === "gallery")}
          {railItem("설정", <SettingsRegular />, { kind: "settings" }, page.kind === "settings")}
          {railItem("정보", <InfoRegular />, { kind: "about" }, page.kind === "about")}
        </nav>
        <main className={s.content}>
          <div className={activeModule === null ? s.hidden : s.moduleLayer}>
            <ModuleHost bridge={bridge} modules={modules} mounted={mounted} active={activeModule} loadErrors={loadErrors} />
          </div>
          {page.kind === "home" && (
            <Home modules={modules} dev={info.dev} onOpen={(id) => navigate({ kind: "module", id })} onNeedsUpdate={() => navigate({ kind: "settings" })} />
          )}
          {page.kind === "category" && (
            <Home
              modules={modules}
              category={page.category}
              dev={info.dev}
              onOpen={(id) => navigate({ kind: "module", id })}
              onNeedsUpdate={() => navigate({ kind: "settings" })}
            />
          )}
          {page.kind === "settings" && (
            <Settings
              theme={pref}
              onTheme={changeTheme}
              checkUpdate={host.checkUpdate}
              installUpdate={host.installUpdate}
              restart={host.restartApp}
            />
          )}
          {page.kind === "about" && <About appVersion={info.appVersion} modules={modules} />}
          {page.kind === "gallery" && info.dev && <Gallery />}
        </main>
      </div>
      {info.secProbe && <SecProbe origin={info.moduleOrigin} />}
    </DeckProvider>
  );
}
