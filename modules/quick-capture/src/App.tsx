// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { CaptureSession, Deck, DestinationGrant, OverlayInfo, PhysicalRect } from "@deck/sdk";
import {
  Body,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  InfoBar,
  NumberBox,
  PageHeader,
  SettingsCard,
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
  type Preferences,
} from "./logic.ts";
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  row: { display: "flex", flexWrap: "wrap", alignItems: "end", gap: deckTokens.inlineGap },
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
  numbers: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: deckTokens.inlineGap },
});
const KEYS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", ...Array.from({ length: 11 }, (_, i) => `F${i + 1}`)];
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const color = createDeckTheme(deck.theme.mode).colorBrandStroke1;
  const [prefs, setPrefs] = useState<Preferences>(() => defaults(color));
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [overlay, setOverlay] = useState<OverlayInfo | null>(null);
  const [destination, setDestination] = useState<DestinationGrant | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const currentSession = useRef(session);
  currentSession.current = session;
  const currentOverlay = useRef(overlay);
  currentOverlay.current = overlay;
  const [message, setMessage] = useState("");
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
        if (currentOverlay.current?.overlayHandle !== info.overlayHandle) return;
        setOverlay(info);
        setPrefs((p) => ({ ...p, rect: info.rect, style: info.style, alwaysOnTop: info.alwaysOnTop }));
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
  async function pickDestination() {
    const grant = await deck.fs.pickDestination({ remember });
    if (!grant) return null;
    if (session)
      setSession(
        await deck.capture.update({ sessionHandle: session.sessionHandle, destinationGrant: grant.grantHandle }),
      );
    setDestination(grant);
    setPrefs((p) => {
      const next = { ...p };
      delete next.destinationGrant;
      if (grant.persistent) next.destinationGrant = grant.grantHandle;
      return next;
    });
    return grant;
  }
  async function start() {
    validatePreferences(prefs);
    const grant = destination?.available ? destination : await pickDestination();
    if (!grant) return;
    const started = await startCapture(deck, prefs, grant.grantHandle);
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
    setMessage("캡처를 종료했어요. 저장한 파일은 그대로 있어요.");
  }
  async function apply() {
    if (!session || !overlay) return;
    validatePreferences(prefs);
    // replace guarantees the old binding survives a conflict.
    const oldShortcut = session.shortcutHandle
      ? await deck.globalShortcut.status({ shortcutHandle: session.shortcutHandle })
      : null;
    const shortcut = session.shortcutHandle
      ? await deck.globalShortcut.replace({ shortcutHandle: session.shortcutHandle, ...prefs.shortcut })
      : await deck.globalShortcut.register(prefs.shortcut);
    let next: CaptureSession;
    try {
      next = await deck.capture.update({
        sessionHandle: session.sessionHandle,
        settings: prefs.settings,
        shortcutHandle: shortcut.shortcutHandle,
      });
    } catch (error) {
      if (oldShortcut)
        await deck.globalShortcut
          .replace({
            shortcutHandle: oldShortcut.shortcutHandle,
            modifiers: oldShortcut.modifiers,
            key: oldShortcut.key,
          })
          .catch(() => undefined);
      if (!session.shortcutHandle)
        await deck.globalShortcut.unregister({ shortcutHandle: shortcut.shortcutHandle }).catch(() => undefined);
      throw error;
    }
    setSession(next);
    setOverlay(
      await deck.overlay.update({
        overlayHandle: overlay.overlayHandle,
        style: prefs.style,
        alwaysOnTop: prefs.alwaysOnTop,
        ...(prefs.rect ? { rect: prefs.rect } : {}),
      }),
    );
    setMessage("실행 중인 캡처에 설정을 적용했어요.");
  }
  const disabled = busy || !ready;
  const rect = prefs.rect ?? { x: 0, y: 0, width: 600, height: 400 };
  return (
    <main className={s.page}>
      <PageHeader
        title="퀵캡처"
        description="영역을 띄워 두고 단축키나 더블클릭으로 연속 캡처해요. 지정한 폴더에 바로 저장해요."
      />
      <div className={s.stack}>
        <div className={s.row}>
          <Button
            appearance="primary"
            icon={<CameraRegular />}
            disabled={disabled || session?.busy === true}
            onClick={() =>
              void run(async () => {
                if (session) {
                  await deck.capture.trigger({ sessionHandle: session.sessionHandle });
                  const current = await deck.capture.status({ sessionHandle: session.sessionHandle });
                  setSession(current);
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
        </div>
        <Body>
          {session
            ? `${session.sequence}장 저장 · ${overlay?.rect.width ?? rect.width} × ${overlay?.rect.height ?? rect.height}px`
            : "1. 폴더 선택 → 2. 영역 띄우기 → 3. 단축키로 반복 캡처"}
        </Body>
        <Caption secondary>
          영역 안을 끌면 이동하고 가장자리나 모서리를 끌면 크기를 바꿔요. 다른 도구로 이동해도 캡처는 유지돼요.
        </Caption>
        {message && <InfoBar severity="informational" message={message} />}
      </div>
      <SettingsCard
        header="저장 폴더"
        description={
          destination
            ? `${destination.label}${destination.available ? " · 새 캡처가 여기에 저장돼요" : " · 다시 선택해 주세요"}`
            : "한 번 선택하면 캡처할 때마다 저장 창이 뜨지 않아요."
        }
        action={
          <Button
            icon={<FolderOpenRegular />}
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await pickDestination();
              })
            }
          >
            {destination ? "폴더 바꾸기" : "폴더 선택"}
          </Button>
        }
      />
      <div className={s.row}>
        <CheckBox
          checked={remember}
          content="폴더를 새로 고를 때 다음 실행에도 기억"
          disabled={disabled}
          onChange={setRemember}
        />
        {destination && (
          <>
            <Button
              disabled={disabled || !destination.available}
              onClick={() => void run(() => deck.fs.revealDestination({ grantHandle: destination.grantHandle }))}
            >
              저장 폴더 열기
            </Button>
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
                  setMessage("저장 폴더 연결을 해제했어요. 저장한 파일은 그대로 있어요.");
                })
              }
            >
              폴더 연결 해제
            </Button>
          </>
        )}
      </div>
      <div className={s.row}>
        <ComboBox
          header="파일 형식"
          value={prefs.settings.format}
          disabled={disabled}
          options={[
            { value: "png", label: "PNG · 선명한 원본" },
            { value: "jpeg", label: "JPG · 작은 용량" },
          ]}
          onChange={(v) => changed({ settings: { ...prefs.settings, format: v === "jpeg" ? "jpeg" : "png" } })}
        />
        {prefs.settings.format === "jpeg" && (
          <NumberBox
            header="JPG 품질"
            min={1}
            max={100}
            value={prefs.settings.quality}
            disabled={disabled}
            onChange={(quality) => changed({ settings: { ...prefs.settings, quality } })}
          />
        )}
        <ComboBox
          header="파일명"
          value={prefs.settings.naming.mode}
          disabled={disabled}
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
        {prefs.settings.naming.mode === "custom" && (
          <TextBox
            header="파일명 접두어"
            value={prefs.settings.naming.prefix ?? ""}
            disabled={disabled}
            onChange={(prefix) =>
              changed({ settings: { ...prefs.settings, naming: { ...prefs.settings.naming, prefix } } })
            }
          />
        )}
      </div>
      <SettingsExpander
        header="단축키와 영역 설정"
        description={`${shortcutLabel(prefs.shortcut)} · 테두리·크기·파일 연번`}
      >
        <div className={s.stack}>
          <div className={s.row}>
            {(["control", "shift", "alt"] as const).map((modifier) => (
              <CheckBox
                key={modifier}
                content={{ control: "Ctrl", shift: "Shift", alt: "Alt" }[modifier]}
                checked={prefs.shortcut.modifiers.includes(modifier)}
                disabled={disabled}
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
              disabled={disabled}
              options={KEYS.map((key) => ({ value: key, label: key }))}
              onChange={(key) => changed({ shortcut: { ...prefs.shortcut, key } })}
            />
          </div>
          <ToggleSwitch
            header="영역을 항상 위에 표시"
            checked={prefs.alwaysOnTop}
            disabled={disabled}
            onChange={(alwaysOnTop) => changed({ alwaysOnTop })}
          />
          <div className={s.row}>
            <TextBox
              header="테두리 색 (#RRGGBB)"
              value={prefs.style.borderColor}
              disabled={disabled}
              onChange={(borderColor) => changed({ style: { ...prefs.style, borderColor } })}
            />
            <NumberBox
              header="테두리 두께"
              min={1}
              max={12}
              value={prefs.style.borderWidth}
              disabled={disabled}
              onChange={(borderWidth) => changed({ style: { ...prefs.style, borderWidth } })}
            />
          </div>
          <div className={s.numbers}>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <NumberBox
                key={key}
                header={{ x: "화면 X", y: "화면 Y", width: "영역 너비", height: "영역 높이" }[key]}
                value={rect[key]}
                min={key === "width" || key === "height" ? 5 : -32768}
                max={key === "width" || key === "height" ? 16384 : 32768}
                disabled={disabled}
                onChange={(value) => changed({ rect: { ...rect, [key]: value } as PhysicalRect })}
              />
            ))}
          </div>
          <Caption secondary>
            화면 좌표와 크기는 실제 픽셀 기준이에요. 같은 이름이 있으면 번호를 붙여 새 파일로 저장해요.
          </Caption>
          {session && (
            <Button
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  setSession(await deck.capture.resetSequence({ sessionHandle: session.sessionHandle }));
                  setMessage("다음 캡처부터 연번 1로 저장해요. 기존 파일은 그대로 있어요.");
                })
              }
            >
              파일 연번 초기화
            </Button>
          )}
        </div>
      </SettingsExpander>
      {session && (
        <div className={s.row}>
          <Button disabled={disabled || session.busy} onClick={() => void run(apply)}>
            실행 중인 캡처에 설정 적용
          </Button>
        </div>
      )}
    </main>
  );
}
