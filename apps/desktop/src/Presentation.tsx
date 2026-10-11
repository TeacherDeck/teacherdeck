// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { PresentationViewState } from "@deck/sdk";
import {
  Body,
  Button,
  DeckProvider,
  InfoBar,
  PageHeader,
  Subtitle,
  TitleLarge,
  createDeckTheme,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { loadPreference, useColorMode } from "./theme.ts";
export interface PresentationHost {
  state(): Promise<PresentationViewState>;
  close(): Promise<void>;
  onChanged(callback: () => void): Promise<() => void>;
}
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    padding: deckTokens.pagePadding,
    gap: deckTokens.sectionGap,
  },
  actions: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap },
  board: { overflowX: "auto" },
  grid: { display: "grid", gap: deckTokens.itemGap },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))",
    gap: deckTokens.sectionGap,
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    minWidth: 0,
    padding: deckTokens.pagePadding,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
  },
});
export function Presentation({ controls: host }: { controls: PresentationHost }) {
  const [preference, setPreference] = useState(loadPreference);
  const mode = useColorMode(preference);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === "deck.shell.theme") setPreference(loadPreference());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  return (
    <DeckProvider theme={createDeckTheme(mode)} mica={false}>
      <PresentationContent controls={host} />
    </DeckProvider>
  );
}
function PresentationContent({ controls: host }: { controls: PresentationHost }) {
  const s = useStyles(),
    [state, setState] = useState<PresentationViewState | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let active = true,
      off: (() => void) | undefined;
    async function refresh() {
      const current = ++generation.current;
      try {
        const value = await host.state();
        if (active && current === generation.current) {
          setState(value);
          setError("");
        }
      } catch {
        if (active && current === generation.current) {
          setState(null);
          setError("학생 화면을 읽지 못했어요. 교사 화면에서 다시 열어 주세요.");
        }
      }
    }
    void host
      .onChanged(() => {
        void refresh();
      })
      .then((stop) => {
        if (active) {
          off = stop;
          void refresh();
        } else stop();
      })
      .catch(() => {
        if (active) {
          setState(null);
          setError("학생 화면 연결을 확인하지 못했어요. 교사 화면에서 다시 열어 주세요.");
        }
      });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void host.close().catch(() => {
          if (active) setError("학생 화면을 닫지 못했어요. 창의 닫기를 눌러 주세요.");
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      active = false;
      generation.current++;
      off?.();
      window.removeEventListener("keydown", key);
    };
  }, [host]);
  const payload = state?.disconnected ? null : state?.payload;
  const groups = new Map<string, string[]>();
  for (const item of payload?.items ?? [])
    if (item.group) {
      const labels = groups.get(item.group);
      if (labels) labels.push(item.label);
      else groups.set(item.group, [item.label]);
    }
  return (
    <main className={s.page}>
      <PageHeader title={payload?.title ?? "학생 화면"} />
      <div className={s.actions}>
        <Button
          onClick={() => {
            void host.close().catch(() => setError("학생 화면을 닫지 못했어요. 창의 닫기를 눌러 주세요."));
          }}
        >
          학생 화면 닫기
        </Button>
      </div>
      {error && <InfoBar severity="error" message={error} />}
      {state?.disconnected ? (
        <InfoBar message="화면 연결이나 배율이 바뀌어 공개 자료를 비웠어요. 교사 화면에서 화면을 다시 선택해 주세요." />
      ) : payload?.kind === "seats" ? (
        <>
          <Subtitle>칠판 앞</Subtitle>
          <div className={s.board}>
            <div
              className={s.grid}
              aria-label="학생 자리"
              style={{
                gridTemplateColumns: `repeat(${payload.columns},${(payload.columns ?? 0) <= 6 ? "minmax(0,1fr)" : "minmax(7ch,1fr)"})`,
              }}
            >
              {payload.items.map((item, index) => (
                <div
                  key={index}
                  className={s.item}
                  style={{ gridRowStart: (item.row ?? 0) + 1, gridColumnStart: (item.column ?? 0) + 1 }}
                >
                  <Subtitle>{item.label || "빈 자리"}</Subtitle>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : payload?.kind === "picker" ? (
        <div className={s.cards}>
          {payload.items.map((item, i) =>
            payload.items.length <= 6 ? (
              <TitleLarge key={i} className={s.item}>
                {item.label}
              </TitleLarge>
            ) : (
              <Subtitle key={i} className={s.item}>
                {item.label}
              </Subtitle>
            ),
          )}
        </div>
      ) : payload ? (
        <div className={s.cards}>
          {[...groups].map(([group, labels]) => (
            <section className={s.item} key={group}>
              <Subtitle>{group}</Subtitle>
              {labels.map((label, i) => (
                <Subtitle key={i}>{label}</Subtitle>
              ))}
            </section>
          ))}
        </div>
      ) : (
        !error && <Body>교사가 공개 결과를 준비하고 있어요.</Body>
      )}
    </main>
  );
}
