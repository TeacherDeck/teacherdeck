// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useRef, useState } from "react";
import {
  BodyStrong,
  Caption,
  CheckBox,
  ColorPicker,
  ComboBox,
  NumberBox,
  SettingsExpander,
  Slider,
  TextBox,
  makeStyles,
  tokens,
} from "@deck/ui";
import type { EditorDocument, Layer } from "./core/model.ts";
import { layerSize } from "./core/model.ts";
import { localToDocument } from "./core/geometry.ts";
import { colorHex, parseColor } from "./editor-ui.ts";
import { EditorAction } from "./EditorAction.tsx";
export type Edit = (label: string, mutation: (draft: EditorDocument) => void) => void;
const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minWidth: 0, gap: tokens.spacingVerticalS },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "end",
    gap: tokens.spacingHorizontalS,
    minWidth: 0,
  },
  actions: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: tokens.spacingHorizontalXXS },
  section: {
    "& > div > div:first-child": {
      minHeight: tokens.spacingVerticalXXXL,
      paddingInline: tokens.spacingHorizontalS,
      paddingBlock: tokens.spacingVerticalXS,
    },
    "& > div > div[role='group'] > div": { padding: tokens.spacingHorizontalS },
  },
});
export function LayerInspector({
  layer,
  edit,
  disabled,
  draftContent,
  onDraft,
  onApply,
  textFocusRequest = 0,
}: {
  layer: Layer;
  edit: Edit;
  disabled: boolean;
  draftContent: string | undefined;
  onDraft(id: string, content: string): Promise<boolean>;
  onApply(): void;
  textFocusRequest?: number;
}) {
  const s = useStyles();
  const [textExpanded, setTextExpanded] = useState(true);
  useEffect(() => {
    if (!textFocusRequest) return;
    setTextExpanded(true);
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("textarea[aria-label='글자 내용']")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [textFocusRequest]);
  const [content, setContent] = useState(draftContent ?? (layer.kind === "text" ? layer.text.content : ""));
  const request = useRef(0);
  const pendingEdit = useRef<{ id: string; sequence: number } | null>(null);
  const current = useRef({ id: layer.id, content: draftContent ?? (layer.kind === "text" ? layer.text.content : "") });
  current.current = { id: layer.id, content: draftContent ?? (layer.kind === "text" ? layer.text.content : "") };
  useEffect(() => {
    if (pendingEdit.current?.id === layer.id) return;
    pendingEdit.current = null;
    setContent(draftContent ?? (layer.kind === "text" ? layer.text.content : ""));
  }, [layer.id, layer.kind === "text" ? layer.text.content : "", draftContent]);
  const change = (label: string, fn: (item: Layer) => void) =>
    edit(label, (doc) => {
      const current = doc.layers.find((l) => l.id === layer.id);
      if (current) fn(current);
    });
  const locked = disabled || layer.locked;
  const size = layerSize(layer);
  return (
    <div className={s.root}>
      <BodyStrong>레이어 속성</BodyStrong>
      <TextBox
        header="레이어 이름"
        value={layer.name}
        onChange={(name) =>
          change("레이어 이름", (l) => {
            l.name = name.slice(0, 120);
          })
        }
        disabled={disabled}
      />
      <div className={s.row}>
        <CheckBox
          content="표시"
          checked={layer.visible}
          onChange={(visible) =>
            change("레이어 표시", (l) => {
              l.visible = visible;
            })
          }
          disabled={disabled}
        />
        <CheckBox
          content="잠금"
          checked={layer.locked}
          onChange={(value) =>
            change("레이어 잠금", (l) => {
              l.locked = value;
            })
          }
          disabled={disabled}
        />
      </div>
      <div className={s.row}>
        <Slider
          header="불투명도"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          onChange={(value) =>
            change("레이어 불투명도", (l) => {
              l.opacity = value / 100;
            })
          }
          disabled={locked}
        />
        <ComboBox
          header="혼합 모드"
          value={layer.blend}
          options={[
            { value: "normal", label: "일반" },
            { value: "multiply", label: "곱하기" },
            { value: "screen", label: "스크린" },
          ]}
          onChange={(blend) =>
            change("혼합 모드", (l) => {
              l.blend = blend;
            })
          }
          disabled={locked}
        />
      </div>
      <div className={s.section}>
        <SettingsExpander header="위치·크기·회전" defaultExpanded>
          <div className={s.root}>
            <div className={s.row}>
              <NumberBox
                header="X 위치"
                value={Math.round(layer.transform.x)}
                onChange={(x) =>
                  change("레이어 이동", (l) => {
                    l.transform.x = x;
                  })
                }
                disabled={locked}
              />
              <NumberBox
                header="Y 위치"
                value={Math.round(layer.transform.y)}
                onChange={(y) =>
                  change("레이어 이동", (l) => {
                    l.transform.y = y;
                  })
                }
                disabled={locked}
              />
              <NumberBox
                header="레이어 너비"
                value={Math.max(1, Math.round(size.width * Math.abs(layer.transform.scaleX)))}
                min={1}
                max={10000}
                onChange={(width) =>
                  change("레이어 크기", (l) => {
                    l.transform.scaleX = (Math.sign(l.transform.scaleX) * width) / size.width;
                  })
                }
                disabled={locked}
              />
              <NumberBox
                header="레이어 높이"
                value={Math.max(1, Math.round(size.height * Math.abs(layer.transform.scaleY)))}
                min={1}
                max={10000}
                onChange={(height) =>
                  change("레이어 크기", (l) => {
                    l.transform.scaleY = (Math.sign(l.transform.scaleY) * height) / size.height;
                  })
                }
                disabled={locked}
              />
            </div>
            <div className={s.row}>
              <NumberBox
                header="회전 각도"
                value={layer.transform.rotation}
                min={-360}
                max={360}
                step={0.1}
                onChange={(rotation) =>
                  change("레이어 회전", (l) => {
                    l.transform.rotation = rotation;
                  })
                }
                disabled={locked}
              />
              <div className={s.actions}>
                <EditorAction
                  icon="flipH"
                  label="좌우 반전"
                  size="small"
                  disabled={locked}
                  onClick={() =>
                    change("좌우 반전", (l) => {
                      l.transform.x +=
                        size.width * l.transform.scaleX * Math.cos((l.transform.rotation * Math.PI) / 180);
                      l.transform.y +=
                        size.width * l.transform.scaleX * Math.sin((l.transform.rotation * Math.PI) / 180);
                      l.transform.scaleX *= -1;
                    })
                  }
                />
                <EditorAction
                  icon="flipV"
                  label="상하 반전"
                  size="small"
                  disabled={locked}
                  onClick={() =>
                    change("상하 반전", (l) => {
                      const end = localToDocument({ x: 0, y: size.height }, l.transform);
                      l.transform.x = end.x;
                      l.transform.y = end.y;
                      l.transform.scaleY *= -1;
                    })
                  }
                />
              </div>
            </div>
          </div>
        </SettingsExpander>
      </div>
      {layer.kind === "text" && (
        <div className={s.section}>
          <SettingsExpander header="글자" expanded={textExpanded} onExpandedChange={setTextExpanded}>
            <div className={s.root}>
              <TextBox
                header="글자 내용"
                multiline
                rows={3}
                value={content}
                onChange={(value) => {
                  const next = value.slice(0, 10000);
                  setContent(next);
                  const sequence = ++request.current;
                  pendingEdit.current = { id: layer.id, sequence };
                  void onDraft(layer.id, next).then((accepted) => {
                    if (sequence === request.current) {
                      pendingEdit.current = null;
                      if (current.current.id === layer.id) setContent(accepted ? next : current.current.content);
                    }
                  });
                }}
                disabled={locked}
                description="입력한 내용도 작업 저장에 포함돼요."
              />
              <div className={s.actions}>
                <EditorAction
                  icon="apply"
                  label="글자 적용"
                  size="small"
                  disabled={locked || content === layer.text.content}
                  onClick={onApply}
                />
              </div>
              <TextBox
                header="설치된 글꼴 이름"
                value={layer.text.fontFamily}
                onChange={(fontFamily) =>
                  change("글꼴", (l) => {
                    if (l.kind === "text") l.text.fontFamily = fontFamily.slice(0, 120);
                  })
                }
                disabled={locked}
                description="PC에 설치된 글꼴을 써요. 글꼴이 없으면 기본 글꼴로 보여요."
              />
              <div className={s.row}>
                <NumberBox
                  header="글자 크기"
                  value={layer.text.fontSize}
                  min={1}
                  max={1000}
                  onChange={(fontSize) =>
                    change("글자 크기", (l) => {
                      if (l.kind === "text") l.text.fontSize = fontSize;
                    })
                  }
                  disabled={locked}
                />
                <ColorPicker
                  header="글자 색"
                  value={colorHex(layer.text.color)}
                  onChange={(value) =>
                    change("글자 색", (l) => {
                      if (l.kind === "text") l.text.color = parseColor(value);
                    })
                  }
                  disabled={locked}
                />
              </div>
              <div className={s.row}>
                <CheckBox
                  content="굵게"
                  checked={layer.text.bold}
                  onChange={(value) =>
                    change("글자 굵기", (l) => {
                      if (l.kind === "text") l.text.bold = value;
                    })
                  }
                  disabled={locked}
                />
                <CheckBox
                  content="기울임"
                  checked={layer.text.italic}
                  onChange={(value) =>
                    change("글자 기울임", (l) => {
                      if (l.kind === "text") l.text.italic = value;
                    })
                  }
                  disabled={locked}
                />
              </div>
              <ComboBox
                header="글자 정렬"
                value={layer.text.align}
                options={[
                  { value: "left", label: "왼쪽" },
                  { value: "center", label: "가운데" },
                  { value: "right", label: "오른쪽" },
                ]}
                onChange={(align) =>
                  change("글자 정렬", (l) => {
                    if (l.kind === "text") l.text.align = align;
                  })
                }
                disabled={locked}
              />
              <div className={s.row}>
                <NumberBox
                  header="글자 영역 너비"
                  value={layer.text.width}
                  min={1}
                  max={10000}
                  onChange={(width) =>
                    change("글자 영역", (l) => {
                      if (l.kind === "text") l.text.width = width;
                    })
                  }
                  disabled={locked}
                />
                <NumberBox
                  header="글자 영역 높이"
                  value={layer.text.height}
                  min={1}
                  max={10000}
                  onChange={(height) =>
                    change("글자 영역", (l) => {
                      if (l.kind === "text") l.text.height = height;
                    })
                  }
                  disabled={locked}
                />
              </div>
              <Caption secondary>레이어별 단일 글자 서식</Caption>
            </div>
          </SettingsExpander>
        </div>
      )}
      {layer.kind === "shape" && (
        <div className={s.section}>
          <SettingsExpander header="도형" defaultExpanded>
            <div className={s.row}>
              <ColorPicker
                header="도형 색"
                value={colorHex(layer.shape.color)}
                onChange={(value) =>
                  change("도형 색", (l) => {
                    if (l.kind === "shape") l.shape.color = parseColor(value);
                  })
                }
                disabled={locked}
              />
              <NumberBox
                header="선 두께"
                value={layer.shape.strokeWidth}
                min={1}
                max={100}
                onChange={(strokeWidth) =>
                  change("도형 선", (l) => {
                    if (l.kind === "shape") l.shape.strokeWidth = strokeWidth;
                  })
                }
                disabled={locked}
              />
            </div>
          </SettingsExpander>
        </div>
      )}
    </div>
  );
}
