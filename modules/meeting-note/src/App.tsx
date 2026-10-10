// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  ComboBox,
  InfoBar,
  ListView,
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  deckTokens,
  makeStyles,
} from "@deck/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Entry, type Meeting, emptyMeeting, parseEntry, publicText, speakerIndex } from "./meeting.ts";
import { createWriter, loadMeeting } from "./storage.ts";
const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: deckTokens.sectionGap, padding: deckTokens.pagePadding },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "end" },
  text: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
});
const Records = memo(function Records({ entries }: { entries: Entry[] }) {
  const s = useStyles();
  return (
    <ListView
      header="최근 기록"
      items={entries.slice(-100).reverse()}
      getKey={(entry) => entry.id}
      emptyText="화자를 고르고 내용을 입력한 뒤 Enter를 눌러 주세요."
      renderItem={(entry) => (
        <div className={s.text}>
          <BodyStrong>
            {entry.private ? "비공개 · " : ""}
            {entry.kind}
            {entry.speaker ? ` · ${entry.speaker}` : ""}
          </BodyStrong>
          <Body>{entry.text}</Body>
          <Caption secondary>
            {entry.owner ? `담당: ${entry.owner} ` : ""}
            {entry.due ? `기한: ${entry.due}` : ""}
          </Caption>
        </div>
      )}
    />
  );
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [meeting, setMeeting] = useState<Meeting>(emptyMeeting);
  const latest = useRef(meeting);
  const [status, setStatus] = useState("불러오는 중이에요.");
  const [ready, setReady] = useState(false);
  const [failedLoad, setFailedLoad] = useState(false);
  const [preview, setPreview] = useState(false);
  const [backup, setBackup] = useState(false);
  const saveFailed = useRef(false);
  const [names, setNames] = useState("");
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const queued = useRef(false);
  const revision = useRef(0);
  const undo = useRef<Entry[]>([]);
  const write = useMemo(() => createWriter(deck), [deck]);
  const update = useCallback((next: Meeting) => {
    latest.current = next;
    revision.current++;
    setMeeting(next);
    if (!saveFailed.current) setStatus("자동 저장을 기다리는 중이에요.");
  }, []);
  useEffect(() => {
    let active = true;
    loadMeeting(deck)
      .then((data) => {
        if (!active) return;
        latest.current = data;
        setMeeting(data);
        setNames(data.speakers.join("\n"));
        setDraft(data.draft);
        setReady(true);
        setFailedLoad(false);
        setStatus("회의록을 불러왔어요.");
      })
      .catch(() => {
        if (active) {
          setFailedLoad(true);
          setStatus("회의록을 불러오지 못했어요. 도구를 다시 열어 주세요.");
        }
      });
    return () => {
      active = false;
    };
  }, [deck]);
  useEffect(() => {
    const flush = () => {
      if (revision.current > 0) void write(latest.current).catch(() => undefined);
    };
    const off = deck.on("module.visibility", ({ visible }) => {
      if (!visible) flush();
    });
    window.addEventListener("pagehide", flush);
    return () => {
      off();
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [deck, write]);
  useEffect(() => {
    if (!ready || revision.current === 0) return;
    const currentRevision = revision.current;
    const timer = setTimeout(() => {
      void write(latest.current)
        .then(() => {
          if (currentRevision === revision.current) {
            saveFailed.current = false;
            setStatus("저장했어요.");
          }
        })
        .catch(() => {
          saveFailed.current = true;
          setStatus("자동 저장하지 못했어요. 전체 보관용 텍스트를 선택해 따로 보관하고 다시 시도해 주세요.");
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [meeting, ready, write]);
  const commit = useCallback(() => {
    if (!ready) return;
    const raw = input.current?.value ?? latest.current.draft;
    const entry = parseEntry(raw, latest.current.speakers, latest.current.selected, crypto.randomUUID());
    if (!entry) return;
    undo.current = [];
    if (input.current) input.current.value = "";
    setDraft("");
    update({ ...latest.current, draft: "", entries: [...latest.current.entries, entry] });
  }, [ready, update]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!ready || preview || backup) return;
      if (
        event.ctrlKey &&
        !event.altKey &&
        event.code === "KeyZ" &&
        document.activeElement === input.current &&
        !input.current?.value
      ) {
        const entries = latest.current.entries;
        const last = entries.at(-1);
        if (last) {
          event.preventDefault();
          undo.current.push(last);
          update({ ...latest.current, entries: entries.slice(0, -1) });
        }
        return;
      }
      if (!event.altKey || event.ctrlKey || event.getModifierState("AltGraph")) return;
      const index = speakerIndex(event.code);
      const speakers = latest.current.speakers;
      if (index !== null && speakers[index]) {
        event.preventDefault();
        update({ ...latest.current, selected: speakers[index] ?? "" });
        input.current?.focus();
      } else if (event.code === "Backquote") {
        event.preventDefault();
        update({ ...latest.current, selected: "" });
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [ready, preview, backup, update]);
  if (!ready)
    return (
      <div className={s.page}>
        {failedLoad ? <InfoBar severity="error" message={status} /> : <ProgressRing label="회의록을 불러오는 중" />}
      </div>
    );
  return (
    <div className={s.page}>
      <PageHeader title="회의록" description="화자를 고르고 발언을 직접 입력해요. 한 번 고른 화자는 계속 유지돼요." />
      <InfoBar message={status} />
      <SettingsExpander header="회의 설정과 화자 등록" description="제목과 화자 명단을 설정해요.">
        <TextBox header="회의 제목" value={meeting.title} onChange={(title) => update({ ...latest.current, title })} />
        <TextBox
          header="화자 명단"
          multiline
          value={names}
          onChange={setNames}
          description="한 줄에 한 명씩, 최대 12명까지 등록해요. 기존 기록의 이름은 그대로 남아요."
        />
        <Button
          onClick={() => {
            const speakers = [
              ...new Set(
                names
                  .split("\n")
                  .map((name) => name.trim())
                  .filter(Boolean),
              ),
            ].slice(0, 12);
            update({
              ...latest.current,
              speakers,
              selected: speakers.includes(latest.current.selected) ? latest.current.selected : (speakers[0] ?? ""),
            });
            setNames(speakers.join("\n"));
          }}
        >
          화자 등록
        </Button>
      </SettingsExpander>
      <ComboBox
        header="현재 화자"
        value={meeting.selected}
        options={[
          { value: "", label: "화자 미지정" },
          ...meeting.speakers.map((name, index) => ({
            value: name,
            label: `${index + 1}. ${name} (Alt+${index < 9 ? index + 1 : ["0", "-", "="][index - 9]})`,
          })),
        ]}
        onChange={(selected) => update({ ...latest.current, selected })}
      />
      <TextBox
        header="발언 입력"
        multiline
        value={draft}
        inputRef={input}
        onChange={(value) => {
          setDraft(value);
          update({ ...latest.current, draft: value });
        }}
        description="Enter 기록 · Shift+Enter 줄바꿈 · ! 결정 · * 조치 @담당자 ~기한 · ? 질의 · # 안건 · // 비공개"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (queued.current) {
            queued.current = false;
            queueMicrotask(commit);
          }
        }}
        onKeyDown={(event) => {
          if (
            (event.key !== "Enter" && event.code !== "Enter" && event.code !== "NumpadEnter") ||
            event.shiftKey ||
            event.repeat
          )
            return;
          event.preventDefault();
          if (event.ctrlKey) {
            composing.current = false;
            queued.current = false;
            commit();
            return;
          }
          if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) queued.current = true;
          else commit();
        }}
      />
      <div className={s.row}>
        <Button appearance="primary" onClick={commit}>
          기록
        </Button>
        <Button
          disabled={!meeting.entries.length}
          onClick={() => {
            const entries = latest.current.entries;
            const last = entries.at(-1);
            if (last) undo.current.push(last);
            update({ ...latest.current, entries: entries.slice(0, -1) });
          }}
        >
          기록 되돌리기
        </Button>
        <Button
          disabled={!undo.current.length}
          onClick={() => {
            const entry = undo.current.pop();
            if (entry) update({ ...latest.current, entries: [...latest.current.entries, entry] });
          }}
        >
          다시 적용
        </Button>
        <Button onClick={() => setPreview(!preview)}>{preview ? "미리보기 닫기" : "공개용 텍스트 보기"}</Button>
        <Button
          onClick={() => {
            void write(latest.current)
              .then(() => {
                saveFailed.current = false;
                setStatus("저장했어요.");
              })
              .catch(() => {
                saveFailed.current = true;
                setStatus("저장하지 못했어요. 전체 보관용 텍스트를 따로 보관해 주세요.");
              });
          }}
        >
          지금 저장
        </Button>
      </div>
      <Button onClick={() => setBackup(!backup)}>{backup ? "보관용 텍스트 닫기" : "전체 보관용 텍스트 보기"}</Button>
      {backup && (
        <>
          <InfoBar
            severity="warning"
            message="비공개 메모와 입력 중 초안까지 포함해요. 다른 사람에게 전달하지 말고 개인 보관용으로 선택해 복사해 주세요."
          />
          <TextBox
            header="전체 보관용 텍스트"
            multiline
            readOnly
            value={JSON.stringify(meeting, null, 2)}
            onChange={() => undefined}
          />
        </>
      )}
      {preview && (
        <>
          <InfoBar message="비공개 메모를 뺀 텍스트예요. 내용을 선택하고 Ctrl+C로 복사해 주세요." />
          <TextBox header="공개용 텍스트" multiline readOnly value={publicText(meeting)} onChange={() => undefined} />
        </>
      )}
      <Caption secondary>전체 {meeting.entries.length}건 중 최근 100건을 보여 줘요.</Caption>
      <Records entries={meeting.entries} />
    </div>
  );
}
