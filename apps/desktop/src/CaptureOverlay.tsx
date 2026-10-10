// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { OverlayUiAction, OverlayUiState } from "@deck/sdk";
import { Button, DeckProvider, InfoBar, Tooltip, deckTokens, makeStyles, mergeClasses, tokens } from "@deck/ui";
import { CameraRegular, DismissRegular, FolderOpenRegular, PinRegular, SettingsRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { OverlayControls, ResizeDirection } from "./host.ts";
import { useColorMode } from "./theme.ts";
import { createDeckTheme } from "@deck/ui";
const useStyles = makeStyles({
  region: {
    position: "fixed",
    top: deckTokens.captureToolbarHeight,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: deckTokens.captureHitTestFill,
    boxSizing: "border-box",
    border: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    cursor: "move",
    userSelect: "none",
    touchAction: "none",
    overflow: "hidden",
    ":focus-visible": {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})`,
    },
  },
  flash: { boxShadow: `inset 0 0 0 ${tokens.spacingHorizontalS} ${tokens.colorPaletteGreenBorderActive}` },
  edge: {
    position: "absolute",
    backgroundColor: "transparent",
    border: "none",
    padding: 0,
    ":focus-visible": { backgroundColor: tokens.colorBrandBackground },
  },
  north: { left: 0, right: 0, top: 0, height: tokens.spacingVerticalS, cursor: "ns-resize" },
  south: { left: 0, right: 0, bottom: 0, height: tokens.spacingVerticalS, cursor: "ns-resize" },
  east: { top: 0, bottom: 0, right: 0, width: tokens.spacingHorizontalS, cursor: "ew-resize" },
  west: { top: 0, bottom: 0, left: 0, width: tokens.spacingHorizontalS, cursor: "ew-resize" },
  corner: { width: tokens.spacingHorizontalM, height: tokens.spacingVerticalM },
  northWest: { left: 0, top: 0, cursor: "nwse-resize" },
  northEast: { right: 0, top: 0, cursor: "nesw-resize" },
  southWest: { left: 0, bottom: 0, cursor: "nesw-resize" },
  southEast: { right: 0, bottom: 0, cursor: "nwse-resize" },
  toolbar: {
    position: "fixed",
    top: tokens.spacingVerticalXXS,
    right: 0,
    display: "flex",
    alignItems: "center",
    height: deckTokens.captureToolbarSurfaceHeight,
    maxWidth: "100%",
    overflowX: "auto",
    overflowY: "hidden",
    whiteSpace: "nowrap",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: deckTokens.cardRadius,
  },
  miniButton: {
    minWidth: deckTokens.captureToolbarButtonSize,
    width: deckTokens.captureToolbarButtonSize,
    height: deckTokens.captureToolbarButtonSize,
    padding: 0,
    flexShrink: 0,
  },
  status: { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
});
export function CaptureOverlay({ controls }: { controls: OverlayControls }) {
  const s = useStyles();
  const [state, setState] = useState<OverlayUiState | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  const previousSequence = useRef<number | undefined>(undefined);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const mode = useColorMode("system");
  useEffect(() => {
    const elements = [document.documentElement, document.body, document.getElementById("root")].filter(
      (element): element is HTMLElement => element !== null,
    );
    const previous = elements.map((element) => ({
      element,
      background: element.style.background,
      overflow: element.style.overflow,
    }));
    for (const element of elements) {
      element.style.background = "transparent";
      element.style.overflow = "hidden";
    }
    return () => {
      for (const { element, background, overflow } of previous) {
        element.style.background = background;
        element.style.overflow = overflow;
      }
    };
  }, []);
  useEffect(() => {
    let active = true;
    const set = (next: OverlayUiState) => {
      if (active) {
        setState(next);
        setError("");
      }
    };
    const off = controls.onState(set);
    void controls
      .state()
      .then(set)
      .catch(() => {
        if (active) setError("영역 상태를 불러오지 못했어요. 퀵캡처에서 다시 시작해 주세요.");
      });
    return () => {
      active = false;
      void off.then((fn) => fn()).catch(() => undefined);
    };
  }, [controls]);
  useEffect(() => {
    const sequence = state?.session?.sequence;
    const prior = previousSequence.current;
    previousSequence.current = sequence;
    if (prior === undefined || sequence === undefined || sequence <= prior) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 120);
    return () => clearTimeout(timer);
  }, [state?.session?.sequence]);
  const act = (action: OverlayUiAction) => {
    void controls.action(action).catch(() => setError("작업하지 못했어요. 설정에서 폴더와 단축키를 확인해 주세요."));
  };
  const edges: { direction: ResizeDirection; label: string; className: string }[] = [
    { direction: "North", label: "위쪽 크기 조절", className: s.north },
    { direction: "South", label: "아래쪽 크기 조절", className: s.south },
    { direction: "East", label: "오른쪽 크기 조절", className: s.east },
    { direction: "West", label: "왼쪽 크기 조절", className: s.west },
    { direction: "NorthWest", label: "왼쪽 위 크기 조절", className: mergeClasses(s.corner, s.northWest) },
    { direction: "NorthEast", label: "오른쪽 위 크기 조절", className: mergeClasses(s.corner, s.northEast) },
    { direction: "SouthWest", label: "왼쪽 아래 크기 조절", className: mergeClasses(s.corner, s.southWest) },
    { direction: "SouthEast", label: "오른쪽 아래 크기 조절", className: mergeClasses(s.corner, s.southEast) },
  ];
  const actions = [
    {
      action: "toggle-on-top",
      label: state?.overlay.alwaysOnTop ? "항상 위 해제" : "항상 위 표시",
      icon: <PinRegular />,
    },
    { action: "capture", label: "지금 캡처", icon: <CameraRegular /> },
    { action: "open-folder", label: "저장 폴더 열기", icon: <FolderOpenRegular /> },
    { action: "show-settings", label: "설정 열기", icon: <SettingsRegular /> },
    { action: "stop", label: "캡처 종료", icon: <DismissRegular /> },
  ] as const;
  return (
    <DeckProvider mica theme={createDeckTheme(mode)}>
      {state ? (
        <>
          <div className={s.toolbar} aria-label="캡처 도구 모음">
            {actions.map(({ action, label, icon }) => (
              <Tooltip key={action} content={label} relationship="label">
                <Button
                  className={s.miniButton}
                  aria-label={label}
                  icon={icon}
                  appearance={action === "capture" ? "primary" : "subtle"}
                  disabled={action === "capture" && (!state.session || state.session.busy)}
                  onClick={() => act(action)}
                />
              </Tooltip>
            ))}
            <span
              className={s.status}
              title={error || (state.session?.lastError ? "저장하지 못했어요. 폴더와 화면 상태를 확인해 주세요." : "")}
              aria-live="polite"
            >
              {state.overlay.rect.width} × {state.overlay.rect.height}px · {state.session?.sequence ?? 0}장
              {state.session?.busy ? " · 캡처 중" : ""}
              {error || state.session?.lastError ? " · 오류" : ""}
            </span>
          </div>
          <div
            role="button"
            aria-label="캡처 영역. 끌어서 이동, 더블클릭 또는 Enter로 캡처"
            tabIndex={0}
            className={mergeClasses(s.region, flash && s.flash)}
            style={
              {
                top: `${Math.ceil(Number.parseFloat(deckTokens.captureToolbarHeight) * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1)}px`,
                borderColor: state.overlay.style.borderColor,
                borderWidth: `${state.overlay.style.borderWidth / (window.devicePixelRatio || 1)}px`,
              } as CSSProperties
            }
            onDoubleClick={(e) => {
              if (e.target === e.currentTarget) act("capture");
            }}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                act("capture");
              }
              if (e.key === "Escape") act("toggle-visible");
            }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget && e.button === 0) dragStart.current = { x: e.screenX, y: e.screenY };
            }}
            onPointerMove={(e) => {
              const start = dragStart.current;
              if (!start || e.buttons !== 1 || Math.hypot(e.screenX - start.x, e.screenY - start.y) < 4) return;
              dragStart.current = null;
              void controls.drag().catch(() => setError("영역을 이동하지 못했어요."));
            }}
            onPointerUp={() => {
              dragStart.current = null;
            }}
            onPointerCancel={() => {
              dragStart.current = null;
            }}
          >
            {edges.map((edge) => (
              <div
                key={edge.direction}
                role="presentation"
                className={mergeClasses(s.edge, edge.className)}
                title={edge.label}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.preventDefault();
                  void controls
                    .resize(edge.direction)
                    .catch(() => setError("크기를 바꾸지 못했어요. 설정에서 픽셀로 지정해 주세요."));
                }}
              />
            ))}
          </div>
        </>
      ) : error ? (
        <InfoBar severity="error" message={error} />
      ) : null}
    </DeckProvider>
  );
}
