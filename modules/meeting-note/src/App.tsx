// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { DeckCallError, type Deck } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CapabilityGate,
  CheckBox,
  ComboBox,
  ContentDialog,
  InfoBar,
  ListView,
  PageHeader,
  ProgressRing,
  SettingsExpander,
  TextBox,
  ToggleButton,
  deckTokens,
  makeStyles,
  mergeClasses,
  tokens,
} from "@deck/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Entry,
  type EntryKind,
  type Meeting,
  emptyMeeting,
  entryInput,
  parseEntry,
  speakerIndex,
} from "./meeting.ts";
import { createWriter, loadMeeting } from "./storage.ts";
import { publicClipboard } from "./clipboard.ts";
import { type ExportFormat, exportText, pickMeeting, saveFile } from "./files.ts";
import {
  type Library,
  EMPTY_LIBRARY,
  LIBRARY_KEY,
  archiveMeeting,
  archivedMeeting,
  loadLibrary,
  removeArchive,
} from "./library.ts";
import { mergeRosters, pickRosters, saveRosters } from "./roster-files.ts";
import { activeSpeakers, identifySpeakers, reviseSpeakers as applyRoster, speakerLabel } from "./speakers.ts";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="];
const SPEAKER_COLORS = [
  tokens.colorPaletteBlueForeground2,
  tokens.colorPaletteGreenForeground2,
  tokens.colorPaletteRedForeground2,
  tokens.colorPalettePurpleForeground2,
  tokens.colorPaletteMarigoldForeground2,
  tokens.colorPaletteTealForeground2,
  tokens.colorPaletteBerryForeground2,
  tokens.colorPaletteDarkOrangeForeground2,
  tokens.colorPaletteTealForeground2,
  tokens.colorPaletteLightGreenForeground2,
  tokens.colorPalettePlumForeground2,
  tokens.colorPalettePinkForeground2,
];
const KINDS: EntryKind[] = ["발언", "결정", "조치", "질의", "안건"];
const lines = (value: string) =>
  value
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
const useStyles = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalM,
    height: "100vh",
    minHeight: 0,
    boxSizing: "border-box",
  },
  setup: {
    width: "100%",
    maxWidth: "64rem",
    marginInline: "auto",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
  },
  toolbar: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS, alignItems: "center", flexShrink: 0 },
  saved: { marginInlineStart: "auto" },
  composer: {
    gridArea: "composer",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    paddingTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  current: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorBrandBackground2,
    padding: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusSmall,
  },
  key: {
    paddingInline: tokens.spacingHorizontalXS,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusSmall,
    fontFamily: tokens.fontFamilyMonospace,
    flexShrink: 0,
  },
  speakerButton: {
    display: "flex",
    justifyContent: "flex-start",
    gap: tokens.spacingHorizontalS,
    width: "100%",
    border: `${tokens.strokeWidthThin} solid ${tokens.colorTransparentStroke}`,
    paddingBlock: tokens.spacingVerticalXS,
  },
  selectedSpeaker: {
    backgroundColor: tokens.colorBrandBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorBrandStroke1}`,
  },
  dot: {
    width: tokens.spacingHorizontalS,
    height: tokens.spacingVerticalS,
    borderRadius: tokens.borderRadiusCircular,
    flexShrink: 0,
  },
  time: { whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace },
  stats: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    paddingTop: tokens.spacingVerticalS,
  },
  record: {
    display: "grid",
    gridTemplateColumns: "11ch minmax(6ch, 12ch) minmax(0, 1fr) auto",
    alignItems: "baseline",
    gap: tokens.spacingHorizontalS,
    width: "100%",
    "&:hover [data-record-actions]": { opacity: 1 },
    "&:focus-within [data-record-actions]": { opacity: 1 },
    "@media (max-width: 720px)": { gridTemplateColumns: "11ch minmax(4ch, 8ch) minmax(0, 1fr) auto" },
  },
  agenda: {
    backgroundColor: tokens.colorBrandBackground2,
    borderLeft: `${tokens.strokeWidthThick} solid ${tokens.colorBrandStroke1}`,
    padding: tokens.spacingHorizontalS,
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
  },
  recordBody: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS, minWidth: 0 },
  recordActions: {
    display: "flex",
    gap: tokens.spacingHorizontalXS,
    opacity: 0,
    "@media (hover: none)": { opacity: 1 },
  },
  tag: {
    paddingInline: tokens.spacingHorizontalXS,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  decision: { backgroundColor: tokens.colorPaletteMarigoldBackground2, color: tokens.colorPaletteMarigoldForeground2 },
  action: { backgroundColor: tokens.colorPaletteGreenBackground2, color: tokens.colorPaletteGreenForeground2 },
  question: { backgroundColor: tokens.colorPalettePurpleBackground2, color: tokens.colorPalettePurpleForeground2 },
  private: { opacity: 0.65, fontStyle: "italic" },
  retag: { gridColumn: "2 / -1", maxWidth: "20rem" },
  row: { display: "flex", flexWrap: "wrap", gap: deckTokens.inlineGap, alignItems: "center" },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 3fr) minmax(0, 1fr)",
    gap: deckTokens.sectionGap,
    "@media (max-width: 720px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  workspace: {
    display: "grid",
    flex: "1",
    minHeight: 0,
    gridTemplateColumns: "minmax(0, 1fr) minmax(12rem, 15rem)",
    gridTemplateRows: "minmax(0, 1fr) auto",
    gridTemplateAreas: '"records speakers" "composer composer"',
    gap: tokens.spacingHorizontalM,
    "@media (max-width: 720px)": {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "auto minmax(0, 1fr) auto",
      gridTemplateAreas: '"speakers" "records" "composer"',
    },
  },
  editor: { display: "contents" },
  speakers: {
    gridArea: "speakers",
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    minWidth: 0,
    overflowY: "auto",
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    paddingLeft: tokens.spacingHorizontalS,
    "@media (max-width: 720px)": {
      flexDirection: "row",
      flexWrap: "wrap",
      maxHeight: "20vh",
      borderLeft: "none",
      paddingLeft: 0,
    },
  },
  speakerHeading: { "@media (max-width: 720px)": { flexBasis: "100%" } },
  stack: { display: "flex", flexDirection: "column", gap: deckTokens.inlineGap, minWidth: 0 },
  log: {
    gridArea: "records",
    overflowY: "auto",
    minHeight: 0,
    borderRadius: tokens.borderRadiusSmall,
    "& [role='listitem']": {
      minHeight: "auto",
      paddingBlock: tokens.spacingVerticalXS,
      paddingInline: tokens.spacingHorizontalXS,
      borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    },
  },
  text: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
});
const Records = memo(function Records({
  entries,
  edit,
  remove,
  busy,
  speakers,
  retag,
}: {
  entries: Entry[];
  edit: (entry: Entry) => void;
  remove: (id: string) => void;
  busy: boolean;
  speakers: { value: string; label: string }[];
  retag: (id: string, speakerId: string) => void;
}) {
  const s = useStyles();
  const [changing, setChanging] = useState("");
  return (
    <ListView
      header="회의 기록"
      items={entries}
      getKey={(entry) => entry.id}
      emptyText="Alt+숫자로 화자를 고르고, 발언을 입력한 뒤 Enter를 눌러 주세요."
      renderItem={(entry) => {
        const index = speakers.findIndex((speaker) => speaker.value === entry.speakerId);
        const color = SPEAKER_COLORS[Math.max(0, index) % SPEAKER_COLORS.length];
        const actions = (
          <div className={s.recordActions} data-record-actions>
            {entry.kind !== "안건" && (
              <Button
                size="small"
                disabled={busy}
                onClick={() => setChanging(changing === entry.id ? "" : entry.id)}
                aria-label={`${entry.text} 화자 변경`}
              >
                화자
              </Button>
            )}
            <Button size="small" disabled={busy} onClick={() => edit(entry)} aria-label={`${entry.text} 수정`}>
              수정
            </Button>
            <Button size="small" disabled={busy} onClick={() => remove(entry.id)} aria-label={`${entry.text} 삭제`}>
              삭제
            </Button>
          </div>
        );
        return (
          <div className={s.record}>
            {entry.kind === "안건" ? (
              <div className={s.agenda}>
                <BodyStrong>안건 · {entry.text}</BodyStrong>
                {actions}
              </div>
            ) : (
              <>
                <Caption secondary className={s.time}>
                  {entry.timestamp
                    ? new Date(entry.timestamp).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </Caption>
                <span style={{ color }}>
                  <BodyStrong>{entry.speaker || "미지정"}</BodyStrong>
                </span>
                <div className={mergeClasses(s.recordBody, entry.private && s.private)}>
                  {entry.kind !== "발언" && (
                    <Caption
                      className={mergeClasses(
                        s.tag,
                        entry.kind === "결정" && s.decision,
                        entry.kind === "조치" && s.action,
                        entry.kind === "질의" && s.question,
                      )}
                    >
                      {entry.kind}
                    </Caption>
                  )}
                  {entry.private && <Caption className={s.tag}>비공개</Caption>}
                  <Body className={s.text}>{entry.text}</Body>
                  {(entry.owner || entry.due) && (
                    <Caption secondary>
                      {entry.owner ? `담당: ${entry.owner} ` : ""}
                      {entry.due ? `기한: ${entry.due}` : ""}
                    </Caption>
                  )}
                </div>
                {actions}
                {changing === entry.id && (
                  <div className={s.retag}>
                    <ComboBox
                      header="이 기록의 화자"
                      showHeader={false}
                      disabled={busy}
                      value={entry.speakerId ?? ""}
                      options={[{ value: "", label: "미지정" }, ...speakers]}
                      onChange={(speakerId) => {
                        retag(entry.id, speakerId);
                        setChanging("");
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        );
      }}
    />
  );
});
export function App({ deck }: { deck: Deck }) {
  const s = useStyles();
  const [meeting, setMeeting] = useState<Meeting>(emptyMeeting);
  const latest = useRef(meeting);
  const [library, setLibrary] = useState<Library>(EMPTY_LIBRARY);
  const [status, setStatus] = useState("불러오는 중이에요.");
  const [copyStatus, setCopyStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [failedLoad, setFailedLoad] = useState(false);
  const [running, setRunning] = useState(false);
  const [dialog, setDialog] = useState<
    "people" | "export" | "help" | "new" | "archive" | "remove" | "delete-entry" | "delete-roster" | ""
  >("");
  const [entryToRemove, setEntryToRemove] = useState("");
  const [rosterToRemove, setRosterToRemove] = useState("");
  const [removeKey, setRemoveKey] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [names, setNames] = useState("");
  const [absent, setAbsent] = useState("");
  const [rosterName, setRosterName] = useState("");
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<EntryKind>("발언");
  const kindChosen = useRef(false);
  const [privateNote, setPrivateNote] = useState(false);
  const privateChosen = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const editingId = useRef<string | null>(null);
  const previousDraft = useRef("");
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const attendeeInput = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const queued = useRef(false);
  const revision = useRef(0);
  const saveFailed = useRef(false);
  const undo = useRef<Meeting[]>([]);
  const redo = useRef<Meeting[]>([]);
  const write = useMemo(() => createWriter(deck), [deck]);
  const update = useCallback((next: Meeting, force = false) => {
    if (busyRef.current && !force) return;
    latest.current = next;
    revision.current++;
    setMeeting(next);
    if (!saveFailed.current) setStatus("자동 저장을 기다리는 중이에요.");
  }, []);
  const snapshot = useCallback(() => {
    undo.current.push(latest.current);
    while (undo.current.length > 50 || new TextEncoder().encode(JSON.stringify(undo.current)).length > 6000000)
      undo.current.shift();
    redo.current = [];
  }, []);
  const focusInput = () => queueMicrotask(() => input.current?.focus());
  const setInput = useCallback(
    (value: string) => {
      if (busyRef.current) return;
      setDraft(value);
      if (input.current) input.current.value = value;
      update({ ...latest.current, draft: value });
    },
    [update],
  );
  useEffect(() => {
    let active = true;
    Promise.all([loadMeeting(deck), loadLibrary(deck)])
      .then(([data, savedLibrary]) => {
        if (!active) return;
        data = identifySpeakers(data);
        latest.current = data;
        setMeeting(data);
        setLibrary(savedLibrary);
        setNames(activeSpeakers(data).join("\n"));
        setAbsent(data.absentees?.join("\n") ?? "");
        setDraft(data.draft);
        setRunning(data.speakers.length > 0 || data.entries.length > 0);
        setReady(true);
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
    if (ready) queueMicrotask(() => (running ? input.current : attendeeInput.current)?.focus());
  }, [ready, running]);
  useEffect(() => {
    const flush = () => {
      if (!busyRef.current && revision.current > 0) void write(latest.current).catch(() => undefined);
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
    if (!ready || busy || revision.current === 0) return;
    const current = revision.current;
    const timer = setTimeout(() => {
      if (busyRef.current) return;
      void write(latest.current)
        .then(() => {
          if (current === revision.current) {
            saveFailed.current = false;
            setStatus("저장했어요.");
          }
        })
        .catch(() => {
          saveFailed.current = true;
          setStatus("자동 저장하지 못했어요. 내보내기에서 .json 백업을 저장하고 다시 시도해 주세요.");
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [meeting, ready, busy, write]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [meeting.entries]);
  const cancelEdit = useCallback(() => {
    if (busyRef.current) return;
    editingId.current = null;
    setEditing(null);
    setKind("발언");
    kindChosen.current = false;
    privateChosen.current = false;
    setPrivateNote(false);
    setInput(previousDraft.current);
    focusInput();
  }, [setInput]);
  const commit = useCallback(() => {
    if (!ready || busyRef.current) return;
    const raw = input.current?.value ?? latest.current.draft;
    const id = editingId.current;
    const original = id ? latest.current.entries.find((entry) => entry.id === id) : undefined;
    const entry = parseEntry(
      raw,
      latest.current.speakers,
      original?.speaker ?? latest.current.selected,
      id ?? crypto.randomUUID(),
      latest.current.speakerIds,
      original?.speakerId ?? latest.current.selectedId,
    );
    if (!entry) {
      if (id) cancelEdit();
      return;
    }
    if (kindChosen.current || (entry.kind === "발언" && kind !== "발언")) entry.kind = kind;
    if (entry.kind === "안건") {
      entry.speaker = "";
      entry.speakerId = "";
    }
    if (privateChosen.current) entry.private = privateNote;
    else entry.private ||= privateNote;
    if (entry.private && entry.kind === "안건") entry.kind = "발언";
    if (original) entry.edited = true;
    entry.timestamp = original?.timestamp ?? new Date().toISOString();
    snapshot();
    editingId.current = null;
    setEditing(null);
    setKind("발언");
    kindChosen.current = false;
    privateChosen.current = false;
    setPrivateNote(false);
    if (input.current) input.current.value = "";
    setDraft("");
    update({
      ...latest.current,
      draft: "",
      entries: id
        ? latest.current.entries.map((item) => (item.id === id ? entry : item))
        : [...latest.current.entries, entry],
    });
    focusInput();
  }, [ready, kind, privateNote, snapshot, update, cancelEdit]);
  const selectSpeaker = useCallback(
    (selected: string, retag = false, selectedId = "") => {
      if (busyRef.current) return;
      const id = editingId.current;
      if (id || retag) {
        const target = id ?? latest.current.entries.at(-1)?.id;
        if (target) {
          snapshot();
          update({
            ...latest.current,
            selected: id ? latest.current.selected : selected,
            selectedId: id ? (latest.current.selectedId ?? "") : selectedId,
            entries: latest.current.entries.map((entry) =>
              entry.id === target ? { ...entry, speaker: selected, speakerId: selectedId, edited: true } : entry,
            ),
          });
        }
      } else update({ ...latest.current, selected, selectedId });
      focusInput();
    },
    [snapshot, update],
  );
  const applyNames = useCallback(() => {
    if (busyRef.current) return false;
    const speakers = lines(names);
    if (!speakers.length || speakers.length > 12) {
      setStatus("참석자를 한 명 이상, 최대 12명까지 입력해 주세요.");
      return false;
    }
    let next: Meeting;
    try {
      next = applyRoster(latest.current, speakers);
    } catch {
      setStatus("기록이 있는 화자를 보존하면 24명을 넘어요. 명단을 정리한 뒤 다시 저장해 주세요.");
      return false;
    }
    snapshot();
    update({ ...next, absentees: lines(absent), startedAt: latest.current.startedAt || new Date().toISOString() });
    setNames(speakers.join("\n"));
    setRunning(true);
    setDialog("");
    focusInput();
    return true;
  }, [names, absent, update, snapshot]);
  const restoreUndo = useCallback(
    (forward = false) => {
      if (busyRef.current) return;
      const source = forward ? redo.current : undo.current;
      const target = forward ? undo.current : redo.current;
      const next = source.pop();
      if (next) {
        target.push(latest.current);
        update({ ...next, draft: latest.current.draft });
        editingId.current = null;
        setEditing(null);
        setKind("발언");
        kindChosen.current = false;
        privateChosen.current = false;
        setPrivateNote(false);
      }
      focusInput();
    },
    [update],
  );
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!ready || busy) return;
      if (event.code === "Escape" && !event.isComposing && event.keyCode !== 229) {
        if (dialog) {
          setDialog("");
          focusInput();
        } else if (editingId.current) cancelEdit();
        return;
      }
      if (!running || dialog === "people") {
        if (event.ctrlKey && event.code === "Enter") {
          event.preventDefault();
          applyNames();
        }
        return;
      }
      if (dialog) return;
      if (["F4", "F8", "F9"].includes(event.code)) {
        event.preventDefault();
        if (event.code === "F9") {
          setNames(activeSpeakers(latest.current).join("\n"));
          setAbsent(latest.current.absentees?.join("\n") ?? "");
        }
        setDialog(event.code === "F4" ? "help" : event.code === "F8" ? "export" : "people");
        return;
      }
      if (event.ctrlKey && !event.altKey && event.code === "KeyZ" && !input.current?.value.trim()) {
        event.preventDefault();
        restoreUndo();
        return;
      }
      if (!event.altKey || event.getModifierState("AltGraph")) {
        const target = event.target;
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          event.key.length === 1 &&
          target instanceof HTMLElement &&
          !target.closest("input, textarea, select, [contenteditable], [role=combobox]")
        )
          input.current?.focus();
        return;
      }
      const speakers = activeSpeakers(latest.current);
      const index = speakerIndex(event.code);
      if (index !== null && speakers[index]) {
        event.preventDefault();
        selectSpeaker(speakers[index] ?? "", event.ctrlKey, latest.current.speakerIds?.[index] ?? "");
      } else if (event.code === "Backquote") {
        event.preventDefault();
        selectSpeaker("");
      } else if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        event.preventDefault();
        const current = editingId.current
          ? (latest.current.entries.find((entry) => entry.id === editingId.current)?.speaker ?? "")
          : latest.current.selected;
        const currentId = editingId.current
          ? latest.current.entries.find((entry) => entry.id === editingId.current)?.speakerId
          : latest.current.selectedId;
        const at = latest.current.speakerIds?.indexOf(currentId ?? "") ?? speakers.indexOf(current);
        const step = event.code === "ArrowDown" ? 1 : -1;
        const nextIndex =
          at < 0 ? (step > 0 ? 0 : speakers.length - 1) : (at + step + speakers.length) % speakers.length;
        selectSpeaker(speakers[nextIndex] ?? "", false, latest.current.speakerIds?.[nextIndex] ?? "");
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [ready, busy, running, dialog, applyNames, selectSpeaker, restoreUndo, cancelEdit]);
  const edit = useCallback(
    (entry: Entry) => {
      if (busyRef.current) return;
      previousDraft.current = editingId.current ? previousDraft.current : latest.current.draft;
      editingId.current = entry.id;
      setEditing(entry.id);
      setKind(entry.kind);
      kindChosen.current = false;
      privateChosen.current = false;
      setPrivateNote(entry.private);
      setInput(entryInput(entry));
      focusInput();
    },
    [setInput],
  );
  const remove = useCallback((id: string) => {
    if (busyRef.current) return;
    setEntryToRemove(id);
    setDialog("delete-entry");
    focusInput();
  }, []);
  const speakerChoices = useMemo(
    () =>
      meeting.speakers.map((name, i) => ({
        value: meeting.speakerIds?.[i] ?? `legacy-${i}`,
        label: `${i + 1}. ${name}`,
      })),
    [meeting.speakers, meeting.speakerIds],
  );
  const speakerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of meeting.entries) {
      if (entry.kind === "안건") continue;
      const key = entry.speakerId || entry.speaker;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [meeting.entries]);
  const retagEntry = useCallback(
    (id: string, speakerId: string) => {
      if (busyRef.current) return;
      snapshot();
      const at = (latest.current.speakerIds ?? latest.current.speakers.map((_, i) => `legacy-${i}`)).indexOf(speakerId);
      update({
        ...latest.current,
        entries: latest.current.entries.map((e) =>
          e.id === id ? { ...e, speakerId, speaker: latest.current.speakers[at] ?? "", edited: true } : e,
        ),
      });
    },
    [snapshot, update],
  );
  const task = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (error instanceof Error && error.message === "ARCHIVE_FULL")
        setStatus("지난 회의가 20개로 가득 찼어요. 지난 회의에서 불필요한 보관을 제거한 뒤 다시 시도해 주세요.");
      else setStatus("처리하지 못했어요. 현재 회의는 그대로 두었어요. 저장 공간과 파일을 확인해 주세요.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const switchTo = async (data: Meeting) => {
    data = identifySpeakers(data);
    const next = await archiveMeeting(deck, latest.current, library);
    setLibrary(next);
    await write(data);
    update(data, true);
    setNames(activeSpeakers(data).join("\n"));
    setAbsent(data.absentees?.join("\n") ?? "");
    setDraft(data.draft);
    setRunning(data.speakers.length > 0 || data.entries.length > 0);
    editingId.current = null;
    setEditing(null);
    undo.current = [];
    redo.current = [];
    setKind("발언");
    kindChosen.current = false;
    privateChosen.current = false;
    setPrivateNote(false);
    setDialog("");
    focusInput();
  };
  const copyPublic = (rich: boolean) =>
    void task(async () => {
      if (!deck.has("clipboard")) return;
      setCopyStatus("복사하는 중이에요.");
      try {
        if (rich) await deck.clipboard.writeRichText(publicClipboard(latest.current));
        else await deck.clipboard.writeText({ text: exportText(latest.current, "txt") });
        setCopyStatus("클립보드에 복사했어요. 한글·Word에서 붙여넣어 주세요.");
      } catch (error) {
        setCopyStatus(
          error instanceof DeckCallError && error.code === "INVALID_ARGS"
            ? "복사할 내용이 너무 크거나 지원하지 않는 문자가 있어요. 공개용 파일로 저장해 주세요."
            : "복사하지 못했어요. 다른 프로그램의 클립보드 작업이 끝나면 다시 눌러 주세요.",
        );
      }
    });
  const loadFile = () =>
    void task(async () => {
      const data = await pickMeeting(deck);
      if (data) await switchTo(data);
    });
  const saveRoster = () =>
    void task(async () => {
      const people = lines(names);
      const name = rosterName.trim();
      if (!name || !people.length || people.length > 12) {
        setStatus("위원회 이름과 참석자 명단을 입력해 주세요.");
        return;
      }
      if (!library.rosters.some((r) => r.name === name) && library.rosters.length >= 40) {
        setStatus("위원회는 최대 40개까지 저장해요. 저장된 명단을 정리하거나 기존 이름으로 갱신해 주세요.");
        return;
      }
      const next = {
        ...library,
        rosters: [
          ...library.rosters.filter((r) => r.name !== name),
          { name, people, title: latest.current.title, place: latest.current.place ?? "" },
        ],
      };
      await deck.storage.set(LIBRARY_KEY, next);
      setLibrary(next);
      setStatus("위원회 명단을 저장했어요.");
    });
  const currentAgenda = useMemo(
    () => [...meeting.entries].reverse().find((entry) => entry.kind === "안건")?.text ?? "",
    [meeting.entries],
  );
  const recordStats = useMemo(
    () => ({
      speech: meeting.entries.filter((e) => e.kind === "발언").length,
      decision: meeting.entries.filter((e) => e.kind === "결정").length,
      action: meeting.entries.filter((e) => e.kind === "조치").length,
      agenda: meeting.entries.filter((e) => e.kind === "안건").length,
    }),
    [meeting.entries],
  );
  const [format, setFormat] = useState<ExportFormat>("md");
  const exportBody = useMemo(() => (dialog === "export" ? exportText(meeting, format) : ""), [dialog, format, meeting]);
  const saveExport = (backup: boolean) =>
    void task(async () => {
      if (await saveFile(deck, latest.current, backup, format))
        setStatus(
          backup ? "비공개 메모와 초안을 포함한 백업 파일을 저장했어요." : "비공개 메모를 뺀 회의록 파일을 저장했어요.",
        );
    });
  const saveNow = () =>
    void task(async () => {
      await write(latest.current);
      saveFailed.current = false;
      setStatus("저장했어요.");
    });
  const peopleFields = (
    <div className={s.grid}>
      <TextBox
        header="참석자"
        inputRef={attendeeInput}
        multiline
        rows={6}
        value={names}
        disabled={busy}
        onChange={(value) => {
          if (!busyRef.current) setNames(value);
        }}
        description="한 줄에 한 명, 최대 12명. 순서대로 Alt+1~9, 0, -, =를 써요."
      />
      <TextBox
        header="결석자 (선택)"
        multiline
        rows={6}
        value={absent}
        disabled={busy}
        onChange={(value) => {
          if (!busyRef.current) setAbsent(value);
        }}
      />
    </div>
  );
  const importRosters = () =>
    void task(async () => {
      const value = await pickRosters(deck);
      if (!value) return;
      const next = { ...library, rosters: mergeRosters(library.rosters, value) };
      await deck.storage.set(LIBRARY_KEY, next);
      setLibrary(next);
      setStatus("위원회 명단을 불러왔어요.");
    });
  const rosterFields = (
    <SettingsExpander header="위원회 · 저장된 명단" description="자주 쓰는 참석자 명단을 저장하고 불러와요.">
      <div className={s.row}>
        <TextBox
          header="위원회 이름"
          value={rosterName}
          disabled={busy}
          onChange={(value) => {
            if (!busyRef.current) setRosterName(value);
          }}
        />
        <Button onClick={saveRoster} disabled={busy}>
          명단 저장·갱신
        </Button>
      </div>
      <div className={s.row}>
        <Button disabled={busy} onClick={importRosters}>
          위원회 파일 불러오기
        </Button>
        <Button
          disabled={busy || !library.rosters.length}
          onClick={() => void task(() => saveRosters(deck, library.rosters))}
        >
          위원회 파일 저장
        </Button>
      </div>
      <ListView
        header="저장된 위원회 관리"
        items={library.rosters}
        getKey={(r) => r.name}
        renderItem={(r) => (
          <div className={s.row}>
            <Body>{r.name}</Body>
            <Button
              disabled={busy}
              onClick={() => {
                setRosterToRemove(r.name);
                setDialog("delete-roster");
              }}
            >
              명단 삭제
            </Button>
          </div>
        )}
      />
      {library.rosters.length > 0 && (
        <ComboBox
          disabled={busy}
          header="저장된 위원회"
          value=""
          options={[
            { value: "", label: "위원회 명단 불러오기" },
            ...library.rosters.map((r) => ({ value: r.name, label: r.name })),
          ]}
          onChange={(name) => {
            if (busyRef.current) return;
            const roster = library.rosters.find((r) => r.name === name);
            if (roster) {
              setNames(roster.people.join("\n"));
              if (!running) update({ ...latest.current, title: roster.title, place: roster.place });
            }
          }}
        />
      )}
    </SettingsExpander>
  );
  const archiveList = (
    <ListView
      header="지난 회의"
      items={library.archive}
      getKey={(item) => item.key}
      emptyText="보관된 회의가 없어요."
      renderItem={(item) => (
        <div className={s.row}>
          <Body>
            {item.title} · {item.count}건
          </Body>
          <Button
            disabled={busy}
            onClick={() =>
              void task(async () => {
                await switchTo(await archivedMeeting(deck, item.key));
              })
            }
          >
            회의 열기
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setRemoveKey(item.key);
              setDialog("remove");
            }}
          >
            보관 제거
          </Button>
        </div>
      )}
    />
  );
  if (!ready)
    return (
      <div className={s.page}>
        {failedLoad ? <InfoBar severity="error" message={status} /> : <ProgressRing label="회의록을 불러오는 중" />}
      </div>
    );
  return (
    <div className={s.page}>
      {!running ? (
        <div className={s.setup}>
          <PageHeader
            title="회의록 시작"
            description="참석자를 입력하면 바로 시작해요. 회의 중에도 F9로 명단을 바꿀 수 있어요."
          />
          <div className={s.grid}>
            <TextBox
              disabled={busy}
              header="회의 제목"
              value={meeting.title}
              onChange={(title) => update({ ...latest.current, title })}
            />
            <TextBox
              disabled={busy}
              header="장소 (선택)"
              value={meeting.place ?? ""}
              onChange={(place) => update({ ...latest.current, place })}
            />
          </div>
          {peopleFields}
          <div className={s.row}>
            <Button disabled={busy} appearance="primary" onClick={applyNames}>
              회의 시작 (Ctrl+Enter)
            </Button>
            <Button onClick={loadFile} disabled={busy}>
              파일(.json) 불러오기
            </Button>
          </div>
          {library.rosters.length > 0 && (
            <div className={s.row}>
              <BodyStrong>저장된 위원회</BodyStrong>
              {library.rosters.map((roster) => (
                <Button
                  key={roster.name}
                  disabled={busy}
                  onClick={() => {
                    setNames(roster.people.join("\n"));
                    setRosterName(roster.name);
                    update({ ...latest.current, title: roster.title, place: roster.place });
                  }}
                >
                  {roster.name} 불러오기
                </Button>
              ))}
            </div>
          )}
          {rosterFields}
          {library.archive.length > 0 && archiveList}
        </div>
      ) : (
        <>
          <div className={s.toolbar}>
            <BodyStrong>{meeting.title}</BodyStrong>
            <Caption secondary>
              {meeting.place}
              {meeting.place ? " · " : ""}참석 {meeting.speakers.length}명
              {meeting.absentees?.length ? ` · 결석 ${meeting.absentees.length}명` : ""}
            </Caption>
            <Caption secondary className={s.saved}>
              {status}
            </Caption>
            <Button size="small" onClick={() => setDialog("export")}>
              내보내기 (F8)
            </Button>
            <Button
              onClick={() => {
                setNames(activeSpeakers(latest.current).join("\n"));
                setAbsent(latest.current.absentees?.join("\n") ?? "");
                setDialog("people");
              }}
            >
              참석자 (F9)
            </Button>
            <Button onClick={() => setDialog("help")}>도움말 (F4)</Button>
            <Button disabled={busy} onClick={() => setDialog("archive")}>
              지난 회의
            </Button>
            <Button disabled={busy} onClick={() => setDialog("new")}>
              새 회의
            </Button>
          </div>
          <div className={s.workspace}>
            <div className={s.editor}>
              <div ref={log} className={s.log}>
                <Records
                  entries={meeting.entries}
                  edit={edit}
                  remove={remove}
                  busy={busy}
                  speakers={speakerChoices}
                  retag={retagEntry}
                />
              </div>
              <div className={s.composer}>
                <div className={s.current}>
                  <BodyStrong>현재 안건: {currentAgenda || "일반 안건"}</BodyStrong>
                  <BodyStrong>
                    {editing ? "수정 중" : "현재 화자"}:{" "}
                    {editing
                      ? meeting.entries.find((entry) => entry.id === editing)?.speaker || "미지정"
                      : meeting.selected || "미지정"}
                  </BodyStrong>
                  {editing && (
                    <Button disabled={busy} onClick={cancelEdit}>
                      수정 취소 (Esc)
                    </Button>
                  )}
                  <Caption secondary>
                    Alt+숫자 화자 · ! 결정 · * 조치 · # 안건 · ? 질의 · // 비공개 · Enter 기록
                  </Caption>
                </div>
                <SettingsExpander header="종류 · 비공개 선택" description="접두어로 바로 입력하거나 여기서 선택해요.">
                  <div className={s.row}>
                    {KINDS.map((item) => (
                      <ToggleButton
                        disabled={busy}
                        key={item}
                        checked={kind === item}
                        onClick={() => {
                          kindChosen.current = true;
                          setKind(item);
                          focusInput();
                        }}
                      >
                        {item}
                      </ToggleButton>
                    ))}
                    <CheckBox
                      disabled={busy}
                      content="비공개 메모"
                      checked={privateNote}
                      onChange={(checked) => {
                        if (busyRef.current) return;
                        privateChosen.current = true;
                        setPrivateNote(checked);
                      }}
                    />
                  </div>
                </SettingsExpander>
                <TextBox
                  disabled={busy}
                  header="발언 입력"
                  showHeader={false}
                  multiline
                  rows={2}
                  value={draft}
                  inputRef={input}
                  onChange={setInput}
                  placeholder="발언 내용을 입력하고 Enter"
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
                    } else if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
                      queued.current = true;
                    else commit();
                  }}
                />
                <div className={s.row}>
                  <Button disabled={busy} appearance="primary" onClick={commit}>
                    {editing ? "수정 저장" : "기록"}
                  </Button>
                  <Button disabled={busy || !undo.current.length} onClick={() => restoreUndo()}>
                    기록 되돌리기
                  </Button>
                  <Button disabled={busy || !redo.current.length} onClick={() => restoreUndo(true)}>
                    다시 적용
                  </Button>
                  <Button onClick={saveNow} disabled={busy}>
                    지금 저장
                  </Button>
                  <Caption secondary>전체 {meeting.entries.length}건 · Shift+Enter 줄바꿈 · Alt+↑↓ 화자 이동</Caption>
                </div>
              </div>
            </div>
            <div className={s.speakers}>
              <BodyStrong className={s.speakerHeading}>참석자 · 화자 선택</BodyStrong>
              {meeting.speakers.map((name, index) => (
                <ToggleButton
                  disabled={busy}
                  className={mergeClasses(
                    s.speakerButton,
                    (editing
                      ? meeting.entries.find((entry) => entry.id === editing)?.speakerId
                      : meeting.selectedId) === meeting.speakerIds?.[index] && s.selectedSpeaker,
                  )}
                  key={meeting.speakerIds?.[index] ?? index}
                  aria-label={`${speakerLabel(meeting, index)}${index < (meeting.activeSpeakerCount ?? 12) && KEYS[index] ? ` · Alt+${KEYS[index]}` : ""}`}
                  checked={
                    (editing
                      ? meeting.entries.find((entry) => entry.id === editing)?.speakerId
                      : meeting.selectedId) === meeting.speakerIds?.[index]
                  }
                  onClick={() => selectSpeaker(name, false, meeting.speakerIds?.[index] ?? "")}
                >
                  <span className={s.key}>
                    {index < (meeting.activeSpeakerCount ?? 12) && KEYS[index] ? KEYS[index] : "이전"}
                  </span>
                  <span
                    aria-hidden="true"
                    className={s.dot}
                    style={{ backgroundColor: SPEAKER_COLORS[index % SPEAKER_COLORS.length] }}
                  />
                  <span style={{ color: SPEAKER_COLORS[index % SPEAKER_COLORS.length] }}>
                    <BodyStrong>{speakerLabel(meeting, index)}</BodyStrong>
                  </span>
                  <Caption secondary>{speakerCounts.get(meeting.speakerIds?.[index] ?? name) ?? 0}건</Caption>
                </ToggleButton>
              ))}
              <ToggleButton disabled={busy} checked={!meeting.selected} onClick={() => selectSpeaker("")}>
                화자 미지정 · Alt+`
              </ToggleButton>
              <div className={s.stats}>
                <Caption secondary>Alt+숫자 선택 · Alt+↑↓ 이동</Caption>
                <Body>
                  발언 {recordStats.speech} · 결정 {recordStats.decision} · 조치 {recordStats.action}
                </Body>
                <Caption secondary>안건 {recordStats.agenda}개</Caption>
              </div>
            </div>
          </div>
        </>
      )}
      {!running && <Caption secondary>{status}</Caption>}
      {busy && <ProgressRing label="파일과 회의록을 처리하는 중" />}
      {saveFailed.current && <InfoBar severity="error" message={status} />}
      <ContentDialog
        open={dialog === "delete-entry"}
        title="기록 삭제"
        primaryButtonText="삭제"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          if (busyRef.current) return;
          if (result === "primary") {
            snapshot();
            update({ ...latest.current, entries: latest.current.entries.filter((e) => e.id !== entryToRemove) });
            if (editingId.current === entryToRemove) cancelEdit();
          }
          setDialog("");
          focusInput();
        }}
      >
        <Body>
          {meeting.entries.find((e) => e.id === entryToRemove)?.kind === "안건"
            ? "안건 제목을 삭제하면 아래 기록은 앞 안건에 합쳐져요. 기록 내용은 유지해요."
            : "이 기록을 삭제해요. 기록 되돌리기로 복원할 수 있어요."}
        </Body>
      </ContentDialog>
      <ContentDialog
        open={dialog === "delete-roster"}
        title="위원회 명단 삭제"
        primaryButtonText="삭제"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          if (busyRef.current) return;
          if (result === "primary")
            void task(async () => {
              const next = { ...library, rosters: library.rosters.filter((r) => r.name !== rosterToRemove) };
              await deck.storage.set(LIBRARY_KEY, next);
              setLibrary(next);
              setDialog(running ? "people" : "");
            });
          else setDialog(running ? "people" : "");
        }}
      >
        <Body>{rosterToRemove} 명단을 앱에서 삭제해요. 현재 회의와 위원회 백업 파일은 유지해요.</Body>
      </ContentDialog>
      <ContentDialog
        open={dialog === "people"}
        title="참석자 편집"
        primaryButtonText="저장"
        closeButtonText="취소"
        onClose={(result) => {
          if (busyRef.current) return;
          if (result === "primary") applyNames();
          else {
            setDialog("");
            focusInput();
          }
        }}
      >
        <div className={s.stack}>
          {peopleFields}
          {rosterFields}
          <Caption secondary>기존 기록의 화자 이름은 그대로 보존해요.</Caption>
        </div>
      </ContentDialog>
      <ContentDialog
        open={dialog === "export"}
        title="내보내기"
        closeButtonText="닫기"
        onClose={() => {
          if (busyRef.current) return;
          setDialog("");
          focusInput();
        }}
      >
        <div className={s.stack}>
          <div className={s.row}>
            {(["md", "txt", "summary", "html"] as const).map((item) => (
              <ToggleButton disabled={busy} key={item} checked={format === item} onClick={() => setFormat(item)}>
                {item === "md"
                  ? "마크다운"
                  : item === "txt"
                    ? "일반 텍스트"
                    : item === "html"
                      ? "한글·워드 HTML"
                      : "요약"}
              </ToggleButton>
            ))}
          </div>
          <TextBox
            header="내보낼 회의록 본문"
            multiline
            rows={12}
            readOnly
            value={exportBody}
            onChange={() => undefined}
          />
          <Caption secondary>비공개 메모는 제외해요. 서식을 유지해 복사하거나 공개용 파일로 저장해 주세요.</Caption>
          <CapabilityGate deck={deck} cap="clipboard" feature="서식 복사">
            <div className={s.row}>
              <Button appearance="primary" disabled={busy} onClick={() => copyPublic(true)}>
                서식을 유지해 복사
              </Button>
              <Button disabled={busy} onClick={() => copyPublic(false)}>
                텍스트 복사
              </Button>
            </div>
            {copyStatus && <Caption>{copyStatus}</Caption>}
          </CapabilityGate>
          <div className={s.row}>
            <Button onClick={() => saveExport(false)} disabled={busy}>
              공개용 파일 저장
            </Button>
            <Button onClick={() => saveExport(true)} disabled={busy}>
              .json 백업 저장
            </Button>
            <Button onClick={loadFile} disabled={busy}>
              파일(.json) 불러오기
            </Button>
          </div>
          <InfoBar
            severity="warning"
            message=".json 백업에는 비공개 메모와 초안도 포함해요. 개인 보관용으로만 사용해 주세요. 선택한 폴더 안에 새 결과 폴더를 만들어요."
          />
        </div>
      </ContentDialog>
      <ContentDialog
        open={dialog === "help"}
        title="회의록 도움말"
        closeButtonText="닫기"
        onClose={() => {
          if (busyRef.current) return;
          setDialog("");
          focusInput();
        }}
      >
        <div className={s.stack}>
          <Body>Alt+1~9, 0, -, =: 화자 선택 · Alt+↑↓: 이전/다음 화자 · Alt+`: 미지정</Body>
          <Body>Enter: 기록 · Ctrl+Enter: 강제 기록 · Shift+Enter: 줄바꿈</Body>
          <Body>Ctrl+Alt+숫자: 방금 기록한 화자 정정 · Ctrl+Z: 빈 입력창에서 기록 되돌리기</Body>
          <Body>F4: 도움말 · F8: 내보내기 · F9: 참석자 · Esc: 창 닫기/수정 취소</Body>
          <Body>
            ! 결정 · * 조치 @담당자 ~기한 · ? 질의 · # 안건 · // 비공개 · 숫자+공백: 해당 줄 화자 · 역슬래시: 기호를
            본문으로 남기기
          </Body>
          <Body>버튼으로 기록 종류와 비공개 여부를 고를 수도 있어요. 자동 저장 완료 안내를 확인한 뒤 닫아 주세요.</Body>
        </div>
      </ContentDialog>
      <ContentDialog
        open={dialog === "archive"}
        title="지난 회의"
        closeButtonText="닫기"
        onClose={() => {
          if (!busyRef.current) setDialog("");
        }}
      >
        {archiveList}
      </ContentDialog>
      <ContentDialog
        open={dialog === "remove"}
        title="지난 회의 보관 제거"
        primaryButtonText="보관 제거"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          if (busyRef.current) return;
          if (result === "primary")
            void task(async () => {
              const next = await removeArchive(deck, removeKey, library);
              setLibrary(next);
              setDialog("archive");
              setStatus("선택한 지난 회의의 앱 내 보관을 제거했어요.");
            });
          else setDialog("archive");
        }}
      >
        <Body>선택한 지난 회의의 앱 내 보관을 제거해요. 외부 백업 파일과 현재 작성 중인 회의는 그대로 유지해요.</Body>
        <BodyStrong>{library.archive.find((item) => item.key === removeKey)?.title}</BodyStrong>
      </ContentDialog>
      <ContentDialog
        open={dialog === "new"}
        title="새 회의"
        primaryButtonText="새 회의 시작"
        closeButtonText="취소"
        onClose={(result) => {
          if (busyRef.current) return;
          if (result === "primary")
            void task(async () => {
              await switchTo(emptyMeeting());
            });
          else setDialog("");
        }}
      >
        <Body>현재 회의를 지난 회의에 보관하고 시작 화면으로 이동해요. 보관하지 못하면 현재 회의를 계속 유지해요.</Body>
      </ContentDialog>
    </div>
  );
}
