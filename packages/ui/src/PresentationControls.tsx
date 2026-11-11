// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, PresentationDisplay, PresentationPayload, PresentationSession } from "@deck/sdk";
import { useEffect, useRef, useState } from "react";
import { Button, makeStyles } from "@fluentui/react-components";
import { ComboBox, InfoBar } from "./controls.tsx";
import { SettingsExpander } from "./components.tsx";
import { Caption } from "./typography.tsx";
import { deckTokens } from "./tokens/index.ts";

export interface PresentationControlsProps {
  deck: Pick<Deck, "has" | "version" | "on"> & {
    window: Pick<
      Deck["window"],
      | "setFullscreen"
      | "setAlwaysOnTop"
      | "listDisplays"
      | "openPresentation"
      | "updatePresentation"
      | "closePresentation"
    >;
  };
  payload: PresentationPayload | null;
  disabled?: boolean;
  hidden?: boolean;
}
const useStyles = makeStyles({
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
  body: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap },
});
/** Explicit public snapshot publication; edits never automatically change the student display. */
export function PresentationControls({ deck, payload, disabled = false, hidden = false }: PresentationControlsProps) {
  const s = useStyles();
  const version = /^1\.(\d+)\./.exec(deck.version("window") ?? "");
  const supported = deck.has("window") && !!version && Number(version[1]) >= 1;
  const [displays, setDisplays] = useState<PresentationDisplay[]>([]);
  const [choice, setChoice] = useState("");
  const [session, setSession] = useState<PresentationSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const locked = useRef(false),
    alive = useRef(true),
    latestSession = useRef(session);
  const earlyEvents = useRef(new Map<string, "closed" | "disconnected">());
  latestSession.current = session;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!supported) return;
    const remember = (handle: string, state: "closed" | "disconnected") => {
      if (earlyEvents.current.get(handle) === "closed") return;
      earlyEvents.current.set(handle, state);
      if (earlyEvents.current.size > 8) {
        const oldest = earlyEvents.current.keys().next().value;
        if (oldest !== undefined) earlyEvents.current.delete(oldest);
      }
    };
    const closed = deck.on("window.presentationClosed", ({ presentationHandle }) => {
      remember(presentationHandle, "closed");
      if (presentationHandle !== latestSession.current?.presentationHandle) return;
      latestSession.current = null;
      setSession(null);
      setDisconnected(false);
      setMessage("학생 화면을 닫았어요. 필요할 때 다시 열 수 있어요.");
    });
    const changed = deck.on("window.presentationDisconnected", ({ presentationHandle }) => {
      remember(presentationHandle, "disconnected");
      if (presentationHandle !== latestSession.current?.presentationHandle) return;
      setDisconnected(true);
      setDisplays([]);
      setChoice("");
      setError("화면 연결이나 배율이 바뀌어 공개 자료를 비웠어요. 화면 목록을 다시 읽고 선택해 주세요.");
    });
    return () => {
      closed();
      changed();
    };
  }, [deck, supported]);
  async function action(operation: () => Promise<void>) {
    if (!supported || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (e) {
      if (!alive.current) return;
      if (e && typeof e === "object" && "code" in e && e.code === "NOT_FOUND") {
        latestSession.current = null;
        setSession(null);
        setDisplays([]);
        setChoice("");
        setError("학생 화면이 닫혔거나 화면 연결이 바뀌었어요. 화면 목록을 다시 읽고 선택해 주세요.");
      } else
        setError(
          latestSession.current
            ? "학생 화면을 변경하지 못했어요. 이전 공개 결과는 유지되며 화면 목록과 연결을 확인해 다시 시도할 수 있어요."
            : "학생 화면을 열지 못했어요. 화면 목록과 연결을 확인해 다시 시도해 주세요.",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function selectDisplays() {
    const list = await deck.window.listDisplays();
    if (!alive.current) return;
    setDisplays(list);
    setChoice((list.find((d) => !d.primary) ?? list[0])?.displayHandle ?? "");
    setMessage(
      list.length
        ? list.some((d) => !d.primary)
          ? "보조 화면을 우선 선택했어요. 표시할 화면을 확인해 주세요."
          : "표시할 화면을 확인해 주세요."
        : "연결된 화면이 없어요. 연결 후 다시 읽어 주세요.",
    );
  }
  async function open() {
    if (!payload || !choice || disabled) return;
    const previous = latestSession.current;
    if (previous) {
      await deck.window.closePresentation({ presentationHandle: previous.presentationHandle });
      latestSession.current = null;
      if (alive.current) setSession(null);
    }
    const next = await deck.window.openPresentation({ displayHandle: choice, payload });
    if (!alive.current) {
      await deck.window.closePresentation({ presentationHandle: next.presentationHandle });
      return;
    }
    const early = earlyEvents.current.get(next.presentationHandle);
    earlyEvents.current.delete(next.presentationHandle);
    if (early === "closed") {
      setMessage("학생 화면을 닫았어요. 필요할 때 다시 열 수 있어요.");
      return;
    }
    latestSession.current = next;
    setSession(next);
    setDisconnected(early === "disconnected");
    if (early === "disconnected") {
      setDisplays([]);
      setChoice("");
      setError("화면 연결이나 배율이 바뀌어 공개 자료를 비웠어요. 화면 목록을 다시 읽고 선택해 주세요.");
      return;
    }
    setMessage("선택한 화면에 현재 공개 결과를 표시했어요. 이후 변경은 갱신을 눌러야 반영돼요.");
  }
  return (
    <div hidden={hidden}>
      <SettingsExpander header="확장 학생 화면" description="교사 화면은 유지하고 선택한 화면에 공개 결과만 보여줘요">
        {!supported ? (
          <InfoBar message="확장 학생 화면은 앱 업데이트 후 사용할 수 있어요. 현재 학생 보기는 계속 사용할 수 있어요." />
        ) : (
          <div className={s.body}>
            <div className={s.row}>
              <Button
                disabled={busy || disabled}
                onClick={() => {
                  void action(selectDisplays);
                }}
              >
                화면 목록 다시 읽기
              </Button>
              {displays.length > 0 && (
                <ComboBox
                  header="학생에게 보여줄 화면"
                  value={choice}
                  disabled={busy || disabled}
                  options={displays.map((d) => ({
                    value: d.displayHandle,
                    label: `${d.label}${d.primary ? " · 주 화면" : " · 보조 화면"}`,
                  }))}
                  onChange={setChoice}
                />
              )}
              <Button
                appearance="primary"
                disabled={busy || disabled || !payload || !choice}
                onClick={() => {
                  void action(open);
                }}
              >
                {session ? "선택한 화면으로 다시 열기" : "확장 화면 열기"}
              </Button>
              <Button
                disabled={busy || disabled || !payload || !session || disconnected}
                onClick={() => {
                  void action(async () => {
                    const current = latestSession.current;
                    if (!current || !payload) return;
                    const next = await deck.window.updatePresentation({
                      presentationHandle: current.presentationHandle,
                      revision: current.revision + 1,
                      payload,
                    });
                    if (latestSession.current?.presentationHandle !== current.presentationHandle) return;
                    latestSession.current = next;
                    if (alive.current) {
                      setSession(next);
                      setMessage("현재 공개 결과로 갱신했어요.");
                    }
                  });
                }}
              >
                학생 화면 갱신
              </Button>
              <Button
                disabled={busy || !session}
                onClick={() => {
                  void action(async () => {
                    const current = latestSession.current;
                    if (!current) return;
                    await deck.window.closePresentation({ presentationHandle: current.presentationHandle });
                    latestSession.current = null;
                    if (alive.current) {
                      setSession(null);
                      setMessage("확장 학생 화면을 닫았어요.");
                    }
                  });
                }}
              >
                확장 화면 닫기
              </Button>
            </div>
            <Caption secondary>
              학생 화면에는 결과의 제목·번호·이름·자리·모둠·역할만 전달해요. 편집·추첨·배정은 자동으로 갱신하지 않아요.
              학생 화면에서도 Esc로 닫을 수 있어요.
            </Caption>
            {message && <InfoBar message={message} />}
            {error && <InfoBar severity="error" message={error} />}
          </div>
        )}
      </SettingsExpander>
    </div>
  );
}
