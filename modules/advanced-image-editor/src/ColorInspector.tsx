// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useMemo, useRef, useState } from "react";
import { Caption, ComboBox, CurveEditor, NumberBox, SettingsExpander, Slider, makeStyles, tokens } from "@deck/ui";
import type { Adjustments, Channel, PixelLayer } from "./core/model.ts";
import { identityAdjustments, rasterVersion } from "./core/model.ts";
import { curveLut } from "./core/color.ts";
import { CHANNEL_OPTIONS } from "./editor-ui.ts";
import { EditorAction } from "./EditorAction.tsx";
const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minWidth: 0, gap: tokens.spacingVerticalS },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  actions: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalXXS },
  section: {
    "& > div > div:first-child": {
      minHeight: tokens.spacingVerticalXXXL,
      paddingInline: tokens.spacingHorizontalS,
      paddingBlock: tokens.spacingVerticalXS,
    },
    "& > div > div[role='group'] > div": { padding: tokens.spacingHorizontalS },
  },
  curve: { "& > div": { gap: tokens.spacingVerticalS } },
});
export function ColorInspector({
  layer,
  pending,
  disabled,
  onPreview,
  onDraft,
  onApply,
}: {
  layer: PixelLayer;
  pending: Adjustments | undefined;
  disabled: boolean;
  onPreview: (id: string, adjustments: Adjustments | null) => void;
  onDraft: (id: string, adjustments: Adjustments) => Promise<boolean>;
  onApply: () => void;
}) {
  const s = useStyles();
  const [draft, setDraft] = useState<Adjustments>(() => structuredClone(pending ?? layer.adjustments));
  const request = useRef(0);
  const pendingEdit = useRef<{ id: string; sequence: number } | null>(null);
  const current = useRef({ id: layer.id, adjustments: pending ?? layer.adjustments });
  current.current = { id: layer.id, adjustments: pending ?? layer.adjustments };
  const [channel, setChannel] = useState<Channel>("rgb");
  const committed = JSON.stringify(layer.adjustments);
  useEffect(() => {
    if (pendingEdit.current?.id === layer.id) return;
    pendingEdit.current = null;
    setDraft(structuredClone(pending ?? layer.adjustments));
  }, [layer.id, committed, pending]);
  useEffect(() => {
    if (pending) onPreview(layer.id, pending);
  }, [layer.id, pending, onPreview]);
  useEffect(() => () => onPreview(layer.id, null), [layer.id, onPreview]);
  const stage = (next: Adjustments) => {
    setDraft(next);
    const sequence = ++request.current;
    pendingEdit.current = { id: layer.id, sequence };
    void onDraft(layer.id, next).then((accepted) => {
      if (sequence === request.current) {
        pendingEdit.current = null;
        if (current.current.id === layer.id) setDraft(structuredClone(accepted ? next : current.current.adjustments));
      }
    });
  };
  const update = (fn: (value: Adjustments) => void) => {
    const next = structuredClone(draft);
    fn(next);
    stage(next);
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(layer.adjustments);
  const level = draft.levels[channel];
  const pixelVersion = rasterVersion(layer.pixels.data);
  const histogram = useMemo(() => {
    // Bounded sampling gives immediate, explicitly labelled preview histogram without blocking full-image scans.
    const bins = new Uint32Array(256);
    const data = layer.pixels.data;
    const stride = Math.max(1, Math.ceil(data.length / (4 * 16384))) * 4;
    for (let i = 0; i < data.length; i += stride) {
      if (!data[i + 3]) continue;
      const r = data[i] ?? 0,
        g = data[i + 1] ?? 0,
        b = data[i + 2] ?? 0;
      const value =
        channel === "rgb"
          ? Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
          : channel === "r"
            ? r
            : channel === "g"
              ? g
              : b;
      bins[value] = (bins[value] ?? 0) + 1;
    }
    return bins;
  }, [layer.pixels.data, pixelVersion, channel]);
  const locked = disabled || layer.locked;
  return (
    <div className={s.section}>
      <SettingsExpander
        header="색보정"
        defaultExpanded
        action={
          <div className={s.actions}>
            <EditorAction
              icon="apply"
              label="보정 적용"
              size="small"
              disabled={locked || !changed}
              appearance="primary"
              onClick={onApply}
            />
            <EditorAction
              icon="reset"
              label="보정 초기화"
              size="small"
              disabled={locked}
              onClick={() => {
                const next = identityAdjustments();
                stage(next);
              }}
            />
          </div>
        }
      >
        <div className={s.root}>
          <div className={s.row}>
            <Slider
              header="명도"
              value={Math.round(draft.brightness * 100)}
              min={-100}
              max={100}
              onChange={(n) =>
                update((a) => {
                  a.brightness = n / 100;
                })
              }
              disabled={locked}
            />
            <Slider
              header="대비"
              value={Math.round(draft.contrast * 100)}
              min={-100}
              max={100}
              onChange={(n) =>
                update((a) => {
                  a.contrast = n / 100;
                })
              }
              disabled={locked}
            />
          </div>
          <ComboBox
            header="레벨·곡선 채널"
            value={channel}
            options={CHANNEL_OPTIONS}
            onChange={setChannel}
            disabled={locked}
          />
          <div className={s.section}>
            <SettingsExpander header="레벨">
              <div className={s.row}>
                <NumberBox
                  header="입력 검정"
                  value={level.black}
                  min={0}
                  max={level.white - 1}
                  onChange={(n) =>
                    update((a) => {
                      a.levels[channel].black = n;
                    })
                  }
                  disabled={locked}
                />
                <NumberBox
                  header="입력 흰색"
                  value={level.white}
                  min={level.black + 1}
                  max={255}
                  onChange={(n) =>
                    update((a) => {
                      a.levels[channel].white = n;
                    })
                  }
                  disabled={locked}
                />
                <NumberBox
                  header="감마"
                  value={level.gamma}
                  min={0.1}
                  max={10}
                  step={0.05}
                  onChange={(n) =>
                    update((a) => {
                      a.levels[channel].gamma = n;
                    })
                  }
                  disabled={locked}
                />
                <NumberBox
                  header="출력 검정"
                  value={level.outputBlack}
                  min={0}
                  max={level.outputWhite}
                  onChange={(n) =>
                    update((a) => {
                      a.levels[channel].outputBlack = n;
                    })
                  }
                  disabled={locked}
                />
                <NumberBox
                  header="출력 흰색"
                  value={level.outputWhite}
                  min={level.outputBlack}
                  max={255}
                  onChange={(n) =>
                    update((a) => {
                      a.levels[channel].outputWhite = n;
                    })
                  }
                  disabled={locked}
                />
              </div>
            </SettingsExpander>
          </div>
          <div className={s.curve}>
            <CurveEditor
              header="곡선"
              points={draft.curves[channel]}
              samples={curveLut(draft.curves[channel])}
              histogram={histogram}
              onChange={(points) =>
                update((a) => {
                  a.curves[channel] = points;
                })
              }
              disabled={locked}
            />
          </div>
          <Caption secondary>원본 픽셀 표본 · 전체 RGB는 세 채널에 동일 적용</Caption>
          {changed && <Caption>현재 미리보기도 저장돼요.</Caption>}
        </div>
      </SettingsExpander>
    </div>
  );
}
