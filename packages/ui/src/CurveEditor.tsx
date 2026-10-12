// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useRef, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { BodyStrong, Caption } from "./typography.tsx";
import { ComboBox, NumberBox } from "./controls.tsx";
import { deckTokens } from "./tokens/index.ts";

export interface CurvePoint {
  x: number;
  y: number;
}
export interface CurveEditorProps {
  header: string;
  points: readonly CurvePoint[];
  onChange(points: CurvePoint[]): void;
  samples?: ArrayLike<number>;
  histogram?: ArrayLike<number>;
  disabled?: boolean;
}
const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  plot: {
    width: "100%",
    maxHeight: "28vh",
    aspectRatio: "1",
    touchAction: "none",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.stroke}`,
    borderRadius: deckTokens.cardRadius,
  },
  diagonal: { stroke: tokens.colorNeutralStroke2, strokeWidth: tokens.strokeWidthThin, fill: "none" },
  curve: { stroke: tokens.colorBrandStroke1, strokeWidth: tokens.strokeWidthThick, fill: "none" },
  histogram: { fill: tokens.colorNeutralBackground5, stroke: "none" },
  point: {
    fill: tokens.colorBrandBackground,
    stroke: tokens.colorNeutralForegroundOnBrand,
    strokeWidth: tokens.strokeWidthThin,
  },
  row: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: deckTokens.inlineGap },
});
const bound = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
/** Canvas/Thumb curve pattern with numeric and keyboard alternatives to every drag. */
export function CurveEditor({ header, points, onChange, samples, histogram, disabled = false }: CurveEditorProps) {
  const s = useStyles();
  const [selected, setSelected] = useState(0);
  const drag = useRef<number | null>(null);
  const index = Math.min(selected, Math.max(0, points.length - 1));
  const current = points[index] ?? { x: 0, y: 0 };
  const replace = (i: number, p: CurvePoint) => {
    const old = points[i];
    if (!old || disabled) return;
    const lower = i === 0 ? 0 : (points[i - 1]?.x ?? 0) + 1;
    const upper = i === points.length - 1 ? 255 : (points[i + 1]?.x ?? 255) - 1;
    const x = i === 0 ? 0 : i === points.length - 1 ? 255 : Math.max(lower, Math.min(upper, bound(p.x)));
    onChange(points.map((q, j) => (j === i ? { x, y: bound(p.y) } : { ...q })));
  };
  const add = (p: CurvePoint) => {
    if (disabled || points.length >= 16) return;
    const x = Math.min(254, Math.max(1, bound(p.x)));
    if (points.some((q) => q.x === x)) return;
    const next = [...points.map((q) => ({ ...q })), { x, y: bound(p.y) }].sort((a, b) => a.x - b.x);
    setSelected(next.findIndex((q) => q.x === x));
    onChange(next);
  };
  const remove = (i: number) => {
    if (disabled || i === 0 || i === points.length - 1) return;
    onChange(points.filter((_, j) => i !== j).map((p) => ({ ...p })));
    setSelected(i - 1);
  };
  const coordinates = (event: { currentTarget: SVGSVGElement; clientX: number; clientY: number }) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: bound(((event.clientX - box.left) * 255) / Math.max(1, box.width)),
      y: bound(255 - ((event.clientY - box.top) * 255) / Math.max(1, box.height)),
    };
  };
  const curve = samples
    ? Array.from({ length: 256 }, (_, x) => `${x},${255 - (samples[x] ?? x)}`).join(" ")
    : points.map((p) => `${p.x},${255 - p.y}`).join(" ");
  const bins = histogram ? Array.from({ length: 256 }, (_, x) => histogram[x] ?? 0) : [];
  const max = Math.max(1, ...bins);
  const hist = bins.length
    ? `0,255 ${bins.map((count, x) => `${x},${255 - (count / max) * 200}`).join(" ")} 255,255`
    : "";
  return (
    <div className={s.root}>
      <BodyStrong>{header}</BodyStrong>
      <svg
        className={s.plot}
        viewBox="0 0 255 255"
        aria-label={`${header} 그래프`}
        role="group"
        onDoubleClick={(event) => add(coordinates(event))}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          const p = coordinates(event);
          const nearest = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 16);
          if (nearest < 0) return;
          drag.current = nearest;
          setSelected(nearest);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current !== null) replace(drag.current, coordinates(event));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {hist && <polygon points={hist} className={s.histogram} />}
        <path d="M0 255 L255 0 M0 127.5 H255 M127.5 0 V255" className={s.diagonal} />
        <polyline points={curve} className={s.curve} />
        {points.map((p, i) => (
          <circle
            key={i}
            className={s.point}
            cx={p.x}
            cy={255 - p.y}
            r={i === index ? 5 : 3.5}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-label={`제어점 ${i + 1}: 입력 ${p.x}, 출력 ${p.y}`}
            onFocus={() => setSelected(i)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 10 : 1;
              if (event.key === "Delete" || event.key === "Backspace") remove(i);
              else if (event.key === "ArrowLeft") replace(i, { ...p, x: p.x - step });
              else if (event.key === "ArrowRight") replace(i, { ...p, x: p.x + step });
              else if (event.key === "ArrowUp") replace(i, { ...p, y: p.y + step });
              else if (event.key === "ArrowDown") replace(i, { ...p, y: p.y - step });
              else return;
              event.preventDefault();
            }}
          />
        ))}
      </svg>
      <ComboBox
        header="제어점"
        value={String(index)}
        options={points.map((_, i) => ({ value: String(i), label: `${i + 1}번 제어점` }))}
        onChange={(value) => setSelected(Number(value))}
        disabled={disabled}
      />
      <div className={s.row}>
        <NumberBox
          header="입력"
          value={current.x}
          min={index === 0 ? 0 : (points[index - 1]?.x ?? 0) + 1}
          max={index === points.length - 1 ? 255 : (points[index + 1]?.x ?? 255) - 1}
          onChange={(x) => replace(index, { ...current, x })}
          disabled={disabled || index === 0 || index === points.length - 1}
        />
        <NumberBox
          header="출력"
          value={current.y}
          min={0}
          max={255}
          onChange={(y) => replace(index, { ...current, y })}
          disabled={disabled}
        />
      </div>
      <div className={s.row}>
        <Button
          disabled={disabled || points.length >= 16}
          onClick={() => {
            const gap = points.findIndex((p, i) => (points[i + 1]?.x ?? p.x) - p.x > 1);
            const a = points[gap];
            const b = points[gap + 1];
            if (a && b) add({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          }}
        >
          제어점 추가
        </Button>
        <Button disabled={disabled || index === 0 || index === points.length - 1} onClick={() => remove(index)}>
          제어점 삭제
        </Button>
      </div>
      <Caption secondary>점을 끌거나 좌표를 입력해요. 점에 포커스를 두고 방향키로 옮길 수 있어요.</Caption>
    </div>
  );
}
