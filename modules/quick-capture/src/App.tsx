// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { CaptureSession, Deck, DestinationGrant, OverlayInfo, PhysicalRect, ShortcutInfo } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  InfoBar,
  NumberBox,
  PageHeader,
  BodyStrong,
  ColorPicker,
  tokens,
  SettingsExpander,
  TextBox,
  ToggleSwitch,
  createDeckTheme,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { CameraRegular, FolderOpenRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import {
  PREFERENCES_KEY,
  defaults,
  restorePreferences,
  shortcutLabel,
  startCapture,
  validatePreferences,
  applyPreferences,
  ShortcutApplyError,
  shortcutFromKey,
  same,
  type Preferences,
} from "./logic.ts";
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  row: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: deckTokens.inlineGap },
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(2,minmax(0,1fr))",
    gap: deckTokens.inlineGap,
    "@media (max-width: 680px)": { gridTemplateColumns: "minmax(0,1fr)" },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: tokens.spacingVerticalM,
    border: `${tokens.strokeWidthThin} solid ${deckTokens.cardStroke}`,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    minWidth: 0,
  },
  numbers: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: deckTokens.inlineGap },
});
const KEYS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", ...Array.from({ length: 11 }, (_, i) => `F${i + 1}`)];
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const color = createDeckTheme(deck.theme.mode).colorPaletteRedBorderActive;
  const [prefs, setPrefs] = useState<Preferences>(() => defaults(color));
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [overlay, setOverlay] = useState<OverlayInfo | null>(null);
  const [destination, setDestination] = useState<DestinationGrant | null>(null);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const currentOverlay = useRef(overlay);
  currentOverlay.current = overlay;
  const [message, setMessage] = useState("");
  const [activeShortcut, setActiveShortcut] = useState<ShortcutInfo | null>(null);
  const [recording, setRecording] = useState(false);
  const blocked = useRef("");
  const blockedShortcut = useRef("");
  const [remember, setRemember] = useState(true);
  const saved = useRef(Promise.resolve());
  const latestPrefs = useRef(prefs);
  latestPrefs.current = prefs;
  const loaded = useRef(false);
  loaded.current = ready;
  useEffect(
    () => () => {
      if (loaded.current)
        saved.current = saved.current
          .then(() => deck.storage.set(PREFERENCES_KEY, latestPrefs.current))
          .catch(() => undefined);
    },
    [deck],
  );
  function changed(next: Partial<Preferences>) {
    if (next.shortcut) {
      blockedShortcut.current = "";
      blocked.current = "";
    }
    setPrefs((p) => ({ ...p, ...next }));
  }
  const visible = useRef(true);
  async function refresh(restore = false) {
    const value = await deck.capture.status({});
    setSession(value);
    if (value) {
      const info = await deck.overlay.status({ overlayHandle: value.overlayHandle });
      setOverlay(info);
      const grant = await deck.fs.destinationStatus({ grantHandle: value.destinationGrant });
      setDestination(grant);
      const registered = value.shortcutHandle
        ? await deck.globalShortcut.status({ shortcutHandle: value.shortcutHandle })
        : null;
      setActiveShortcut(registered);
      if (restore)
        setPrefs((p) => ({
          ...p,
          settings: value.settings,
          ...(registered ? { shortcut: { modifiers: registered.modifiers, key: registered.key } } : {}),
          rect: info.rect,
          style: info.style,
          alwaysOnTop: info.alwaysOnTop,
          ...(grant?.persistent ? { destinationGrant: grant.grantHandle } : {}),
        }));
    } else setOverlay(null);
  }
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = restorePreferences(await deck.storage.get(PREFERENCES_KEY), color);
        if (!alive) return;
        setPrefs(p);
        {
          try {
            const grant = await deck.fs.destinationStatus(
              p.destinationGrant ? { grantHandle: p.destinationGrant } : {},
            );
            if (alive) setDestination(grant);
          } catch {
            if (alive) setMessage("저장 폴더를 다시 선택해 주세요.");
          }
        }
        if (alive) await refresh(true);
      } catch {
        if (alive) setMessage("이전 상태를 불러오지 못했어요. 폴더를 선택하고 다시 시작해 주세요.");
      } finally {
        if (alive) setReady(true);
      }
    };
    void load();
    const offs = [
      deck.on("capture.completed", ({ sessionHandle, result }) => {
        if (currentSession.current?.sessionHandle !== sessionHandle) return;
        setSession((p) => (p ? { ...p, sequence: result.sequence, busy: false, lastResult: result } : p));
        setMessage(`${result.sequence}장 저장했어요. ${result.file.name}`);
      }),
      deck.on("capture.failed", ({ sessionHandle }) => {
        if (currentSession.current?.sessionHandle === sessionHandle) {
          setSession((p) => (p ? { ...p, busy: false } : p));
          setMessage("캡처를 저장하지 못했어요. 저장 폴더와 화면 상태를 확인한 뒤 다시 캡처해 주세요.");
        }
      }),
      deck.on("overlay.changed", (info) => {
        const previous = currentOverlay.current;
        if (previous?.overlayHandle !== info.overlayHandle) return;
        setOverlay(info);
        setPrefs((p) => ({
          ...p,
          ...(!p.rect || same(p.rect, previous.rect) ? { rect: info.rect } : {}),
          ...(same(p.style, previous.style) ? { style: info.style } : {}),
          ...(p.alwaysOnTop === previous.alwaysOnTop ? { alwaysOnTop: info.alwaysOnTop } : {}),
        }));
      }),
      deck.on("module.visibility", ({ visible: shown }) => {
        visible.current = shown;
        if (shown) void refresh().catch(() => setMessage("캡처 상태를 불러오지 못했어요. 다시 열어 주세요."));
      }),
    ];
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
    // User-started host sessions intentionally outlive the settings iframe.
  }, [deck]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      saved.current = saved.current
        .then(() => deck.storage.set(PREFERENCES_KEY, prefs))
        .catch(() => setMessage("설정을 기억하지 못했어요. 이번 캡처는 계속 사용할 수 있어요."));
    }, 250);
    return () => clearTimeout(timer);
  }, [deck, prefs, ready]);
  useEffect(() => {
    if (!session) return;
    let alive = true;
    const timer = setInterval(() => {
      if (!locked.current && visible.current)
        void deck.capture
          .status({ sessionHandle: session.sessionHandle })
          .then((value) => {
            if (!alive) return;
            setSession(value);
            if (!value) {
              setOverlay(null);
              setMessage("캡처가 종료되었어요.");
            }
          })
          .catch(() => {
            if (alive)
              void deck.capture
                .status({})
                .then((value) => {
                  if (alive) {
                    setSession(value);
                    if (!value) setOverlay(null);
                  }
                })
                .catch(() => undefined);
          });
    }, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [deck, session?.sessionHandle]);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      setMessage("작업하지 못했어요. 단축키 중복, 저장 폴더와 화면 상태를 확인해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function attachDestination(grantHandle: string) {
    const current = currentSession.current;
    if (!current) {
      setPendingDestination(null);
      return;
    }
    try {
      const updated = await deck.capture.update({
        sessionHandle: current.sessionHandle,
        destinationGrant: grantHandle,
      });
      setSession(updated);
      setPendingDestination(null);
      setMessage("새 저장 폴더를 연결했어요. 캡처를 계속할 수 있어요.");
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "BUSY") {
        setSession((p) => (p ? { ...p, busy: true } : p));
        setMessage("캡처가 끝나면 새 저장 폴더를 연결해요.");
      } else {
        await deck.capture.stop({ sessionHandle: current.sessionHandle }).catch(() => undefined);
        setSession(null);
        setOverlay(null);
        setActiveShortcut(null);
        setPendingDestination(null);
        setMessage("새 저장 폴더는 선택했지만 캡처에 연결하지 못했어요. 영역 띄우고 시작을 눌러 다시 연결해 주세요.");
      }
    }
  }
  async function pickDestination() {
    const grant = await deck.fs.pickDestination({ remember });
    if (!grant) return null;
    // Picking replaces the old authority immediately. Retain the new grant even
    // when an in-flight capture temporarily prevents rebinding the session.
    setDestination(grant);
    setPrefs((p) => {
      const next = { ...p };
      delete next.destinationGrant;
      if (grant.persistent) next.destinationGrant = grant.grantHandle;
      return next;
    });
    if (currentSession.current) {
      setPendingDestination(grant.grantHandle);
      await attachDestination(grant.grantHandle);
    }
    return grant;
  }
  useEffect(() => {
    if (!pendingDestination || !session || session.busy || busy || !visible.current) return;
    void run(() => attachDestination(pendingDestination));
  }, [pendingDestination, session?.sessionHandle, session?.busy, busy]);
  async function start() {
    validatePreferences(prefs);
    const grant = destination?.available ? destination : await pickDestination();
    if (!grant) return;
    const started = await startCapture(deck, prefs, grant.grantHandle);
    setActiveShortcut(
      started.session.shortcutHandle
        ? await deck.globalShortcut.status({ shortcutHandle: started.session.shortcutHandle })
        : null,
    );
    setOverlay(started.overlay);
    setSession(started.session);
    changed({ rect: started.overlay.rect });
    setMessage(`${shortcutLabel(prefs.shortcut)} 또는 영역 안을 더블클릭하면 자동 저장해요.`);
  }
  async function stop() {
    if (!session) return;
    await deck.capture.stop({ sessionHandle: session.sessionHandle });
    setSession(null);
    setOverlay(null);
    setPendingDestination(null);
    setMessage("캡처를 종료했어요. 저장한 파일은 그대로 있어요.");
  }
  async function apply() {
    if (!session || !overlay || session.busy) return;
    const desired =
      blockedShortcut.current === JSON.stringify(prefs.shortcut) && activeShortcut
        ? { ...prefs, shortcut: { modifiers: activeShortcut.modifiers, key: activeShortcut.key } }
        : prefs;
    const updated = await applyPreferences(deck, desired, session, overlay, activeShortcut);
    setSession(updated.session);
    setOverlay(updated.overlay);
    setActiveShortcut(updated.shortcut);
  }
  useEffect(() => {
    if (!ready || !session || !overlay || session.busy || busy || pendingDestination || !visible.current) return;
    const shortcutChanged =
      (!activeShortcut || !same({ modifiers: activeShortcut.modifiers, key: activeShortcut.key }, prefs.shortcut)) &&
      blockedShortcut.current !== JSON.stringify(prefs.shortcut);
    if (
      !shortcutChanged &&
      same(session.settings, prefs.settings) &&
      same(overlay.style, prefs.style) &&
      overlay.alwaysOnTop === prefs.alwaysOnTop &&
      (!prefs.rect || same(overlay.rect, prefs.rect))
    )
      return;
    const target = JSON.stringify({
      settings: prefs.settings,
      shortcut: prefs.shortcut,
      style: prefs.style,
      rect: prefs.rect,
      alwaysOnTop: prefs.alwaysOnTop,
    });
    if (blocked.current === target) return;
    const timer = setTimeout(() => {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      void apply()
        .then(() => {
          blocked.current = "";
        })
        .catch(async (error: unknown) => {
          if (error instanceof ShortcutApplyError) {
            blockedShortcut.current = JSON.stringify(prefs.shortcut);
            setMessage("이 단축키는 사용할 수 없어요. 기존 단축키를 유지해요. 다른 조합을 눌러 주세요.");
          } else if (typeof error === "object" && error !== null && "code" in error && error.code === "BUSY") {
            setSession((p) => (p ? { ...p, busy: true } : p));
            setMessage("캡처가 끝나면 설정을 적용해요.");
          } else {
            blocked.current = target;
            await refresh().catch(() => undefined);
            setMessage("설정을 적용하지 못했어요. 입력과 화면 상태를 확인해 주세요.");
          }
        })
        .finally(() => {
          locked.current = false;
          setBusy(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [deck, prefs, ready, session?.sessionHandle, session?.busy, busy, activeShortcut, overlay, pendingDestination]);
  useEffect(() => {
    if (!recording) return;
    const listener = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape") {
        setRecording(false);
        return;
      }
      const shortcut = shortcutFromKey(event);
      if (shortcut) {
        changed({ shortcut });
        setRecording(false);
        setMessage("단축키를 선택했어요. 실행 중이면 자동 적용해요.");
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [recording]);
  const disabled = busy || !ready;
  const rect = prefs.rect ?? { x: 0, y: 0, width: 600, height: 400 };
  return (
    <main className={s.page}>
      <PageHeader title="퀵캡처" description="영역을 띄워 두고 단축키나 더블클릭으로 캡처해요. 설정은 자동 적용해요." />
      <div className={s.row}>
        <Button
          appearance="primary"
          icon={<CameraRegular />}
          disabled={disabled || session?.busy === true || pendingDestination !== null}
          onClick={() =>
            void run(async () => {
              if (session) {
                await apply();
                const result = await deck.capture.trigger({ sessionHandle: session.sessionHandle });
                setSession((p) => (p ? { ...p, sequence: result.sequence, lastResult: result } : p));
              } else await start();
            })
          }
        >
          {session ? "지금 캡처" : "영역 띄우고 시작"}
        </Button>
        {session && (
          <>
            <Button
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  if (overlay)
                    setOverlay(
                      await (overlay.visible
                        ? deck.overlay.hide({ overlayHandle: overlay.overlayHandle })
                        : deck.overlay.show({ overlayHandle: overlay.overlayHandle })),
                    );
                })
              }
            >
              {overlay?.visible ? "영역 숨기기" : "영역 다시 띄우기"}
            </Button>
            <Button disabled={disabled} onClick={() => void run(stop)}>
              캡처 종료
            </Button>
          </>
        )}
        <Body>
          {session
            ? `${session.sequence}장 저장 · ${overlay?.rect.width ?? rect.width} × ${overlay?.rect.height ?? rect.height}px`
            : "폴더 선택 → 영역 띄우기 → 단축키로 캡처"}
        </Body>
      </div>
      {message && <InfoBar severity="informational" message={message} onClose={() => setMessage("")} />}
      <div className={s.cards}>
        <section className={s.card} aria-label="저장 설정">
          <BodyStrong>저장 설정</BodyStrong>
          <div className={s.row}>
            <Body>{destination?.label ?? "저장 폴더를 선택해 주세요."}</Body>
            <Button
              icon={<FolderOpenRegular />}
              disabled={disabled || session?.busy === true}
              onClick={() =>
                void run(async () => {
                  await pickDestination();
                })
              }
            >
              {destination ? "폴더 바꾸기" : "폴더 선택"}
            </Button>
            {destination && (
              <Button
                disabled={disabled || !destination.available}
                onClick={() => void run(() => deck.fs.revealDestination({ grantHandle: destination.grantHandle }))}
              >
                폴더 열기
              </Button>
            )}
          </div>
          <CheckBox checked={remember} content="다음 실행에도 폴더 기억" disabled={disabled} onChange={setRemember} />
          <div className={s.numbers}>
            <ComboBox
              header="파일 형식"
              value={prefs.settings.format}
              disabled={!ready}
              options={[
                { value: "png", label: "PNG" },
                { value: "jpeg", label: "JPG" },
              ]}
              onChange={(v) => changed({ settings: { ...prefs.settings, format: v === "jpeg" ? "jpeg" : "png" } })}
            />
            <ComboBox
              header="파일명"
              value={prefs.settings.naming.mode}
              disabled={!ready}
              options={[
                { value: "numbered", label: "image_001_시각" },
                { value: "datetime", label: "capture_날짜_시각" },
                { value: "custom", label: "내 접두어_0001" },
              ]}
              onChange={(v) =>
                changed({
                  settings: {
                    ...prefs.settings,
                    naming: { ...prefs.settings.naming, mode: v === "custom" || v === "datetime" ? v : "numbered" },
                  },
                })
              }
            />
          </div>
          {prefs.settings.format === "jpeg" && (
            <NumberBox
              header="JPG 품질"
              min={1}
              max={100}
              value={prefs.settings.quality}
              disabled={!ready}
              onChange={(quality) => changed({ settings: { ...prefs.settings, quality } })}
            />
          )}
          {prefs.settings.naming.mode === "custom" && (
            <TextBox
              header="파일명 접두어"
              value={prefs.settings.naming.prefix ?? ""}
              disabled={!ready}
              onChange={(prefix) =>
                changed({ settings: { ...prefs.settings, naming: { ...prefs.settings.naming, prefix } } })
              }
            />
          )}
        </section>
        <section className={s.card} aria-label="캡처 설정">
          <BodyStrong>캡처 설정</BodyStrong>
          <Caption>단축키 · 버튼을 누른 뒤 원하는 키 조합을 눌러요.</Caption>
          <Button disabled={!ready} onClick={() => setRecording(true)}>
            {recording ? "새 단축키를 눌러 주세요 · Esc 취소" : shortcutLabel(prefs.shortcut)}
          </Button>
          {activeShortcut &&
            !same({ modifiers: activeShortcut.modifiers, key: activeShortcut.key }, prefs.shortcut) && (
              <Caption>현재 단축키: {shortcutLabel(activeShortcut)}</Caption>
            )}
          <div className={s.row}>
            <ColorPicker
              header="테두리 색"
              value={prefs.style.borderColor}
              disabled={!ready}
              onChange={(borderColor) => changed({ style: { ...prefs.style, borderColor } })}
            />
            <NumberBox
              header="테두리 두께"
              min={1}
              max={12}
              value={prefs.style.borderWidth}
              disabled={!ready}
              onChange={(borderWidth) => changed({ style: { ...prefs.style, borderWidth } })}
            />
          </div>
          <ToggleSwitch
            header="영역을 항상 위에 표시"
            checked={prefs.alwaysOnTop}
            disabled={!ready}
            onChange={(alwaysOnTop) => changed({ alwaysOnTop })}
          />
          <Caption secondary>영역 안 드래그로 이동, 가장자리로 크기 조절. 화면을 닫아도 캡처는 유지돼요.</Caption>
        </section>
      </div>
      <SettingsExpander header="고급 설정" description="실제 픽셀 좌표 · 키 조합 직접 선택 · 색 코드 · 폴더 연결 해제">
        <div className={s.stack}>
          <div className={s.row}>
            {(["control", "shift", "alt", "meta"] as const).map((modifier) => (
              <CheckBox
                key={modifier}
                content={{ control: "Ctrl", shift: "Shift", alt: "Alt", meta: "Win" }[modifier]}
                checked={prefs.shortcut.modifiers.includes(modifier)}
                disabled={!ready}
                onChange={(value) =>
                  changed({
                    shortcut: {
                      ...prefs.shortcut,
                      modifiers: value
                        ? [...prefs.shortcut.modifiers, modifier]
                        : prefs.shortcut.modifiers.filter((m) => m !== modifier),
                    },
                  })
                }
              />
            ))}
            <ComboBox
              header="캡처 키"
              value={prefs.shortcut.key}
              disabled={!ready}
              options={KEYS.map((key) => ({ value: key, label: key }))}
              onChange={(key) => changed({ shortcut: { ...prefs.shortcut, key } })}
            />
          </div>
          <TextBox
            header="테두리 색 (#RRGGBB)"
            value={prefs.style.borderColor}
            disabled={!ready}
            onChange={(borderColor) => changed({ style: { ...prefs.style, borderColor } })}
          />
          <div className={s.numbers}>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <NumberBox
                key={key}
                header={{ x: "화면 X", y: "화면 Y", width: "영역 너비", height: "영역 높이" }[key]}
                value={rect[key]}
                min={key === "width" || key === "height" ? 5 : -32768}
                max={key === "width" || key === "height" ? 16384 : 32768}
                disabled={!ready}
                onChange={(value) => changed({ rect: { ...rect, [key]: value } as PhysicalRect })}
              />
            ))}
          </div>
          <div className={s.row}>
            {session && (
              <Button
                disabled={disabled || session.busy}
                onClick={() =>
                  void run(async () => {
                    setSession(await deck.capture.resetSequence({ sessionHandle: session.sessionHandle }));
                    setMessage("다음 캡처부터 연번 1로 저장해요.");
                  })
                }
              >
                파일 연번 초기화
              </Button>
            )}
            {destination && (
              <Button
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    await stop();
                    await deck.fs.revokeDestination({ grantHandle: destination.grantHandle });
                    setDestination(null);
                    setPrefs((p) => {
                      const next = { ...p };
                      delete next.destinationGrant;
                      return next;
                    });
                    setMessage("폴더 연결을 해제했어요. 저장한 파일은 그대로 있어요.");
                  })
                }
              >
                폴더 연결 해제
              </Button>
            )}
          </div>
        </div>
      </SettingsExpander>
    </main>
  );
}
