// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// WinUI Canvas/Image/Thumb selection pattern with pixel coordinates independent of display scale.
import { type PointerEvent, useEffect, useId, useRef } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { Image } from "./Image.tsx";
import { BodyStrong, Caption } from "./typography.tsx";
import { deckTokens } from "./tokens/index.ts";
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ImageCropPreviewProps {
  header: string;
  showHeader?: boolean;
  alt: string;
  src: string;
  imageWidth: number;
  imageHeight: number;
  rect: CropRect;
  onRectChange(rect: CropRect): void;
  disabled?: boolean;
}
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export function boundCrop(rect: CropRect, width: number, height: number): CropRect {
  const w = clamp(Math.round(rect.width), 1, Math.max(1, width));
  const h = clamp(Math.round(rect.height), 1, Math.max(1, height));
  return {
    x: clamp(Math.round(rect.x), 0, width - w),
    y: clamp(Math.round(rect.y), 0, height - h),
    width: w,
    height: h,
  };
}
type Point = { x: number; y: number };
type Drag = {
  start: Point;
  rect: CropRect;
  mode: "draw" | "move" | "nw" | "ne" | "sw" | "se";
  pointer: number;
  moved?: boolean;
};
export function dragCrop(drag: Drag, point: Point, width: number, height: number): CropRect {
  if (drag.mode === "move")
    return boundCrop(
      { ...drag.rect, x: drag.rect.x + point.x - drag.start.x, y: drag.rect.y + point.y - drag.start.y },
      width,
      height,
    );
  const fixed =
    drag.mode === "draw"
      ? drag.start
      : {
          x: drag.mode.endsWith("w") ? drag.rect.x + drag.rect.width : drag.rect.x,
          y: drag.mode.startsWith("n") ? drag.rect.y + drag.rect.height : drag.rect.y,
        };
  return boundCrop(
    {
      x: Math.min(point.x, fixed.x),
      y: Math.min(point.y, fixed.y),
      width: Math.max(1, Math.abs(point.x - fixed.x)),
      height: Math.max(1, Math.abs(point.y - fixed.y)),
    },
    width,
    height,
  );
}
const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: deckTokens.cardGap,
    maxWidth: "100%",
  },
  surface: {
    position: "relative",
    display: "inline-flex",
    maxWidth: "100%",
    userSelect: "none",
    touchAction: "none",
    cursor: "crosshair",
    lineHeight: "0",
    ":focus-visible": {
      outlineColor: tokens.colorStrokeFocus2,
      outlineWidth: tokens.strokeWidthThick,
      outlineStyle: "solid",
    },
  },
  image: { display: "block", maxHeight: "52vh", width: "auto", height: "auto", pointerEvents: "none" },
  selection: {
    position: "absolute",
    boxSizing: "border-box",
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    outlineColor: tokens.colorNeutralForegroundOnBrand,
    outlineWidth: tokens.strokeWidthThin,
    outlineStyle: "solid",
    pointerEvents: "none",
  },
  handle: {
    position: "absolute",
    width: tokens.spacingHorizontalS,
    height: tokens.spacingVerticalS,
    backgroundColor: tokens.colorBrandBackground,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralForegroundOnBrand}`,
    transform: "translate(-50%, -50%)",
  },
});
export function ImageCropPreview({
  header,
  showHeader = true,
  alt,
  src,
  imageWidth,
  imageHeight,
  rect,
  onRectChange,
  disabled = false,
}: ImageCropPreviewProps) {
  const s = useStyles();
  const help = useId();
  const drag = useRef<Drag | null>(null);
  useEffect(() => {
    drag.current = null;
  }, [src, imageWidth, imageHeight, disabled]);
  const selected = boundCrop(rect, imageWidth, imageHeight);
  function point(event: PointerEvent<HTMLDivElement>): Point {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - box.left) / Math.max(1, box.width)) * imageWidth, 0, imageWidth),
      y: clamp(((event.clientY - box.top) / Math.max(1, box.height)) * imageHeight, 0, imageHeight),
    };
  }
  return (
    <div className={s.root}>
      {showHeader && <BodyStrong>{header}</BodyStrong>}
      <div
        role="group"
        aria-label={header}
        aria-describedby={help}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={s.surface}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0 || imageWidth <= 0 || imageHeight <= 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          const p = point(event),
            box = event.currentTarget.getBoundingClientRect();
          const nearX = (12 / Math.max(1, box.width)) * imageWidth,
            nearY = (12 / Math.max(1, box.height)) * imageHeight;
          const west = Math.abs(p.x - selected.x) <= nearX,
            east = Math.abs(p.x - selected.x - selected.width) <= nearX;
          const north = Math.abs(p.y - selected.y) <= nearY,
            south = Math.abs(p.y - selected.y - selected.height) <= nearY;
          const inside =
            p.x >= selected.x &&
            p.x <= selected.x + selected.width &&
            p.y >= selected.y &&
            p.y <= selected.y + selected.height;
          const full = selected.width === imageWidth && selected.height === imageHeight;
          const mode: Drag["mode"] =
            north && west
              ? "nw"
              : north && east
                ? "ne"
                : south && west
                  ? "sw"
                  : south && east
                    ? "se"
                    : inside && !full
                      ? "move"
                      : "draw";
          drag.current = { start: p, rect: selected, mode, pointer: event.pointerId };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!disabled && active && active.pointer === event.pointerId) {
            const p = point(event);
            if (p.x !== active.start.x || p.y !== active.start.y) active.moved = true;
            if (active.moved) onRectChange(dragCrop(active, p, imageWidth, imageHeight));
          }
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer === event.pointerId) {
            if (!disabled && drag.current.moved)
              onRectChange(dragCrop(drag.current, point(event), imageWidth, imageHeight));
            drag.current = null;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          const step = event.ctrlKey ? 10 : 1,
            dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
            dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
          onRectChange(
            boundCrop(
              event.shiftKey
                ? { ...selected, width: selected.width + dx, height: selected.height + dy }
                : { ...selected, x: selected.x + dx, y: selected.y + dy },
              imageWidth,
              imageHeight,
            ),
          );
        }}
      >
        <Image src={src} alt={alt} className={s.image} />
        <div
          aria-hidden="true"
          className={s.selection}
          style={{
            left: `${(selected.x / imageWidth) * 100}%`,
            top: `${(selected.y / imageHeight) * 100}%`,
            width: `${(selected.width / imageWidth) * 100}%`,
            height: `${(selected.height / imageHeight) * 100}%`,
          }}
        >
          {[
            [0, 0],
            [100, 0],
            [0, 100],
            [100, 100],
          ].map(([left, top]) => (
            <span key={`${left}-${top}`} className={s.handle} style={{ left: `${left}%`, top: `${top}%` }} />
          ))}
        </div>
      </div>
      <Caption id={help}>
        드래그로 선택 · 선택 영역 안쪽은 이동 · 모서리는 크기 조절 · 방향키 이동 · Shift+방향키 크기 조절
      </Caption>
    </div>
  );
}
