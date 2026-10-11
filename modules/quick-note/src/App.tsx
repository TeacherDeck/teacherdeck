// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import {
  Body,
  BodyStrong,
  Button,
  Caption,
  CheckBox,
  ComboBox,
  ContentDialog,
  EmptyState,
  InfoBar,
  PageHeader,
  SettingsExpander,
  Subtitle,
  TextBox,
  deckTokens,
  makeStyles,
  tokens,
} from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import {
  STATE_KEY,
  emptyDocument,
  mergeDocuments,
  readDocument,
  visibleItems,
  type Document,
  type Item,
} from "./logic.ts";
import { exportBackup, pickBackup, replaceDocument } from "./files.ts";
const useStyles = makeStyles({
  page: { padding: deckTokens.pagePadding, display: "flex", flexDirection: "column", gap: deckTokens.sectionGap },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))",
    gap: deckTokens.itemGap,
  },
  card: {
    padding: deckTokens.pagePadding,
    borderRadius: deckTokens.cardRadius,
    backgroundColor: deckTokens.cardFill,
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  body: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  yellow: { backgroundColor: tokens.colorPaletteYellowBackground1 },
  blue: { backgroundColor: tokens.colorPaletteBlueBackground2 },
  green: { backgroundColor: tokens.colorPaletteGreenBackground1 },
});
function blankItem(): Item {
  return {
    id: crypto.randomUUID(),
    title: "",
    body: "",
    pinned: false,
    tone: "neutral",
    archived: false,
    updatedAt: new Date().toISOString(),
  };
}
export function App({ deck }: { deck: Deck }) {
  const s = useStyles(),
    [document, setDocument] = useState<Document>(emptyDocument),
    [draft, setDraft] = useState<Item>(blankItem);
  const [ready, setReady] = useState(false),
    [blocked, setBlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Document | null>(null),
    [previewOpen, setPreviewOpen] = useState(false),
    [addToList, setAddToList] = useState(true);
  const raw = useRef<unknown>(null),
    lock = useRef(false),
    active = useRef(true);
  const [recoveryKeys, setRecoveryKeys] = useState<string[]>([]),
    [recoveryKey, setRecoveryKey] = useState("");

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, [deck]);
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setReady(false);
    try {
      const value = await deck.storage.get(STATE_KEY);
      raw.current = value;
      const next = value === null ? emptyDocument() : readDocument(value);
      if (active.current) {
        setDocument(next);
        setBlocked(false);
        setReady(true);
        setMessage("");
      }
    } catch {
      if (active.current) {
        setBlocked(true);
        setReady(true);
        setMessage("저장 자료를 읽지 못했어요. 원자료를 유지하며 다시 읽거나 정상 백업을 확인해 복구해 주세요.");
      }
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function task(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await action();
    } catch {
      if (active.current)
        setMessage(
          "작업하지 못했어요. 입력과 기존 자료를 유지했어요. 파일이나 저장 공간을 확인하고 다시 시도해 주세요.",
        );
    } finally {
      lock.current = false;
      if (active.current) setBusy(false);
    }
  }
  async function commit(next: Document) {
    const checked = readDocument(next);
    await deck.storage.set(STATE_KEY, checked);
    if (active.current) {
      setDocument(checked);
      raw.current = checked;
      setMessage("이 PC에 저장했어요.");
    }
  }
  async function saveDraft() {
    if (!draft.title.trim() && !draft.body.trim()) {
      setMessage("제목이나 메모 내용을 적어 주세요.");
      return;
    }
    await commit({
      ...document,
      items: [
        ...document.items.filter((item) => item.id !== draft.id),
        { ...draft, updatedAt: new Date().toISOString() },
      ],
    });
    if (active.current) setDraft(blankItem());
  }
  function patch(item: Item, changes: Partial<Item>) {
    void task(async () => {
      const updatedAt = new Date().toISOString();
      await commit({
        ...document,
        items: document.items.map((entry) => (entry.id === item.id ? { ...entry, ...changes, updatedAt } : entry)),
      });
      if (active.current)
        setDraft((previous) => (previous.id === item.id ? { ...previous, ...changes, updatedAt } : previous));
    });
  }
  function editItem(item: Item) {
    const original = document.items.find((entry) => entry.id === draft.id);
    const changed = original ? JSON.stringify(original) !== JSON.stringify(draft) : !!(draft.title || draft.body);
    if (changed) {
      setMessage("입력 중인 내용을 먼저 저장하거나 입력 취소를 눌러 주세요.");
      return;
    }
    setDraft({ ...item });
  }
  const shown = visibleItems(document, query, archived),
    currentPage = Math.min(page, Math.max(0, Math.ceil(shown.length / 20) - 1)),
    editing = document.items.some((item) => item.id === draft.id);
  const disabled = !ready || busy || blocked;
  return (
    <main className={s.page}>
      <PageHeader title="빠른 메모" description="짧게 적고 저장해요. 고정·검색·보관으로 다시 찾아요." />
      {message && <InfoBar severity={blocked ? "warning" : "informational"} message={message} />}
      {blocked && (
        <div className={s.row}>
          <Button disabled={busy} onClick={() => void load()}>
            다시 읽기
          </Button>
          <Button
            disabled={busy || raw.current === null}
            onClick={() =>
              void task(async () => {
                if (await exportBackup(deck, raw.current)) setMessage("원자료 사본을 새 폴더에 저장했어요.");
              })
            }
          >
            원자료 사본 저장
          </Button>
        </div>
      )}
      <section className={s.card} aria-label="메모 입력">
        <BodyStrong>{editing ? "메모 수정" : "새 메모"}</BodyStrong>
        <TextBox
          header="제목 (선택)"
          value={draft.title}
          disabled={disabled}
          onChange={(title) => {
            if (title.length <= 120) setDraft({ ...draft, title });
          }}
        />
        <TextBox
          header="메모 내용"
          multiline
          rows={3}
          value={draft.body}
          disabled={disabled}
          onChange={(body) => {
            if (body.length <= 4000) setDraft({ ...draft, body });
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void task(saveDraft);
            }
          }}
        />
        <div className={s.row}>
          <CheckBox
            content="상단 고정"
            checked={draft.pinned}
            disabled={disabled}
            onChange={(pinned) => setDraft({ ...draft, pinned })}
          />
          <ComboBox
            header="메모 색"
            value={draft.tone}
            disabled={disabled}
            options={[
              { value: "neutral", label: "기본" },
              { value: "yellow", label: "노랑" },
              { value: "blue", label: "파랑" },
              { value: "green", label: "초록" },
            ]}
            onChange={(tone) => setDraft({ ...draft, tone })}
          />
        </div>
        <div className={s.row}>
          <Button appearance="primary" disabled={disabled} onClick={() => void task(saveDraft)}>
            {editing ? "수정 저장" : "메모 저장"}
          </Button>
          <Button disabled={disabled} onClick={() => setDraft(blankItem())}>
            입력 취소
          </Button>
        </div>
        <Caption secondary>
          입력 중인 내용은 저장을 누르기 전까지 초안이에요. Ctrl+Enter로도 저장해요. 메모는 보관해도 사라지지 않아요.
        </Caption>
      </section>
      <div className={s.row}>
        <TextBox
          header="메모 검색"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
        <CheckBox
          content="보관함 보기"
          checked={archived}
          onChange={(value) => {
            setArchived(value);
            setPage(0);
          }}
        />
      </div>
      <div className={s.cards}>
        {shown.slice(currentPage * 20, currentPage * 20 + 20).map((item) => (
          <section key={item.id} className={[s.card, item.tone === "neutral" ? "" : s[item.tone]].join(" ")}>
            <Subtitle>{item.title || "제목 없는 메모"}</Subtitle>
            {item.pinned && <Caption>상단 고정</Caption>}
            <Body className={s.body}>{item.body}</Body>
            <div className={s.row}>
              <Button disabled={disabled} onClick={() => editItem(item)}>
                수정
              </Button>
              <Button
                disabled={disabled}
                onClick={() =>
                  void task(async () => {
                    if (await exportBackup(deck, { ...document, items: [item] }))
                      setMessage("선택한 항목을 새 폴더에 저장했어요.");
                  })
                }
              >
                항목 백업 저장
              </Button>
              <Button disabled={disabled} onClick={() => patch(item, { pinned: !item.pinned })}>
                {item.pinned ? "고정 해제" : "고정"}
              </Button>
              <Button disabled={disabled} onClick={() => patch(item, { archived: !item.archived })}>
                {item.archived ? "보관 해제" : "보관"}
              </Button>
            </div>
          </section>
        ))}
      </div>
      {!shown.length && (
        <EmptyState
          title={archived ? "보관한 메모가 없어요" : "찾은 메모가 없어요"}
          description="새 내용을 저장하거나 검색어를 바꿔 주세요."
        />
      )}
      {shown.length > 20 && (
        <div className={s.row}>
          <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            이전
          </Button>
          <Caption>
            {currentPage + 1} / {Math.ceil(shown.length / 20)}
          </Caption>
          <Button disabled={(currentPage + 1) * 20 >= shown.length} onClick={() => setPage(currentPage + 1)}>
            다음
          </Button>
        </div>
      )}
      <SettingsExpander
        header="백업 · 가져오기"
        description="저장한 메모와 보관함을 JSON 파일로 옮겨요. 입력 중인 초안은 먼저 저장해 주세요."
      >
        <div className={s.row}>
          <Button
            disabled={disabled}
            onClick={() =>
              void task(async () => {
                if (await exportBackup(deck, document)) setMessage("백업을 새 폴더에 저장했어요.");
              })
            }
          >
            JSON 백업 저장
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              void task(async () => {
                const next = await pickBackup(deck);
                if (next && active.current) {
                  setPreview(next);
                  setAddToList(!blocked);
                  setPreviewOpen(true);
                }
              })
            }
          >
            JSON 백업 가져오기
          </Button>
          <Button
            disabled={!ready || busy}
            onClick={() =>
              void task(async () => {
                const keys = (await deck.storage.keys()).filter((key) => key.startsWith("recovery.v1."));
                setRecoveryKeys(keys);
                setRecoveryKey(keys[0] ?? "");
                setMessage(
                  keys.length
                    ? "이전 자료를 선택해 사본을 저장하거나 확인 후 복원해 주세요."
                    : "별도로 보존한 이전 자료가 없어요.",
                );
              })
            }
          >
            이전 자료 찾기
          </Button>
        </div>
        {recoveryKeys.length > 0 && (
          <>
            <ComboBox
              header="이전 자료"
              value={recoveryKey}
              disabled={busy}
              options={recoveryKeys.map((key, index) => ({ value: key, label: `이전 자료 ${index + 1}` }))}
              onChange={setRecoveryKey}
            />
            <Button
              disabled={busy || !recoveryKey}
              onClick={() =>
                void task(async () => {
                  const value = await deck.storage.get(recoveryKey);
                  if (await exportBackup(deck, value)) setMessage("이전 자료 사본을 새 폴더에 저장했어요.");
                })
              }
            >
              이전 자료 사본 저장
            </Button>
            <Button
              disabled={busy || !recoveryKey}
              onClick={() =>
                void task(async () => {
                  const value = readDocument(await deck.storage.get(recoveryKey));
                  setPreview(value);
                  setAddToList(false);
                  setPreviewOpen(true);
                })
              }
            >
              이전 자료 복원 확인
            </Button>
          </>
        )}
      </SettingsExpander>
      <ContentDialog
        open={previewOpen}
        title="메모 백업 확인"
        primaryButtonText="확인하고 복원"
        closeButtonText="취소"
        defaultButton="close"
        onClose={(result) => {
          setPreviewOpen(false);
          if (result === "primary" && preview)
            void task(async () => {
              const next = addToList ? mergeDocuments(document, preview) : preview;
              await replaceDocument(deck, next);
              if (active.current) {
                setDocument(next);
                raw.current = next;
                setBlocked(false);
                setDraft((previous) => ({ ...previous, id: crypto.randomUUID() }));
                setMessage("백업을 복원했어요. 이전 저장값은 별도 복구 키에 보존했어요.");
              }
            });
        }}
      >
        <Body>
          {preview?.items.length ?? 0}개 · 보관 {preview?.items.filter((item) => item.archived).length ?? 0}개예요.
        </Body>
        <CheckBox content="현재 목록에 추가" checked={addToList} disabled={blocked} onChange={setAddToList} />
        <Body>
          {addToList
            ? "기존 항목을 유지하고 추가해요. 같은 ID는 새 항목으로 추가해요."
            : "현재 목록을 이 백업으로 바꿔요."}
        </Body>
        <Body>
          {" "}
          기존 저장값을 별도 복구 키에 보존한 뒤 적용하며 보존·저장에 실패하면 기존 목록을 유지해요. 입력 중인 초안은
          유지해요.
        </Body>
        {(preview?.items ?? []).slice(0, 5).map((item) => (
          <Body key={item.id}>{item.title || "제목 없는 메모"}</Body>
        ))}
      </ContentDialog>
    </main>
  );
}
