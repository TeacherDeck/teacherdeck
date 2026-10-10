// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Reference module UI. Copy these patterns:
// - host features only via `deck` (MOD-006); storage instead of localStorage (MOD-009)
// - UI only from @deck/ui (WinUI controls, type ramp, tokens); icons from react-icons (MOD-010, UI-002)
// - errors as an InfoBar, settings as SettingsCard
// - keyboard: Space start/pause, R reset, F presentation mode, Enter on the digits to set a time,
//   then ↑/↓ or typing (UI-005)
// - 해요체 wording, same action = same word (UI-007)
import type { Deck } from "@deck/sdk";
import {
  Button,
  Caption,
  Display,
  InfoBar,
  SettingsCard,
  Subtitle,
  TextBox,
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
  Speaker2Regular,
  PlayRegular,
} from "@fluentui/react-icons";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type Part,
  VISIBLE_DISTANCE,
  clampPos,
  easeOut,
  rowStyle,
  settleMs,
  settleTarget,
  stepPx,
  valueAt,
} from "./picker.ts";
import { type Chime, SILENT, createAudio, playChime } from "./chime.ts";
import { loadRecent, loadSound, pushRecent, saveSound } from "./recent.ts";
import { type TimerState, create, format, fromParts, remaining, reset, tick, toParts, toggle } from "./timer.ts";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  face: {
    position: "relative",
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
  digitsButton: { cursor: "text", color: "inherit", minWidth: 0 },
  // hh : mm : ss wheel picker. The selection box (band) is fixed; rows roll through it.
  editor: { display: "flex", alignItems: "flex-start", gap: tokens.spacingHorizontalS },
  segment: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
  },
  // The band sits in normal flow so its width sets the column width; only the rows are absolute.
  picker: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    height: `calc(${tokens.lineHeightHero1000} * 3)`,
    overflow: "hidden",
    cursor: "ns-resize",
    touchAction: "none",
    userSelect: "none",
    // Rows fade out towards the top and bottom edges instead of being cut off.
    maskImage: "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
  },
  pickerLarge: { height: `calc(${tokens.fontSizeHero1000} * 4 * 2.8)` },
  band: {
    // TextBox is sized for body text; let it grow to the digits instead of clipping them.
    "& .fui-Input": { minWidth: 0, height: "auto" },
    "& input": {
      fontFamily: deckTokens.fontFamilyDisplay,
      fontSize: tokens.fontSizeHero1000,
      lineHeight: tokens.lineHeightHero1000,
      fontWeight: tokens.fontWeightSemibold,
      fontVariantNumeric: "tabular-nums",
      textAlign: "center",
      cursor: "ns-resize",
      boxSizing: "content-box",
      width: "2ch",
      height: "auto",
      paddingBlock: tokens.spacingVerticalXS,
      paddingInline: tokens.spacingHorizontalXS,
    },
  },
  // While rolling, the rows draw the selected number so it can move; the input's own text hides.
  bandMoving: { "& input": { opacity: 0 } },
  pickerRow: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    textAlign: "center",
    pointerEvents: "auto",
    fontFamily: deckTokens.fontFamilyDisplay,
    fontSize: tokens.fontSizeHero1000,
    lineHeight: tokens.lineHeightHero1000,
    fontWeight: tokens.fontWeightSemibold,
    fontVariantNumeric: "tabular-nums",
    willChange: "transform, opacity",
  },
  pickerRowLarge: {
    fontSize: `calc(${tokens.fontSizeHero1000} * 4)`,
    lineHeight: `calc(${tokens.fontSizeHero1000} * 4)`,
  },
  colon: { fontVariantNumeric: "tabular-nums" },
  // Keeps the colon column the same height as a box so the colons line up with the digits.
  placeholder: { visibility: "hidden" },
  presentationEditor: {
    "& input": { fontSize: `calc(${tokens.fontSizeHero1000} * 4)`, lineHeight: `calc(${tokens.fontSizeHero1000} * 4)` },
  },
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
  finished: {
    backgroundColor: tokens.colorPaletteRedBackground3,
    color: tokens.colorNeutralForegroundStaticInverted,
    // A ring that swells out of the card edge and fades, three times.
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      border: `${tokens.strokeWidthThickest} solid currentColor`,
      pointerEvents: "none",
      opacity: 0,
      animationName: {
        from: { opacity: 0.8, transform: "scale(1)" },
        to: { opacity: 0, transform: "scale(1.06)" },
      },
      animationDuration: "1200ms",
      animationTimingFunction: tokens.curveDecelerateMid,
      animationIterationCount: 3,
    },
    "@media (prefers-reduced-motion: reduce)": { "::after": { animationName: "none" } },
  },
  // The digits pulse a few times when time is up.
  finishedDigits: {
    animationName: {
      "0%": { transform: "scale(1)" },
      "40%": { transform: "scale(1.08)" },
      "100%": { transform: "scale(1)" },
    },
    animationDuration: "600ms",
    animationTimingFunction: tokens.curveEasyEase,
    animationIterationCount: 6,
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
  recent: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
});

const SEGMENTS = [
  { key: "h", label: "시간" },
  { key: "m", label: "분" },
  { key: "s", label: "초" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

function partOf(target: EventTarget | null): Part | null {
  const el = target instanceof Element ? target.closest("[data-part]") : null;
  const part = el?.getAttribute("data-part");
  return part === "h" || part === "m" || part === "s" ? part : null;
}

/** The box being dragged or animated, at a fractional position (picker.ts). */
interface Motion {
  part: Part;
  pos: number;
}

/**
 * Inline hh : mm : ss editor that replaces the digits, drawn as a wheel picker like a phone timer.
 * The selection box stays put; numbers roll through it. Type (two digits move to the next box),
 * drag or flick a column, scroll the wheel, press ↑/↓ or click a neighbour. Enter or leaving the
 * editor applies, Escape cancels. Overflow carries (75 min = 1:15:00).
 */
function TimeEditor({
  initialMs,
  large,
  onApply,
  onCancel,
}: {
  initialMs: number;
  /** Presentation mode size. */
  large: boolean;
  onApply: (ms: number) => void;
  onCancel: () => void;
}) {
  const s = useStyles();
  const [values, setValues] = useState(() => {
    const p = toParts(initialMs);
    return { h: pad(p.h), m: pad(p.m), s: pad(p.s) };
  });
  const [motion, setMotion] = useState<Motion | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const motionRef = useRef(motion);
  motionRef.current = motion;
  /** Running settle animation: its frame and where it ends. */
  const tween = useRef<{ frame: number; part: Part; to: number } | null>(null);
  const drag = useRef<{
    part: Part;
    startY: number;
    startPos: number;
    moved: boolean;
    lastY: number;
    lastT: number;
    /** Values per ms, for the flick. */
    velocity: number;
    /** Offset (±1, ±2) of the neighbour the pointer went down on, if any. */
    pick: number | null;
  } | null>(null);

  const inputs = () => Array.from(ref.current?.querySelectorAll("input") ?? []);
  const restPos = (part: Part) => Number(valuesRef.current[part]) || 0;
  /** Height of the selection box, which sets the spacing of the reel. Measured once it is drawn. */
  const [rowPx, setRowPx] = useState(0);
  useLayoutEffect(() => {
    setRowPx(ref.current?.querySelector("[data-band]")?.getBoundingClientRect().height ?? 0);
  }, [large]);
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Ends a running animation at once, committing its value. */
  const finishTween = () => {
    const t = tween.current;
    if (t === null) return;
    cancelAnimationFrame(t.frame);
    tween.current = null;
    commit(t.part, t.to);
  };
  const commit = (part: Part, pos: number) => {
    setMotion(null);
    const v = valueAt(part, Math.round(pos));
    if (v !== null) setValues((prev) => ({ ...prev, [part]: pad(v) }));
  };

  /** Rolls `part` from `from` to the whole position `to`. */
  const settle = (part: Part, from: number, to: number) => {
    if (tween.current !== null) {
      cancelAnimationFrame(tween.current.frame);
      tween.current = null;
    }
    const ms = reduceMotion() ? 0 : settleMs(to - from);
    if (ms === 0 || from === to) {
      commit(part, to);
      return;
    }
    const begin = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - begin) / ms);
      if (t >= 1) {
        tween.current = null;
        commit(part, to);
        return;
      }
      setMotion({ part, pos: from + (to - from) * easeOut(t) });
      if (tween.current !== null) tween.current.frame = requestAnimationFrame(frame);
    };
    tween.current = { frame: requestAnimationFrame(frame), part, to };
  };

  /** Wheel, arrow keys and neighbour clicks: whole steps, accumulating while a roll is under way. */
  const step = (part: Part, delta: number) => {
    const t = tween.current;
    const running = t !== null && t.part === part;
    if (t !== null && !running) finishTween();
    const from = running ? (motionRef.current?.pos ?? t.to) : restPos(part);
    const base = running ? t.to : restPos(part);
    settle(part, from, clampPos(part, base + delta));
  };

  useEffect(() => {
    inputs()[1]?.focus();
    // React wheel handlers are passive; a native one can keep the page from scrolling.
    const el = ref.current;
    const onWheel = (e: WheelEvent) => {
      const part = partOf(e.target);
      if (part === null || e.deltaY === 0) return;
      e.preventDefault();
      step(part, e.deltaY < 0 ? 1 : -1);
    };
    el?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el?.removeEventListener("wheel", onWheel);
      if (tween.current !== null) cancelAnimationFrame(tween.current.frame);
    };
  }, []);

  const apply = () => {
    const t = tween.current;
    const final = { ...valuesRef.current };
    if (t !== null) {
      const v = valueAt(t.part, Math.round(t.to));
      if (v !== null) final[t.part] = pad(v);
    }
    const ms = fromParts({ h: Number(final.h), m: Number(final.m), s: Number(final.s) });
    if (ms === 0) onCancel();
    else onApply(ms);
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter") {
      e.preventDefault();
      apply();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const part = partOf(e.target);
      if (part === null) return;
      e.preventDefault();
      step(part, e.key === "ArrowUp" ? 1 : -1);
    }
  };

  /** Rows of one column around `pos`; the selected row is drawn by the input while at rest. */
  const reel = (part: Part, pos: number, moving: boolean) => {
    if (rowPx === 0) return null;
    const rows = [];
    for (let k = Math.floor(pos - VISIBLE_DISTANCE); k <= Math.ceil(pos + VISIBLE_DISTANCE); k++) {
      const d = k - pos;
      const value = valueAt(part, k);
      if (value === null || Math.abs(d) >= VISIBLE_DISTANCE || (!moving && d === 0)) continue;
      const { y, scale, opacity } = rowStyle(d, rowPx);
      rows.push(
        <span
          key={k}
          className={mergeClasses(s.pickerRow, large && s.pickerRowLarge)}
          style={{ transform: `translateY(calc(-50% + ${y}px)) scale(${scale})`, opacity }}
          {...(!moving && Math.abs(d) <= 2 ? { "data-pick": d } : {})}
        >
          {pad(value)}
        </span>,
      );
    }
    return rows;
  };

  return (
    <div
      ref={ref}
      role="group"
      aria-label="시간 입력"
      className={s.editor}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target instanceof HTMLInputElement) e.target.select();
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) apply();
      }}
    >
      {SEGMENTS.map(({ key, label }, i) => {
        const moving = motion?.part === key;
        const pos = moving ? motion.pos : restPos(key);
        return (
          <Fragment key={key}>
            {i > 0 && (
              <div className={s.segment} aria-hidden>
                <div className={mergeClasses(s.picker, large && s.pickerLarge)}>
                  <Display className={mergeClasses(s.colon, large && s.pickerRowLarge)}>:</Display>
                </div>
                <Caption className={s.placeholder}>{label}</Caption>
              </div>
            )}
            <div className={s.segment}>
              <div
                className={mergeClasses(s.picker, large && s.pickerLarge)}
                data-part={key}
                // Mouse down would focus and start a text selection; pointer up decides instead.
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  finishTween();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const pick =
                    e.target instanceof Element ? e.target.closest("[data-pick]")?.getAttribute("data-pick") : null;
                  drag.current = {
                    part: key,
                    startY: e.clientY,
                    startPos: restPos(key),
                    moved: false,
                    lastY: e.clientY,
                    lastT: e.timeStamp,
                    velocity: 0,
                    pick: pick === null || pick === undefined ? null : Number(pick),
                  };
                }}
                onPointerMove={(e) => {
                  const d = drag.current;
                  if (d === null) return;
                  const unit = stepPx(rowPx);
                  if (!d.moved && Math.abs(d.startY - e.clientY) < unit / 8) return;
                  d.moved = true;
                  // Dragging up brings the larger numbers below into the box.
                  const dt = e.timeStamp - d.lastT;
                  if (dt > 0) d.velocity = (d.lastY - e.clientY) / unit / dt;
                  d.lastY = e.clientY;
                  d.lastT = e.timeStamp;
                  setMotion({ part: d.part, pos: clampPos(d.part, d.startPos + (d.startY - e.clientY) / unit) });
                }}
                onPointerUp={(e) => {
                  const d = drag.current;
                  drag.current = null;
                  if (d === null) return;
                  if (d.moved) {
                    const pos = motionRef.current?.part === d.part ? motionRef.current.pos : d.startPos;
                    // A pause before letting go means no flick.
                    const velocity = e.timeStamp - d.lastT > 80 ? 0 : d.velocity;
                    settle(d.part, pos, settleTarget(d.part, pos, velocity));
                    return;
                  }
                  // A click on a neighbour picks it; a click on the box focuses it for typing.
                  if (d.pick !== null) step(d.part, d.pick);
                  else inputs()[i]?.focus();
                }}
                onPointerCancel={() => {
                  const d = drag.current;
                  drag.current = null;
                  if (d !== null) commit(d.part, d.startPos);
                }}
              >
                <div className={mergeClasses(s.band, large && s.presentationEditor, moving && s.bandMoving)} data-band>
                  <TextBox
                    header={label}
                    showHeader={false}
                    value={values[key]}
                    onChange={(v) => {
                      const digits = v.replace(/\D/g, "").slice(-2);
                      setValues((prev) => ({ ...prev, [key]: digits }));
                      if (digits.length === 2) inputs()[i + 1]?.focus();
                    }}
                  />
                </div>
                {reel(key, pos, moving)}
              </div>
              <Caption secondary>{label}</Caption>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [timer, setTimer] = useState<TimerState>(() => create(5 * 60 * 1000));
  const [now, setNow] = useState(() => performance.now());
  const [recent, setRecent] = useState<number[]>([]);
  const recentRef = useRef(recent);
  recentRef.current = recent;
  const [presenting, setPresenting] = useState(false);
  const [onTop, setOnTop] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const audio = useRef<AudioContext | null>(null);
  const chime = useRef<Chime>(SILENT);

  useEffect(() => {
    loadRecent(deck)
      .then(setRecent)
      .catch(() => setMessage("최근 기록을 불러오지 못했어요."));
    loadSound(deck)
      .then(setSound)
      .catch(() => undefined);
  }, [deck]);

  useEffect(
    () => () => {
      chime.current.stop();
      void audio.current?.close();
    },
    [],
  );

  // A fresh start (not a resume after pause) goes to the top of the recent list.
  const prevStatus = useRef(timer.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = timer.status;
    if (timer.status !== "finished") {
      chime.current.stop();
      chime.current = SILENT;
    } else if (prev === "running" && soundRef.current) {
      // Audio may start only after a user gesture; starting the timer was one.
      audio.current ??= createAudio();
      const ctx = audio.current;
      if (ctx !== null) {
        void ctx.resume().catch(() => undefined);
        chime.current = playChime(ctx);
      }
    }
    if (timer.status !== "running" || (prev !== "idle" && prev !== "finished")) return;
    const seconds = Math.round(timer.durationMs / 1000);
    void pushRecent(deck, recentRef.current, seconds)
      .then(setRecent)
      .catch(() => setMessage("최근 기록을 저장하지 못했어요."));
  }, [deck, timer.status, timer.durationMs]);

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
      {editing ? (
        <TimeEditor
          initialMs={left}
          large={presenting}
          onApply={(ms) => {
            setTimer(create(ms));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Button
          appearance="transparent"
          className={s.digitsButton}
          aria-label={`남은 시간 ${format(left)}, 눌러서 시간 입력`}
          title="눌러서 시간 입력"
          onClick={() => setEditing(true)}
        >
          <Display className={mergeClasses(s.digits, presenting && s.presentationDigits, finished && s.finishedDigits)}>
            {format(left)}
          </Display>
        </Button>
      )}
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
      <section className={s.recent} aria-label="최근 기록">
        <Caption secondary>최근 기록</Caption>
        {recent.length === 0 ? (
          <Caption secondary>타이머를 시작하면 그 시간이 여기에 남아요.</Caption>
        ) : (
          <div className={s.row}>
            {recent.map((sec) => (
              <Button key={sec} onClick={() => choose(sec)}>
                {format(sec * 1000)}
              </Button>
            ))}
          </div>
        )}
      </section>
      <SettingsCard
        icon={<Speaker2Regular />}
        header="끝날 때 소리"
        description="시간이 끝나면 차임을 울려요."
        action={
          <ToggleSwitch
            header="끝날 때 소리"
            showHeader={false}
            checked={sound}
            onChange={(on) => {
              setSound(on);
              if (!on) chime.current.stop();
              void saveSound(deck, on).catch(() => setMessage("소리 설정을 저장하지 못했어요. 다시 시도해 주세요."));
            }}
          />
        }
      />
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
