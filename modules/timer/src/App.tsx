// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Reference module UI. Copy these patterns:
// - host features only via `deck` (MOD-006); storage instead of localStorage (MOD-009)
// - @deck/ui + Fluent components and tokens only, no raw style values (MOD-010, UI-002)
// - keyboard: Space start/pause, R reset, F presentation mode (UI-005)
// - 해요체 wording, same action = same word (UI-007)
import type { Deck } from "@deck/sdk";
import { SettingsCard, deckTokens } from "@deck/ui";
import {
  Button,
  SpinButton,
  Switch,
  Text,
  Title3,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowResetRegular, FullScreenMaximizeRegular, PauseRegular, PinRegular, PlayRegular } from "@fluentui/react-icons";
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
    backgroundColor: deckTokens.layer,
  },
  digits: { fontSize: tokens.fontSizeHero1000, lineHeight: tokens.lineHeightHero1000, fontWeight: tokens.fontWeightSemibold },
  presentation: {
    position: "fixed",
    inset: 0,
    justifyContent: "center",
    borderRadius: tokens.borderRadiusNone,
  },
  presentationDigits: { fontSize: `calc(${tokens.fontSizeHero1000} * 4)`, lineHeight: tokens.lineHeightHero1000 },
  finished: { backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "center" },
});

export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [timer, setTimer] = useState<TimerState>(() => create(5 * 60 * 1000));
  const [now, setNow] = useState(() => Date.now());
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
      const t = Date.now();
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
      if (e.target instanceof HTMLInputElement) return;
      const t = Date.now();
      if (e.code === "Space") {
        e.preventDefault();
        setNow(t);
        setTimer((prev) => toggle(prev, t));
      } else if (e.key === "r" || e.key === "R") {
        setTimer((prev) => reset(prev));
      } else if (e.key === "f" || e.key === "F") {
        void setPresentation(!presenting);
      } else if (e.key === "Escape" && presenting) {
        void setPresentation(false);
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
      <Text className={mergeClasses(s.digits, presenting && s.presentationDigits)}>{format(left)}</Text>
      {finished && <Title3>시간이 끝났어요</Title3>}
      <div className={s.row}>
        <Button
          appearance="primary"
          icon={timer.status === "running" ? <PauseRegular /> : <PlayRegular />}
          onClick={() => setTimer((prev) => toggle(prev, Date.now()))}
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
      {message !== null && <Text role="alert">{message}</Text>}
      <div className={s.row} aria-label="프리셋">
        {presets.map((sec) => (
          <Button key={sec} onClick={() => choose(sec)}>
            {format(sec * 1000)}
          </Button>
        ))}
      </div>
      <div className={s.row}>
        <SpinButton
          aria-label="분"
          min={1}
          max={180}
          value={customMin}
          onChange={(_, d) => setCustomMin(d.value ?? (Number(d.displayValue) || 1))}
        />
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
          <Switch
            aria-label="항상 위"
            checked={onTop}
            onChange={(_, d) => {
              void deck.window
                .setAlwaysOnTop(d.checked)
                .then(() => setOnTop(d.checked))
                .catch(() => setMessage("항상 위로 바꾸지 못했어요."));
            }}
          />
        }
      />
    </main>
  );
}
