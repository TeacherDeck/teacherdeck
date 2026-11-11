// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useId, useRef, useState } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { BodyStrong, Caption } from "./typography.tsx";
import { deckTokens } from "./tokens/index.ts";

export interface CanvasPoint {
  x: number;
  y: number;
}
export interface CanvasGesture {
  phase: "start" | "move" | "end" | "cancel";
  point: CanvasPoint;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}
export interface CanvasSurfaceProps {
  header: string;
  alt: string;
  source: CanvasImageSource | null;
  width: number;
  height: number;
  zoom: number;
  disabled?: boolean;
  cursor?: "crosshair" | "grab" | "default";
  points?: readonly CanvasPoint[];
  rectangle?: { x: number; y: number; width: number; height: number } | null;
  selection?: { width: number; height: number; data: Uint8Array } | null;
  stroke?: { points: readonly CanvasPoint[]; color: string; width: number; opacity: number } | null;
  onGesture?(gesture: CanvasGesture): void;
  onKey?(key: string, shift: boolean): boolean;
}
const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: deckTokens.cardGap, minWidth: 0, height: "100%" },
  scroll: {
    overflow: "auto",
    minHeight: "32vh",
    maxHeight: "70vh",
    flexGrow: 1,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  surface: {
    position: "relative",
    display: "block",
    touchAction: "none",
    userSelect: "none",
    maxWidth: "none",
    ":focus-visible": {
      outlineStyle: "solid",
      outlineColor: tokens.colorStrokeFocus2,
      outlineWidth: tokens.strokeWidthThick,
    },
  },
  overlay: {
    position: "absolute",
    width: "100%",
    height: "100%",
    inset: 0,
    pointerEvents: "none",
    color: tokens.colorNeutralForeground1,
  },
  mark: { fill: "none", stroke: tokens.colorBrandStroke1, strokeWidth: tokens.strokeWidthThick },
  point: {
    fill: tokens.colorBrandBackground,
    stroke: tokens.colorNeutralForegroundOnBrand,
    strokeWidth: tokens.strokeWidthThin,
  },
});
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
/** WinUI Canvas/ScrollViewer surface. Numeric tool inputs complement its keyboard pointer. */
export function CanvasSurface({
  header,
  alt,
  source,
  width,
  height,
  zoom,
  disabled = false,
  cursor = "crosshair",
  points = [],
  rectangle = null,
  selection = null,
  stroke = null,
  onGesture,
  onKey,
}: CanvasSurfaceProps) {
  const s = useStyles();
  const help = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const pointer = useRef<CanvasPoint>({ x: 0, y: 0 });
  const [keyboardPointer, setKeyboardPointer] = useState<CanvasPoint | null>(null);
  const backingScale = Math.min(1, 1400 / Math.max(1, width, height));
  const bw = Math.max(1, Math.round(width * backingScale));
  const bh = Math.max(1, Math.round(height * backingScale));
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, bw, bh);
    // Checker colors come from the current Fluent theme.
    const style = getComputedStyle(canvas.current as HTMLCanvasElement);
    const light = style.getPropertyValue("--colorNeutralBackground1") || style.backgroundColor;
    const dark = style.getPropertyValue("--colorNeutralBackground3") || style.color;
    const size = 12;
    context.fillStyle = light;
    context.fillRect(0, 0, bw, bh);
    context.fillStyle = dark;
    for (let y = 0; y < bh; y += size)
      for (let x = 0; x < bw; x += size)
        if ((Math.floor(x / size) + Math.floor(y / size)) % 2) context.fillRect(x, y, size, size);
    if (source) context.drawImage(source, 0, 0, bw, bh);
  }, [source, bw, bh]);
  useEffect(() => {
    const context = overlay.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, bw, bh);
    if (!selection) return;
    context.fillStyle = getComputedStyle(overlay.current as HTMLCanvasElement).color;
    context.fillRect(0, 0, 1, 1);
    const ink = context.getImageData(0, 0, 1, 1).data;
    context.clearRect(0, 0, bw, bh);
    const data = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const sx = Math.min(selection.width - 1, Math.floor((x * selection.width) / bw));
        const sy = Math.min(selection.height - 1, Math.floor((y * selection.height) / bh));
        if (!selection.data[sy * selection.width + sx]) continue;
        if ((x + y) % 8 < 2) {
          const i = (y * bw + x) * 4;
          data[i] = ink[0] ?? 0;
          data[i + 1] = ink[1] ?? 0;
          data[i + 2] = ink[2] ?? 0;
          data[i + 3] = 140;
        }
      }
    context.putImageData(new ImageData(data, bw, bh), 0, 0);
  }, [selection, bw, bh]);
  const location = (event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - box.left) * width) / Math.max(1, box.width), 0, width - 1),
      y: clamp(((event.clientY - box.top) * height) / Math.max(1, box.height), 0, height - 1),
    };
  };
  const emit = (
    phase: CanvasGesture["phase"],
    point: CanvasPoint,
    event: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean },
  ) => onGesture?.({ phase, point, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey });
  return (
    <div className={s.root}>
      <BodyStrong>{header}</BodyStrong>
      <div className={s.scroll} ref={viewport}>
        <div
          className={s.surface}
          role="group"
          aria-label={alt}
          aria-describedby={help}
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
          style={{ width: Math.max(1, width * zoom), height: Math.max(1, height * zoom), cursor }}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            active.current = event.pointerId;
            setKeyboardPointer(null);
            if (cursor === "grab" && viewport.current) {
              pan.current = {
                x: event.clientX,
                y: event.clientY,
                left: viewport.current.scrollLeft,
                top: viewport.current.scrollTop,
              };
              return;
            }
            pointer.current = location(event);
            emit("start", pointer.current, event);
          }}
          onPointerMove={(event) => {
            if (active.current !== event.pointerId || disabled) return;
            if (pan.current && viewport.current) {
              viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
              viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
              return;
            }
            pointer.current = location(event);
            emit("move", pointer.current, event);
          }}
          onPointerUp={(event) => {
            if (active.current !== event.pointerId) return;
            if (!pan.current) {
              pointer.current = location(event);
              emit("end", pointer.current, event);
            }
            pan.current = null;
            active.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (active.current === event.pointerId) {
              active.current = null;
              if (!pan.current) emit("cancel", pointer.current, event);
              pan.current = null;
            }
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (cursor === "grab" && viewport.current && event.key.startsWith("Arrow")) {
              const delta = event.shiftKey ? 100 : 20;
              viewport.current.scrollLeft +=
                event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
              viewport.current.scrollTop += event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
              event.preventDefault();
              return;
            }
            if (onKey?.(event.key, event.shiftKey)) {
              event.preventDefault();
              return;
            }
            const delta = event.shiftKey ? 10 : 1;
            const p = pointer.current;
            if (event.key === "ArrowLeft") p.x = clamp(p.x - delta, 0, width - 1);
            else if (event.key === "ArrowRight") p.x = clamp(p.x + delta, 0, width - 1);
            else if (event.key === "ArrowUp") p.y = clamp(p.y - delta, 0, height - 1);
            else if (event.key === "ArrowDown") p.y = clamp(p.y + delta, 0, height - 1);
            else if (event.key === "Enter" || event.key === " ") {
              emit("start", { ...p }, event);
              emit("end", { ...p }, event);
            } else return;
            setKeyboardPointer({ ...p });
            event.preventDefault();
          }}
        >
          <canvas ref={canvas} width={bw} height={bh} style={{ width: "100%", height: "100%", display: "block" }} />
          <canvas ref={overlay} width={bw} height={bh} className={s.overlay} />
          <svg className={s.overlay} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {stroke && stroke.points.length > 0 && (
              <polyline
                points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeOpacity={stroke.opacity}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {rectangle && <rect {...rectangle} className={s.mark} vectorEffect="non-scaling-stroke" />}
            {points.length > 1 && (
              <polyline
                points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                className={s.mark}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 / zoom} className={s.point} />
            ))}
            {keyboardPointer && (
              <circle cx={keyboardPointer.x} cy={keyboardPointer.y} r={5 / zoom} className={s.point} />
            )}
          </svg>
        </div>
      </div>
      <Caption secondary id={help}>
        {cursor === "grab"
          ? "드래그하거나 방향키로 화면을 옮겨요."
          : "방향키로 포인터를 옮기고 Enter로 현재 도구를 사용해요. Shift를 누르면 10픽셀씩 옮겨요."}
        {keyboardPointer && ` 포인터: ${Math.round(keyboardPointer.x)}, ${Math.round(keyboardPointer.y)}`}
      </Caption>
    </div>
  );
}
