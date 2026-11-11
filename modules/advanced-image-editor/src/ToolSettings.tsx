// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Caption,
  CheckBox,
  ColorPicker,
  ComboBox,
  NumberBox,
  SettingsExpander,
  Slider,
  makeStyles,
  tokens,
} from "@deck/ui";
import {
  cropDocument,
  invertSelection,
  resizeCanvas,
  resizeDocument,
  setSelection,
  rectangleSelection,
} from "./core/index.ts";
import type { Color, EditorDocument, Layer, Point } from "./core/model.ts";
import type { SelectionMode } from "./core/selection.ts";
import type { Rect } from "./core/geometry.ts";
import type { EditorOperation } from "./core/preview.ts";
import type { Edit } from "./LayerInspector.tsx";
import { colorHex, parseColor } from "./editor-ui.ts";
import type { Tool } from "./editor-ui.ts";
import { EditorAction } from "./EditorAction.tsx";
interface Size {
  width: number;
  height: number;
}
interface Brush {
  size: number;
  hardness: number;
  opacity: number;
  color: Color;
}
type Setter<T> = Dispatch<SetStateAction<T>>;
interface Props {
  doc: EditorDocument;
  layer: Layer | null;
  tool: Tool;
  edit: Edit;
  worker(label: string, task: EditorOperation): void;
  disabled: boolean;
  rect: Rect;
  setRect: Setter<Rect>;
  polygon: Point[];
  setPolygon: Setter<Point[]>;
  corners: Point[];
  setCorners: Setter<Point[]>;
  corner: string;
  setCorner: Setter<string>;
  perspectiveSize: Size;
  setPerspectiveSize: Setter<Size>;
  selectionMode: SelectionMode;
  setSelectionMode: Setter<SelectionMode>;
  tolerance: number;
  setTolerance: Setter<number>;
  contiguous: boolean;
  setContiguous: Setter<boolean>;
  brush: Brush;
  setBrush: Setter<Brush>;
}
const useStyles = makeStyles({
  sections: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    minWidth: 0,
    "& > div > div:first-child": {
      minHeight: tokens.spacingVerticalXXXL,
      paddingInline: tokens.spacingHorizontalS,
      paddingBlock: tokens.spacingVerticalXS,
    },
    "& > div > div[role='group'] > div": { padding: tokens.spacingHorizontalS },
  },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, minWidth: 0 },
  row: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: tokens.spacingHorizontalS,
    alignItems: "end",
    minWidth: 0,
  },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalXXS },
});
export function ToolSettings(p: Props) {
  const s = useStyles();
  const { doc, layer, tool, edit, worker, disabled } = p;
  const [feather, setFeather] = useState(2);
  const [dimensions, setDimensions] = useState<Size>({ width: doc.width, height: doc.height });
  const [ratio, setRatio] = useState(true);
  const [vertex, setVertex] = useState<Point>({ x: 0, y: 0 });
  useEffect(() => {
    setDimensions({ width: doc.width, height: doc.height });
  }, [doc.width, doc.height]);
  const pixel = layer?.kind === "pixel" && !layer.locked;
  const selected = p.corners[Number(p.corner)] ?? { x: 0, y: 0 };
  const polygonApply = () => {
    worker("다각형 선택", { kind: "polygon", width: doc.width, height: doc.height, points: p.polygon });
    p.setPolygon([]);
  };
  return (
    <div className={s.sections}>
      <SettingsExpander header="선택·누끼" defaultExpanded={tool === "color" || tool.startsWith("mask")}>
        <div className={s.stack}>
          <ComboBox
            header="선택 방식"
            value={p.selectionMode}
            options={[
              { value: "replace", label: "새 선택" },
              { value: "add", label: "추가" },
              { value: "subtract", label: "빼기" },
            ]}
            onChange={p.setSelectionMode}
            disabled={disabled}
          />
          <Slider
            header="색상 허용 오차"
            value={p.tolerance}
            min={0}
            max={255}
            onChange={p.setTolerance}
            disabled={disabled}
          />
          <CheckBox content="연결된 영역만" checked={p.contiguous} onChange={p.setContiguous} disabled={disabled} />
          <div className={s.actions}>
            <EditorAction
              icon="selectinvert"
              label="선택 반전"
              size="small"
              disabled={disabled}
              onClick={() => edit("선택 반전", invertSelection)}
            />
            <EditorAction
              icon="deselect"
              label="선택 해제"
              size="small"
              disabled={disabled || !doc.selection}
              onClick={() => edit("선택 해제", (draft) => setSelection(draft, null))}
            />
          </div>
          {tool === "polygon" && (
            <>
              <Caption>{p.polygon.length}개 꼭짓점 · 캔버스를 누르거나 좌표로 추가해요.</Caption>
              <div className={s.row}>
                <NumberBox
                  header="다각형 점 X"
                  value={vertex.x}
                  min={0}
                  max={doc.width}
                  onChange={(x) => setVertex((v) => ({ ...v, x }))}
                />
                <NumberBox
                  header="다각형 점 Y"
                  value={vertex.y}
                  min={0}
                  max={doc.height}
                  onChange={(y) => setVertex((v) => ({ ...v, y }))}
                />
              </div>
              <div className={s.actions}>
                <EditorAction
                  icon="pointadd"
                  label="꼭짓점 추가"
                  size="small"
                  disabled={disabled || p.polygon.length >= 256}
                  onClick={() => p.setPolygon((pts) => [...pts, { ...vertex }])}
                />
                <EditorAction
                  icon="delete"
                  label="마지막 점 삭제"
                  size="small"
                  disabled={disabled || !p.polygon.length}
                  onClick={() => p.setPolygon((pts) => pts.slice(0, -1))}
                />
              </div>
              <EditorAction
                icon="apply"
                label="다각형 선택 적용"
                size="small"
                disabled={disabled || p.polygon.length < 3}
                onClick={polygonApply}
              />
            </>
          )}
          <div className={s.actions}>
            <EditorAction
              icon="maskhide"
              label="선택 배경 숨기기"
              size="small"
              disabled={disabled || !pixel || !doc.selection}
              onClick={() => {
                if (layer) worker("배경 숨기기", { kind: "mask", doc, id: layer.id, operation: "hide" });
              }}
            />
            <EditorAction
              icon="maskrestore"
              label="선택 영역 복원"
              size="small"
              disabled={disabled || !pixel || !doc.selection}
              onClick={() => {
                if (layer) worker("선택 영역 복원", { kind: "mask", doc, id: layer.id, operation: "restore" });
              }}
            />
          </div>
          <div className={s.row}>
            <NumberBox
              header="경계 부드럽게 · 픽셀"
              value={feather}
              min={0}
              max={64}
              onChange={setFeather}
              disabled={disabled}
            />
            <EditorAction
              icon="feather"
              label="경계 적용"
              size="small"
              disabled={disabled || !pixel || !(layer?.kind === "pixel" && layer.mask)}
              onClick={() => {
                if (layer) worker("마스크 경계 보정", { kind: "feather", doc, id: layer.id, radius: feather });
              }}
            />
          </div>
        </div>
      </SettingsExpander>
      {["brush", "eraser", "mask-hide", "mask-restore", "eyedropper"].includes(tool) && (
        <SettingsExpander header="브러시·지우개" defaultExpanded>
          <div className={s.stack}>
            <NumberBox
              header="브러시 크기 · 픽셀"
              value={p.brush.size}
              min={1}
              max={2048}
              onChange={(size) => p.setBrush((b) => ({ ...b, size }))}
              disabled={disabled}
            />
            <Slider
              header="경도"
              value={Math.round(p.brush.hardness * 100)}
              min={0}
              max={100}
              onChange={(v) => p.setBrush((b) => ({ ...b, hardness: v / 100 }))}
              disabled={disabled}
            />
            <Slider
              header="획 불투명도"
              value={Math.round(p.brush.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => p.setBrush((b) => ({ ...b, opacity: v / 100 }))}
              disabled={disabled}
            />
            <ColorPicker
              header="브러시 색"
              value={colorHex(p.brush.color)}
              onChange={(v) => p.setBrush((b) => ({ ...b, color: parseColor(v) }))}
              disabled={disabled}
            />
            <Caption secondary>획마다 실행 취소해요. 마스크는 복원할 수 있어요.</Caption>
          </div>
        </SettingsExpander>
      )}
      {(tool === "crop" || tool === "rectangle") && (
        <SettingsExpander header="사각형 영역" defaultExpanded>
          <div className={s.stack}>
            <div className={s.row}>
              <NumberBox
                header="영역 X"
                value={p.rect.x}
                min={0}
                max={doc.width - 1}
                onChange={(x) => p.setRect((r) => ({ ...r, x, width: Math.min(r.width, doc.width - x) }))}
              />
              <NumberBox
                header="영역 Y"
                value={p.rect.y}
                min={0}
                max={doc.height - 1}
                onChange={(y) => p.setRect((r) => ({ ...r, y, height: Math.min(r.height, doc.height - y) }))}
              />
              <NumberBox
                header="영역 너비"
                value={p.rect.width}
                min={1}
                max={doc.width - p.rect.x}
                onChange={(width) => p.setRect((r) => ({ ...r, width }))}
              />
              <NumberBox
                header="영역 높이"
                value={p.rect.height}
                min={1}
                max={doc.height - p.rect.y}
                onChange={(height) => p.setRect((r) => ({ ...r, height }))}
              />
            </div>
            <EditorAction
              icon={tool === "crop" ? "crop" : "rectselect"}
              label={tool === "crop" ? "자르기 적용" : "선택 적용"}
              labelVisible
              size="small"
              disabled={disabled}
              onClick={() =>
                edit(tool === "crop" ? "문서 자르기" : "사각형 선택", (draft) => {
                  if (tool === "crop") cropDocument(draft, p.rect);
                  else setSelection(draft, rectangleSelection(draft.width, draft.height, p.rect), p.selectionMode);
                })
              }
            />
          </div>
        </SettingsExpander>
      )}
      {tool === "perspective" && layer?.kind === "pixel" && (
        <SettingsExpander header="네 모서리 원근 보정" defaultExpanded>
          <div className={s.stack}>
            <ComboBox
              header="꼭짓점"
              value={p.corner}
              options={[
                { value: "0", label: "왼쪽 위" },
                { value: "1", label: "오른쪽 위" },
                { value: "2", label: "오른쪽 아래" },
                { value: "3", label: "왼쪽 아래" },
              ]}
              onChange={p.setCorner}
            />
            <div className={s.row}>
              <NumberBox
                header="꼭짓점 X"
                value={Math.round(selected.x)}
                min={0}
                max={layer.pixels.width}
                onChange={(x) => p.setCorners((pts) => pts.map((q, i) => (i === Number(p.corner) ? { ...q, x } : q)))}
              />
              <NumberBox
                header="꼭짓점 Y"
                value={Math.round(selected.y)}
                min={0}
                max={layer.pixels.height}
                onChange={(y) => p.setCorners((pts) => pts.map((q, i) => (i === Number(p.corner) ? { ...q, y } : q)))}
              />
              <NumberBox
                header="보정 너비"
                value={p.perspectiveSize.width}
                min={1}
                max={10000}
                onChange={(width) => p.setPerspectiveSize((v) => ({ ...v, width }))}
              />
              <NumberBox
                header="보정 높이"
                value={p.perspectiveSize.height}
                min={1}
                max={10000}
                onChange={(height) => p.setPerspectiveSize((v) => ({ ...v, height }))}
              />
            </div>
            <EditorAction
              icon="perspective"
              label="원근 보정 적용"
              labelVisible
              size="small"
              disabled={disabled || layer.locked || p.corners.length !== 4}
              onClick={() =>
                worker("원근 보정", {
                  kind: "perspective",
                  doc,
                  id: layer.id,
                  corners: p.corners as [Point, Point, Point, Point],
                  ...p.perspectiveSize,
                })
              }
            />
          </div>
        </SettingsExpander>
      )}
      <SettingsExpander header="문서 크기">
        <div className={s.stack}>
          <div className={s.row}>
            <NumberBox
              header="문서 너비"
              value={dimensions.width}
              min={1}
              max={10000}
              onChange={(width) =>
                setDimensions((v) => ({
                  width,
                  height: ratio ? Math.max(1, Math.round((width * doc.height) / doc.width)) : v.height,
                }))
              }
            />
            <NumberBox
              header="문서 높이"
              value={dimensions.height}
              min={1}
              max={10000}
              onChange={(height) =>
                setDimensions((v) => ({
                  height,
                  width: ratio ? Math.max(1, Math.round((height * doc.width) / doc.height)) : v.width,
                }))
              }
            />
          </div>
          <CheckBox content="가로세로 비율 유지" checked={ratio} onChange={setRatio} />
          <EditorAction
            icon="resize"
            label="전체 이미지 크기 변경"
            labelVisible
            size="small"
            disabled={disabled}
            onClick={() =>
              edit("전체 크기 변경", (draft) => resizeDocument(draft, dimensions.width, dimensions.height))
            }
          />
          <EditorAction
            icon="canvasresize"
            label="캔버스 크기 변경"
            labelVisible
            size="small"
            disabled={disabled}
            onClick={() =>
              edit("캔버스 크기 변경", (draft) => resizeCanvas(draft, dimensions.width, dimensions.height))
            }
          />
          <Caption secondary>캔버스는 사진 크기를 유지하고 오른쪽·아래 영역을 바꿔요.</Caption>
        </div>
      </SettingsExpander>
    </div>
  );
}
