// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Launch screen drawn inside the shell while it loads app info and modules (design-system.md §1).
// Three deck cards fan out under the app icon; when `leaving` turns on the screen fades away over
// the home, whose cards stagger in underneath. No separate window, no fixed wait (ADR-0024).
import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Caption, Subtitle, deckTokens } from "@deck/ui";
import { useEffect, useRef } from "react";

/** Hands over even if no animation frames run (window occluded or minimized at launch). */
const LEAVE_FALLBACK_MS = 1000;

const fan = (turn: string) => ({
  from: { opacity: 0, transform: `translateY(${deckTokens.motionPageOffset}) rotate(0deg)` },
  to: { opacity: 1, transform: `translateY(0) rotate(${turn})` },
});

const useStyles = makeStyles({
  root: {
    position: "absolute",
    inset: 0,
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: deckTokens.itemGap,
    pointerEvents: "none",
  },
  leave: {
    animationName: { from: { opacity: 1, transform: "none" }, to: { opacity: 0, transform: "scale(1.04)" } },
    animationDuration: tokens.durationNormal,
    animationTimingFunction: tokens.curveAccelerateMid,
    animationFillMode: "forwards",
  },
  // Static end state: what reduced motion shows, and where the animations land.
  deck: {
    position: "relative",
    width: deckTokens.launchCardWidth,
    height: deckTokens.launchCardHeight,
    marginBottom: tokens.spacingVerticalXL,
  },
  card: {
    position: "absolute",
    inset: 0,
    transformOrigin: "50% 100%",
    backgroundColor: deckTokens.cardFill,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusXLarge,
  },
  left: { transform: "rotate(-14deg)" },
  right: { transform: "rotate(14deg)" },
  front: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  logo: { width: tokens.fontSizeHero900, height: tokens.fontSizeHero900 },
  animated: {
    animationDuration: tokens.durationSlower,
    animationTimingFunction: tokens.curveDecelerateMax,
    animationFillMode: "backwards",
  },
  fanLeft: { animationName: fan("-14deg"), animationDelay: tokens.durationFaster },
  fanRight: { animationName: fan("14deg"), animationDelay: tokens.durationFaster },
  fanFront: { animationName: fan("0deg") },
  textIn: {
    animationName: {
      from: { opacity: 0, transform: `translateY(calc(${deckTokens.motionPageOffset} / 2))` },
      to: { opacity: 1, transform: "none" },
    },
    animationDuration: tokens.durationSlow,
    animationTimingFunction: tokens.curveDecelerateMid,
    animationFillMode: "backwards",
    animationDelay: tokens.durationNormal,
  },
});

export interface LaunchScreenProps {
  /** Plays the fan-out and fade-away (design-system.md §1 셸 모션). */
  motion: boolean;
  /** Fade away, then call `onLeft` (after the animation, or a fallback timer). */
  leaving: boolean;
  /** Status line under the app name, e.g. how many tools were added. */
  message: string;
  onLeft(): void;
}

export function LaunchScreen({ motion, leaving, message, onLeft }: LaunchScreenProps) {
  const s = useStyles();
  const onLeftRef = useRef(onLeft);
  onLeftRef.current = onLeft;
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => onLeftRef.current(), LEAVE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const a = (cls: string) => (motion ? mergeClasses(s.animated, cls) : undefined);
  return (
    <div
      className={mergeClasses(s.root, leaving && motion && s.leave)}
      role="status"
      aria-label={message}
      onAnimationEnd={(e) => {
        if (leaving && e.target === e.currentTarget) onLeft();
      }}
    >
      <div className={s.deck} aria-hidden>
        <span className={mergeClasses(s.card, s.left, a(s.fanLeft))} />
        <span className={mergeClasses(s.card, s.right, a(s.fanRight))} />
        <span className={mergeClasses(s.card, s.front, a(s.fanFront))}>
          <img className={s.logo} src="/app-icon.png" alt="" />
        </span>
      </div>
      <Subtitle {...(motion ? { className: s.textIn } : {})}>TeacherDeck</Subtitle>
      <Caption secondary {...(motion ? { className: s.textIn } : {})}>
        {message}
      </Caption>
    </div>
  );
}
