// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Reference module UI. Copy these patterns:
// - host features only via `deck` (MOD-006); storage instead of localStorage (MOD-009)
// - UI only from @deck/ui (WinUI controls, type ramp, tokens); icons from react-icons (MOD-010, UI-002)
// - errors as an InfoBar, inputs with a header (NumberBox), settings as SettingsCard
// - keyboard: Space start/pause, R reset, F presentation mode (UI-005)
// - 해요체 wording, same action = same word (UI-007)
import type { Deck } from "@deck/sdk";
import {
  Button,
  Display,
  InfoBar,
  NumberBox,
  SettingsCard,
  Subtitle,
  ToggleSwitch,
  deckTokens,
  makeStyles,
  mergeClasses,
  tokens,
} from "@deck/ui";
import {
  ArrowResetRegular,
  FullScreenMaximizeRegular,
  PauseRegular,
  PinRegular,
  PlayRegular,
} from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PRESETS_SEC, addPreset, loadPresets } from "./presets.ts";
import { type TimerState, create, format, remaining, reset, tick, toggle } from "./timer.ts";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  face: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalXXXL,
    borderRadius: deckTokens.cardRadius,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    backgroundColor: deckTokens.cardFill,
  },
  digits: { fontVariantNumeric: "tabular-nums" },
  presentation: {
    position: "fixed",
    inset: 0,
    justifyContent: "center",
    borderRadius: tokens.borderRadiusNone,
    border: "none",
    boxSizing: "border-box",
    overflowY: "auto",
  },
  presentationDigits: {
    fontSize: `min(calc(${tokens.fontSizeHero1000} * 4), calc((100vw - ${tokens.spacingHorizontalXXXL} * 2) / 5), calc(100vh / 3))`,
    lineHeight: "120%",
    flexShrink: 0,
    whiteSpace: "nowrap",
    maxWidth: "100%",
  },
  // Static white on the strong red stays readable in both themes (UI-005).
  finished: { backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundStaticInverted },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
});

export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [timer, setTimer] = useState<TimerState>(() => create(5 * 60 * 1000));
  const [now, setNow] = useState(() => performance.now());
  const [presets, setPresets] = useState<number[]>(DEFAULT_PRESETS_SEC);
  const [customMin, setCustomMin] = useState(5);
  const [presenting, setPresenting] = useState(false);
  const [onTop, setOnTop] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadPresets(deck)
      .then(setPresets)
      .catch(() => setMessage("프리셋을 불러오지 못했어요. 기본값을 쓸게요."));
  }, [deck]);

  // Re-render while running; time itself comes from timestamps (timer.ts).
  useEffect(() => {
    if (timer.status !== "running") return undefined;
    const id = setInterval(() => {
      const t = performance.now();
      setNow(t);
      setTimer((prev) => tick(prev, t));
    }, 200);
    return () => clearInterval(id);
  }, [timer.status]);

  // The host restores window state when this module is hidden (capabilities.md §2.3).
  useEffect(
    () =>
      deck.on("module.visibility", ({ visible }) => {
        if (!visible) {
          setPresenting(false);
          setOnTop(false);
        }
      }),
    [deck],
  );

  const setPresentation = useCallback(
    async (on: boolean) => {
      try {
        await deck.window.setFullscreen(on);
        setPresenting(on);
      } catch {
        setMessage("발표 모드로 바꾸지 못했어요. 다시 시도해 주세요.");
      }
    },
    [deck],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "Escape" && presenting) {
        e.preventDefault();
        void setPresentation(false);
        return;
      }
      if (
        e.target instanceof Element &&
        e.target.closest(
          "input, textarea, select, button, a, [contenteditable], [role=button], [role=slider], [role=checkbox], [role=switch], [role=combobox]",
        )
      )
        return;
      const t = performance.now();
      if (e.code === "Space") {
        e.preventDefault();
        setNow(t);
        setTimer((prev) => toggle(prev, t));
      } else if (e.key === "r" || e.key === "R") {
        setTimer((prev) => reset(prev));
      } else if (e.key === "f" || e.key === "F") {
        void setPresentation(!presenting);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, setPresentation]);

  const choose = (seconds: number) => setTimer(create(seconds * 1000));
  const left = remaining(timer, now);
  const finished = timer.status === "finished";

  const face = (
    <section
      className={mergeClasses(s.face, presenting && s.presentation, finished && s.finished)}
      aria-live="polite"
      aria-label="남은 시간"
    >
      <Display className={mergeClasses(s.digits, presenting && s.presentationDigits)}>{format(left)}</Display>
      {finished && <Subtitle>시간이 끝났어요</Subtitle>}
      <div className={s.row}>
        <Button
          appearance="primary"
          icon={timer.status === "running" ? <PauseRegular /> : <PlayRegular />}
          onClick={() => {
            const t = performance.now();
            setNow(t);
            setTimer((prev) => toggle(prev, t));
          }}
        >
          {timer.status === "running" ? "일시정지" : "시작"}
        </Button>
        <Button icon={<ArrowResetRegular />} onClick={() => setTimer((prev) => reset(prev))}>
          리셋
        </Button>
        <Button icon={<FullScreenMaximizeRegular />} onClick={() => void setPresentation(!presenting)}>
          {presenting ? "발표 모드 끄기" : "발표 모드"}
        </Button>
      </div>
    </section>
  );

  if (presenting) return face;

  return (
    <main className={s.page}>
      {face}
      {message !== null && <InfoBar severity="error" message={message} onClose={() => setMessage(null)} />}
      <div className={s.row} aria-label="프리셋">
        {presets.map((sec) => (
          <Button key={sec} onClick={() => choose(sec)}>
            {format(sec * 1000)}
          </Button>
        ))}
      </div>
      <div className={s.row}>
        <NumberBox header="분" min={1} max={180} value={customMin} onChange={setCustomMin} />
        <Button onClick={() => choose(customMin * 60)}>설정</Button>
        <Button
          onClick={() =>
            void addPreset(deck, presets, customMin * 60)
              .then(setPresets)
              .catch(() => setMessage("프리셋을 저장하지 못했어요. 다시 시도해 주세요."))
          }
        >
          프리셋 저장
        </Button>
      </div>
      <SettingsCard
        icon={<PinRegular />}
        header="항상 위"
        description="다른 창 위에 타이머를 띄워요."
        action={
          <ToggleSwitch
            header="항상 위"
            showHeader={false}
            checked={onTop}
            onChange={(on) => {
              void deck.window
                .setAlwaysOnTop(on)
                .then(() => setOnTop(on))
                .catch(() => setMessage("항상 위로 바꾸지 못했어요. 다시 시도해 주세요."));
            }}
          />
        }
      />
    </main>
  );
}
