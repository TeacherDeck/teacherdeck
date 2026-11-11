// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell root: navigation rail + pages (design-system.md §1), bridge wiring and theme push.
import { Button, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { HomeRegular, InfoRegular, PaintBrushRegular, SettingsRegular } from "@fluentui/react-icons";
import { type InitPayload } from "@deck/sdk";
import { DeckProvider, EmptyState, InfoBar, deckTokens, themeToPayload } from "@deck/ui";
import { type ReactElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ModuleBridge, moduleEntryOrigin } from "./bridge/ModuleBridge.ts";
import { KeepAliveSet } from "./bridge/keepAlive.ts";
import { DocumentProtection, type DocumentDecision, type DocumentPrompt } from "./bridge/documentProtection.ts";
import { DocumentConfirmation } from "./DocumentConfirmation.tsx";
import { CATEGORY_ICONS, CATEGORY_ORDER } from "./categories.tsx";
import { loadFavorites, saveFavorites, takeFreshModules, withFavoriteToggled } from "./deckState.ts";
import type { Category } from "./generated/Category.ts";
import type { ModuleEntry } from "./generated/ModuleEntry.ts";
import type { ShellInfo } from "./generated/ShellInfo.ts";
import { host, schoolDataHost, messagingConfirmationHost, windowControls } from "./host.ts";
import { MessagingConfirmation } from "./messaging-confirmation/MessagingConfirmation.tsx";
import { CATEGORY_LABELS } from "./labels.ts";
import { LaunchScreen } from "./LaunchScreen.tsx";
import { loadMotionPreference, playMotion, saveMotionPreference, useOsReducedMotion } from "./motion.ts";
import { About } from "./pages/About.tsx";
import { Gallery } from "./pages/Gallery.tsx";
import { Home } from "./pages/Home.tsx";
import { ModuleHost } from "./pages/ModuleHost.tsx";
import { Settings } from "./pages/Settings.tsx";
import { SchoolData } from "./pages/SchoolData.tsx";
import { SchoolDataAccess } from "./pages/SchoolDataAccess.tsx";
import { type ThemePreference, loadPreference, micaFor, savePreference, useColorMode } from "./theme.ts";
import { TitleBar } from "./TitleBar.tsx";

type Page =
  | { kind: "home" }
  | { kind: "category"; category: Category }
  | { kind: "module"; id: string }
  | { kind: "settings" }
  | { kind: "schoolData" }
  | { kind: "about" }
  | { kind: "gallery" };

/** Rail item a page belongs to; module pages have none. */
function railKey(page: Page): string | null {
  switch (page.kind) {
    case "module":
      return null;
    case "category":
      return `category:${page.category}`;
    case "schoolData":
      return "settings";
    default:
      return page.kind;
  }
}

/** Shortest launch screen, so the fan-out finishes instead of flashing (ADR-0024). */
const LAUNCH_MIN_MS = 700;
/** Longer when new tools arrived, so the count can be read. */
const LAUNCH_MIN_FRESH_MS = 1600;

const useStyles = makeStyles({
  // The shell never scrolls as a whole; only the content pane scrolls, and only vertically.
  shell: { display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },
  stage: { display: "flex", flexGrow: 1, minHeight: 0, position: "relative" },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  // Fades in under the leaving launch screen (design-system.md §1 셸 모션).
  bodyEnter: {
    animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
    animationDuration: tokens.durationGentle,
    animationTimingFunction: tokens.curveDecelerateMid,
    animationFillMode: "backwards",
  },
  rail: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalS,
    minWidth: "200px",
    minHeight: 0,
    overflowY: "auto",
  },
  spacer: { flexGrow: 1 },
  railButton: { justifyContent: "flex-start" },
  // WinUI NavigationView: selected item gets the subtle selected fill and an accent pill.
  railSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  pill: {
    position: "absolute",
    top: 0,
    left: tokens.spacingHorizontalS,
    display: "flex",
    alignItems: "center",
    pointerEvents: "none",
    opacity: 0,
  },
  pillShown: { opacity: 1 },
  pillMove: {
    transitionProperty: "transform, opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveDecelerateMid,
  },
  pillFade: {
    transitionProperty: "opacity",
    transitionDuration: tokens.durationNormal,
    transitionTimingFunction: tokens.curveDecelerateMid,
  },
  pillBar: {
    width: tokens.strokeWidthThicker,
    height: deckTokens.navPillHeight,
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorCompoundBrandStroke,
  },
  // Entrance: only the new page moves; the old one is simply gone (design-system.md §1 셸 모션).
  pageEnter: {
    animationName: {
      from: { opacity: 0, transform: `translateY(${deckTokens.motionPageOffset})` },
      to: { opacity: 1, transform: "none" },
    },
    animationDuration: tokens.durationGentle,
    animationTimingFunction: tokens.curveDecelerateMax,
    animationFillMode: "backwards",
  },
  content: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    position: "relative",
    backgroundColor: deckTokens.layerSubtle,
    // Straight divider between the rail and the content pane.
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  // Tools take the whole width: no rail, so no divider either.
  contentFull: { borderLeft: "none" },
  moduleLayer: { position: "absolute", inset: 0 },
  hidden: { display: "none" },
});

function SecProbe({ origin, modules }: { origin: string; modules: ModuleEntry[] }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const moduleFrames = useRef(new Map<string, HTMLIFrameElement>());
  const fixtures = useMemo(
    () =>
      modules
        .flatMap((entry) => {
          const moduleOrigin = moduleEntryOrigin(entry.resolution.id, entry.entryUrl ?? "");
          return moduleOrigin === null ? [] : [{ id: entry.resolution.id, origin: moduleOrigin }];
        })
        .slice(0, 2),
    [modules],
  );
  useEffect(() => {
    let legacy: Record<string, unknown> | undefined;
    const results = new Map<string, unknown>();
    let reported = false;
    const report = (timeout: boolean) => {
      if (reported || (!timeout && (legacy === undefined || results.size !== fixtures.length))) return;
      reported = true;
      void host.secProbeReport({
        ...legacy,
        moduleIsolation: fixtures.map((f) => ({ moduleId: f.id, result: results.get(f.id) ?? { status: "timeout" } })),
        isolationComplete: legacy !== undefined && fixtures.length === 2 && results.size === 2,
      });
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { kind?: string; result?: unknown } | null;
      if (e.origin === origin && e.source === ref.current?.contentWindow && data?.kind === "sec-probe") {
        if (typeof data.result === "object" && data.result !== null) legacy = data.result as Record<string, unknown>;
      } else if (data?.kind === "sec-module-probe") {
        const fixture = fixtures.find(
          (f) => e.origin === f.origin && e.source === moduleFrames.current.get(f.id)?.contentWindow,
        );
        if (fixture !== undefined) results.set(fixture.id, data.result);
      }
      report(false);
    };
    const timer = setTimeout(() => report(true), 12000);
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [origin, fixtures]);
  return (
    <>
      <iframe
        ref={ref}
        title="sec-probe"
        src={`${origin}/_probe/index.html`}
        sandbox="allow-scripts allow-same-origin"
        hidden
      />
      {fixtures.map((f) => (
        <iframe
          key={f.id}
          ref={(element) => {
            if (element === null) moduleFrames.current.delete(f.id);
            else moduleFrames.current.set(f.id, element);
          }}
          title={`sec-probe-${f.id}`}
          src={`${f.origin}/_probe/module.html`}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          hidden
        />
      ))}
    </>
  );
}

export function App() {
  const s = useStyles();
  const [info, setInfo] = useState<ShellInfo | null>(null);
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<Page>({ kind: "home" });
  const [mounted, setMounted] = useState<string[]>([]);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const pageRef = useRef(page);
  pageRef.current = page;
  const transitionBusy = useRef(false);
  const [transitionPending, setTransitionPending] = useState(false);
  const [documentPrompt, setDocumentPrompt] = useState<DocumentPrompt | null>(null);
  const documentDecision = useRef<((decision: DocumentDecision) => void) | null>(null);
  const [documentError, setDocumentError] = useState(false);
  const [loadErrors, setLoadErrors] = useState<ReadonlySet<string>>(new Set());
  const [pref, setPref] = useState<ThemePreference>(loadPreference);
  const mode = useColorMode(pref);
  const systemMode = useColorMode("system");
  const mica = micaFor(info?.mica ?? false, mode, systemMode);
  const themePayload = useMemo(() => themeToPayload(mode, mica), [mode, mica]);
  const themeRef = useRef(themePayload);
  themeRef.current = themePayload;
  const keepAlive = useRef(new KeepAliveSet());
  const activeModuleRef = useRef<string | null>(null);
  const activationQueue = useRef(Promise.resolve());
  const modulesRef = useRef(modules);
  modulesRef.current = modules;
  const [motionPref, setMotionPref] = useState(loadMotionPreference);
  const osReducedMotion = useOsReducedMotion();
  const motion = motionPref && !osReducedMotion;
  const [favorites, setFavorites] = useState(loadFavorites);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  // Taken once per launch; StrictMode re-runs the load effect, refs survive it.
  const freshRef = useRef<ReadonlySet<string> | null>(null);
  const [launch, setLaunch] = useState<"loading" | "leaving" | "done">("loading");
  const launchStart = useRef(performance.now());
  const protection = useMemo(
    () =>
      new DocumentProtection(
        host,
        (prompt) =>
          new Promise<DocumentDecision>((resolve) => {
            documentDecision.current = resolve;
            setDocumentPrompt(prompt);
          }),
        (moduleId) => {
          keepAlive.current.remove(moduleId);
          mountedRef.current = mountedRef.current.filter((id) => id !== moduleId);
          setMounted(mountedRef.current);
        },
        setDocumentPrompt,
      ),
    [],
  );
  const decideDocument = (decision: DocumentDecision) => {
    const resolve = documentDecision.current;
    documentDecision.current = null;
    if (resolve === null) protection.cancel();
    else resolve(decision);
    setDocumentPrompt(null);
  };

  useEffect(() => {
    Promise.all([host.shellInfo(), host.listModules()])
      .then(([i, m]) => {
        freshRef.current ??= new Set(takeFreshModules(m.map((e) => e.resolution.id)));
        setFresh(freshRef.current);
        setInfo(i);
        setModules(m);
      })
      .catch(() => setError("앱 정보를 불러오지 못했어요. 앱을 다시 시작해 주세요."));
  }, []);

  // The launch screen stays only as long as loading takes, plus a short minimum (ADR-0024).
  useEffect(() => {
    if (info === null || launch !== "loading") return undefined;
    if (!motion) {
      setLaunch("done");
      return undefined;
    }
    const min = fresh.size > 0 ? LAUNCH_MIN_FRESH_MS : LAUNCH_MIN_MS;
    const timer = setTimeout(() => setLaunch("leaving"), Math.max(0, min - (performance.now() - launchStart.current)));
    return () => clearTimeout(timer);
  }, [info, launch, motion, fresh]);

  const bridge = useMemo(
    () =>
      new ModuleBridge({
        init: async (moduleId): Promise<InitPayload> => {
          const entry = modulesRef.current.find((m) => m.resolution.id === moduleId);
          const granted = await host.moduleGranted(moduleId);
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
    const unlisten = host.onFsDropped((e) => {
      if (e.moduleId === activeModuleRef.current) bridge.sendEvent(e.moduleId, "fs.dropped", e.payload);
    });
    return () => void unlisten.then((fn) => fn());
  }, [bridge]);

  /** Shows a page without touching history (used by navigate and by back/forward). */
  const show = useCallback(
    async (next: Page): Promise<boolean> => {
      if (transitionBusy.current) return false;
      transitionBusy.current = true;
      setTransitionPending(true);
      try {
        const activeId = next.kind === "module" ? next.id : null;
        const keep = (id: string) =>
          modulesRef.current.find((m) => m.resolution.id === id)?.manifest?.ui?.keepAlive === true;
        const before = pageRef.current.kind === "module" ? pageRef.current.id : null;
        const states = await Promise.all(
          mountedRef.current.map(async (id) => ({
            id,
            state: (await host.documentAction(id, { kind: "status" })).state,
          })),
        );
        const protectedIds = new Set(states.filter(({ state }) => state?.dirty || state?.saving).map(({ id }) => id));
        const planned = keepAlive.current.preview(activeId, keep, protectedIds);
        // Hiding a retained iframe preserves its work. Confirm only actual disposal.
        if (!(await protection.allow(planned.evicted))) return false;
        const afterDecision = keepAlive.current.preview(activeId, keep, protectedIds);
        // The host rechecks dirty/saving at unload, covering a late edit after confirmation.
        if (afterDecision.evicted.length > 0) await host.modulesUnloaded(afterDecision.evicted);
        const { mounted: nextMounted } = keepAlive.current.activate(activeId, keep, protectedIds);
        activeModuleRef.current = activeId;
        if (before !== null && before !== activeId && nextMounted.includes(before)) {
          bridge.sendEvent(before, "module.visibility", { visible: false });
          void host.moduleVisibility(before, false);
        }
        if (activeId !== null && activeId !== before && mountedRef.current.includes(activeId)) {
          bridge.sendEvent(activeId, "module.visibility", { visible: true });
          void host.moduleVisibility(activeId, true);
        }
        // Serialize native foreground updates so an older IPC completion cannot win navigation.
        activationQueue.current = activationQueue.current
          .then(() => host.moduleActivated(activeId))
          .then(() => undefined)
          .catch(() => undefined);
        setMounted(nextMounted);
        mountedRef.current = nextMounted;
        pageRef.current = next;
        setPage(next);
        return true;
      } catch {
        setDocumentError(true);
        return false;
      } finally {
        transitionBusy.current = false;
        setTransitionPending(false);
      }
    },
    [bridge, protection],
  );

  // Every page change is a history entry, so the mouse back/forward buttons and Alt+←/→ work like
  // a browser. WebView2 handles those natively, also while the pointer is over a module iframe. The
  // entry index tells the title bar whether there is anywhere to go back to.
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;
  const navigate = useCallback(
    async (next: Page) => {
      if (JSON.stringify(next) === JSON.stringify(pageRef.current)) return;
      if (!(await show(next))) return;
      const index = historyIndexRef.current + 1;
      window.history.pushState({ page: next, index }, "");
      historyIndexRef.current = index;
      setHistoryIndex(index);
      // The "새 도구" badge has done its job once the tool is opened.
      if (next.kind === "module" && fresh.has(next.id)) setFresh(new Set([...fresh].filter((id) => id !== next.id)));
    },
    [show, fresh],
  );
  const toggleFavorite = (id: string) => {
    const next = withFavoriteToggled(favorites, id);
    saveFavorites(next);
    setFavorites(next);
  };
  const changeMotion = (on: boolean) => {
    saveMotionPreference(on);
    setMotionPref(on);
  };
  const showRef = useRef(show);
  showRef.current = show;
  useEffect(() => {
    window.history.replaceState({ page: { kind: "home" } satisfies Page, index: 0 }, "");
    let restoringIndex: number | null = null;
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { page?: Page; index?: number } | null;
      const nextIndex = state?.index ?? 0;
      if (restoringIndex === nextIndex) {
        restoringIndex = null;
        return;
      }
      if (state?.page === undefined) return;
      void showRef.current(state.page).then((allowed) => {
        const browserIndex = (window.history.state as { index?: number } | null)?.index ?? 0;
        if (allowed) {
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          // Another native Back during the modal may already have restored the visible entry.
          if (browserIndex !== nextIndex) {
            restoringIndex = nextIndex;
            window.history.go(nextIndex - browserIndex);
          }
        } else if (historyIndexRef.current !== browserIndex) {
          restoringIndex = historyIndexRef.current;
          window.history.go(historyIndexRef.current - browserIndex);
        }
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const off = host.onModuleEvent((event) => {
      const entry = modulesRef.current.find((m) => m.resolution.id === event.moduleId);
      if (!entry?.resolution.picked || !entry.entryUrl) return;
      const caps = {
        "capture.completed": "capture",
        "capture.failed": "capture",
        "overlay.changed": "overlay",
        "shortcut.triggered": "global-shortcut",
        "window.presentationClosed": "window",
        "window.presentationDisconnected": "window",
        "window.documentSaveRequested": "window",
      } as const;
      if (!Object.hasOwn(caps, event.topic)) return;
      const cap = caps[event.topic];
      if (!entry.manifest || (!(cap in entry.manifest.requires) && !(cap in entry.manifest.optional))) return;
      bridge.sendEvent(event.moduleId, event.topic, event.payload);
    });
    return () => void off.then((fn) => fn()).catch(() => undefined);
  }, [bridge]);
  useEffect(() => {
    const off = host.onDocumentExit((request) => {
      const run = async () => {
        if (transitionBusy.current) {
          await host.documentAction("", { kind: "resolveExit", requestId: request.requestId, proceed: false });
          return;
        }
        transitionBusy.current = true;
        setTransitionPending(true);
        try {
          const proceed = await protection.allow(mountedRef.current);
          await host.documentAction("", { kind: "resolveExit", requestId: request.requestId, proceed });
        } catch {
          setDocumentError(true);
        } finally {
          transitionBusy.current = false;
          setTransitionPending(false);
        }
      };
      void run().catch(() => setDocumentError(true));
    });
    return () => void off.then((fn) => fn()).catch(() => undefined);
  }, [protection]);
  useEffect(() => {
    const off = host.onShowModule(({ moduleId }) => {
      if (modulesRef.current.some((m) => m.resolution.id === moduleId && m.resolution.picked && m.entryUrl))
        navigate({ kind: "module", id: moduleId });
    });
    return () => void off.then((fn) => fn()).catch(() => undefined);
  }, [navigate]);
  const changeTheme = (p: ThemePreference) => {
    savePreference(p);
    setPref(p);
  };

  const activeModule = page.kind === "module" ? page.id : null;
  const currentRail = railKey(page);
  // Each page remounts (and plays its entrance) on its own key, even when two share a rail item.
  const pageKey = page.kind === "category" ? `category:${page.category}` : page.kind;
  const usedCategories = CATEGORY_ORDER.filter((c) => modules.some((m) => m.manifest?.category === c));
  const shellReady = info !== null && launch !== "loading";

  // Rail selection pill: slides to the selected item and fades out on module pages, which have no
  // rail item (design-system.md §1 셸 모션).
  const railRef = useRef<HTMLElement>(null);
  const railItems = useRef(new Map<string, HTMLButtonElement>());
  const [pill, setPill] = useState({ y: 0, height: 0, shown: false, move: false });
  const placePill = useCallback(
    (move: boolean) => {
      const el = currentRail === null ? undefined : railItems.current.get(currentRail);
      setPill((prev) =>
        el === undefined
          ? { ...prev, shown: false, move: false }
          : { y: el.offsetTop, height: el.offsetHeight, shown: true, move: move && prev.shown },
      );
    },
    [currentRail],
  );
  useLayoutEffect(() => placePill(true), [placePill, shellReady, usedCategories.length]);
  useEffect(() => {
    const rail = railRef.current;
    if (rail === null || typeof ResizeObserver === "undefined") return undefined;
    // Text scaling and window size move the items; follow them without sliding.
    const observer = new ResizeObserver(() => placePill(false));
    observer.observe(rail);
    return () => observer.disconnect();
  }, [placePill, shellReady]);

  // Drill-in for the module layer. Its iframes stay mounted, so the motion is played, not remounted.
  const moduleLayerRef = useRef<HTMLDivElement>(null);
  const shownModule = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = moduleLayerRef.current;
    if (motion && el !== null && activeModule !== null && activeModule !== shownModule.current) {
      playMotion(
        el,
        [
          { opacity: 0, transform: `scale(${deckTokens.motionDrillScale})` },
          { opacity: 1, transform: "none" },
        ],
        tokens.durationSlow,
        tokens.curveDecelerateMax,
      );
    }
    shownModule.current = activeModule;
  }, [activeModule, motion]);

  if (error !== null) {
    return (
      <DeckProvider theme={themePayload} mica={false}>
        <div className={s.shell}>
          <TitleBar title="TeacherDeck" controls={windowControls} />
          <EmptyState title="문제가 생겼어요" description={error} />
        </div>
      </DeckProvider>
    );
  }

  const launchMessage =
    info === null ? "도구를 준비하고 있어요" : fresh.size > 0 ? `새 도구 ${fresh.size}개가 추가됐어요` : "준비됐어요";
  const launchScreen = launch !== "done" && (
    <LaunchScreen
      motion={motion}
      leaving={launch === "leaving"}
      message={launchMessage}
      onLeft={() => setLaunch("done")}
    />
  );

  if (!shellReady) {
    return (
      <DeckProvider theme={themePayload} mica={mica}>
        <div className={s.shell}>
          <TitleBar title="TeacherDeck" controls={windowControls} />
          <div className={s.stage}>{launchScreen}</div>
        </div>
      </DeckProvider>
    );
  }

  const railItem = (key: string, label: string, icon: ReactElement, target: Page) => {
    const current = key === currentRail;
    return (
      <Button
        key={key}
        ref={(el: HTMLButtonElement | null) => {
          if (el === null) railItems.current.delete(key);
          else railItems.current.set(key, el);
        }}
        className={mergeClasses(s.railButton, current && s.railSelected)}
        appearance="subtle"
        icon={icon}
        aria-current={current ? "page" : undefined}
        onClick={() => navigate(target)}
      >
        {label}
      </Button>
    );
  };
  const homeProps = {
    modules,
    dev: info.dev,
    favorites,
    fresh,
    motion,
    onOpen: (id: string) => navigate({ kind: "module", id }),
    onNeedsUpdate: () => navigate({ kind: "settings" }),
    onToggleFavorite: toggleFavorite,
  };

  return (
    <DeckProvider theme={themePayload} mica={mica}>
      <div className={s.shell}>
        <TitleBar
          title="TeacherDeck"
          controls={windowControls}
          {...(historyIndex > 0 ? { onBack: () => window.history.back() } : {})}
        />
        {documentError && (
          <InfoBar
            severity="warning"
            onClose={() => setDocumentError(false)}
            message="작업을 유지했어요. 저장한 뒤 다시 이동해 주세요."
          />
        )}
        <div className={s.stage}>
          <div className={mergeClasses(s.body, motion && launch === "leaving" && s.bodyEnter)}>
            {/* Tools get the whole width; the title bar back button leads out (design-system.md §1). */}
            <nav ref={railRef} className={mergeClasses(s.rail, activeModule !== null && s.hidden)} aria-label="메뉴">
              {railItem("home", "덱", <HomeRegular />, { kind: "home" })}
              {usedCategories.map((c) =>
                railItem(`category:${c}`, CATEGORY_LABELS[c], CATEGORY_ICONS[c], { kind: "category", category: c }),
              )}
              <div className={s.spacer} />
              {info.dev && railItem("gallery", "UI 갤러리", <PaintBrushRegular />, { kind: "gallery" })}
              {railItem("settings", "설정", <SettingsRegular />, { kind: "settings" })}
              {railItem("about", "정보", <InfoRegular />, { kind: "about" })}
              <span
                aria-hidden
                className={mergeClasses(
                  s.pill,
                  pill.shown && s.pillShown,
                  motion && (pill.move ? s.pillMove : s.pillFade),
                )}
                style={{ transform: `translateY(${pill.y}px)`, height: `${pill.height}px` }}
              >
                <span className={s.pillBar} />
              </span>
            </nav>
            <main className={mergeClasses(s.content, activeModule !== null && s.contentFull)}>
              <div
                ref={moduleLayerRef}
                className={activeModule === null ? s.hidden : s.moduleLayer}
                inert={transitionPending}
              >
                <ModuleHost
                  bridge={bridge}
                  modules={modules}
                  mounted={mounted}
                  active={activeModule}
                  loadErrors={loadErrors}
                />
              </div>
              {currentRail !== null && (
                <div key={pageKey} className={motion ? s.pageEnter : undefined}>
                  {page.kind === "home" && <Home {...homeProps} />}
                  {page.kind === "category" && <Home {...homeProps} category={page.category} />}
                  {page.kind === "settings" && (
                    <Settings
                      theme={pref}
                      onTheme={changeTheme}
                      motion={motionPref}
                      osReducedMotion={osReducedMotion}
                      onMotion={changeMotion}
                      checkUpdate={host.checkUpdate}
                      installUpdate={host.installUpdate}
                      restart={host.restartApp}
                      onSchoolData={() => navigate({ kind: "schoolData" })}
                    />
                  )}
                  {page.kind === "schoolData" && <SchoolData host={schoolDataHost} />}
                  {page.kind === "about" && <About appVersion={info.appVersion} modules={modules} />}
                  {page.kind === "gallery" && info.dev && <Gallery />}
                </div>
              )}
            </main>
          </div>
          {launchScreen}
        </div>
      </div>
      {info.secProbe && <SecProbe origin={info.moduleOrigin} modules={modules} />}
      <SchoolDataAccess host={schoolDataHost} />
      <MessagingConfirmation host={messagingConfirmationHost} />
      <DocumentConfirmation
        prompt={documentPrompt}
        moduleName={modules.find((entry) => entry.resolution.id === documentPrompt?.moduleId)?.manifest?.name ?? "도구"}
        decide={decideDocument}
      />
    </DeckProvider>
  );
}
