// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useRef, useState } from "react";
import type { MessagingApprovalRequest, MessagingApprovalResolution } from "@deck/sdk";
import { Body, Button, Caption, CheckBox, ContentDialog, InfoBar, TextBox, deckTokens, makeStyles } from "@deck/ui";

/** Trusted shell only: the host owns request identity and immutable previews. */
export interface MessagingConfirmationHost {
  pending(): Promise<MessagingApprovalRequest[]>;
  resolve(args: MessagingApprovalResolution): Promise<void>;
}
const PAGE_SIZE = 10;
const useStyles = makeStyles({
  review: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    maxHeight: "50vh",
    overflowY: "auto",
    "& > *": { flexShrink: 0 },
  },
  message: {
    display: "flex",
    flexDirection: "column",
    gap: deckTokens.itemGap,
    padding: deckTokens.cardPadding,
    backgroundColor: deckTokens.cardFill,
    borderRadius: deckTokens.cardRadius,
    "& > *": { flexShrink: 0 },
  },
  body: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  actions: { display: "flex", flexWrap: "wrap", gap: deckTokens.itemGap },
});

/** A host-owned one-shot registration review, never supplied by an iframe. */
export function MessagingConfirmation({ host }: { host: MessagingConfirmationHost }) {
  const s = useStyles();
  const [request, setRequest] = useState<MessagingApprovalRequest | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [error, setError] = useState("");
  const settled = useRef(new Map<string, number>());
  useEffect(() => {
    let active = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      const current = Date.now();
      setClock(current);
      for (const [id, expiry] of settled.current) if (expiry <= current) settled.current.delete(id);
      try {
        const items = await host.pending();
        const eligible = items.filter(
          (item) =>
            Number.isFinite(Date.parse(item.expiresAt)) &&
            Date.parse(item.expiresAt) > current &&
            !settled.current.has(item.confirmationId),
        );
        if (active)
          setRequest((previous) => {
            const next =
              eligible.find((item) => item.confirmationId === previous?.confirmationId) ?? eligible[0] ?? null;
            return next?.confirmationId === previous?.confirmationId ? previous : next;
          });
      } catch {
        // No authority is granted by a failed poll; the host rechecks expiry.
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      setClock(Date.now());
      void poll();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [host]);
  useEffect(() => {
    setAcknowledged(false);
    setSearch("");
    setPage(0);
  }, [request?.confirmationId]);
  const expired = request !== null && Date.parse(request.expiresAt) <= clock;
  useEffect(() => {
    if (!request || !expired) return;
    const id = request.confirmationId;
    settled.current.set(id, Date.parse(request.expiresAt));
    setRequest(null);
    setError("검토 시간이 만료됐어요. 메시지 도구에서 다시 미리보기 해 주세요. 등록하지 않았어요.");
    void host.resolve({ confirmationId: id, allow: false }).catch(() => {});
  }, [expired, host, request]);
  const resolve = async (allow: boolean) => {
    if (!request || settled.current.has(request.confirmationId)) return;
    const permitted =
      allow &&
      acknowledged &&
      Date.parse(request.expiresAt) > Date.now() &&
      request.preview.length > 0 &&
      !request.preview.some((item) => item.retryLocked);
    const id = request.confirmationId;
    settled.current.set(id, Date.parse(request.expiresAt));
    setRequest(null);
    try {
      await host.resolve({ confirmationId: id, allow: permitted });
    } catch {
      setError("등록 확인을 처리하지 못했어요. 메시지 도구의 상태를 확인해 주세요. 자동으로 다시 등록하지 않아요.");
    }
  };
  const needle = search.trim().toLocaleLowerCase();
  const available =
    request?.preview
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !needle ||
          [
            item.message.title ?? "",
            item.message.body,
            item.message.scheduledAt,
            ...item.recipientLabels,
            ...item.attachmentLabels,
          ].some((value) => value.toLocaleLowerCase().includes(needle)),
      ) ?? [];
  const safePage = Math.min(page, Math.max(0, Math.ceil(available.length / PAGE_SIZE) - 1));
  const seconds = request ? Math.max(0, Math.ceil((Date.parse(request.expiresAt) - clock) / 1000)) : 0;
  return (
    <>
      {error && <InfoBar severity="warning" title="예약 등록 확인" message={error} onClose={() => setError("")} />}
      {request && (
        <ContentDialog
          open
          title={`${request.moduleName} 예약 등록 확인`}
          closeButtonText="등록하지 않기"
          {...(acknowledged &&
          !expired &&
          request.preview.length > 0 &&
          !request.preview.some((item) => item.retryLocked)
            ? { primaryButtonText: `${request.preview.length}건 예약 등록` }
            : {})}
          onClose={(result) => {
            void resolve(result === "primary");
          }}
        >
          <div className={s.review} role="group" aria-label="예약 등록 검토 내용" tabIndex={0}>
            <Body>
              변환·분석은 PC 안에서 처리합니다. 쿨메신저 예약 등록은 아래 수신자·내용·첨부를 로그인한 쿨메신저로
              전달합니다.
            </Body>
            <InfoBar
              severity="warning"
              title="등록 뒤 자동 재시도하지 않아요"
              message="정상 결과는 등록 요청 완료이며 수신함 도착 확인이 아니에요. 중지는 이미 접수된 예약을 취소하지 않아요."
            />
            <Caption>
              총 {request.preview.length}건 · 검토 남은 시간 {Math.floor(seconds / 60)}분 {seconds % 60}초
            </Caption>
            {request.preview.length > PAGE_SIZE && (
              <TextBox
                header="수신자·내용·시각·첨부 찾기"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(0);
                }}
              />
            )}
            <div className={s.actions}>
              <Caption>
                {available.length}건 중 {available.length ? safePage * PAGE_SIZE + 1 : 0}~
                {Math.min(available.length, (safePage + 1) * PAGE_SIZE)} 표시
              </Caption>
              {available.length > PAGE_SIZE && (
                <>
                  <Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                    앞 10건
                  </Button>
                  <Button
                    disabled={(safePage + 1) * PAGE_SIZE >= available.length}
                    onClick={() => setPage(safePage + 1)}
                  >
                    다음 10건
                  </Button>
                </>
              )}
            </div>
            {available.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE).map(({ item, index }) => (
              <section key={item.message.id} className={s.message} aria-label={`예약 메시지 ${index + 1}`}>
                <Body>
                  <strong>
                    {index + 1}. {item.message.title || "제목 없음"}
                  </strong>
                </Body>
                <Body>받는 사람: {item.recipientLabels.join(" · ")}</Body>
                <Body>예약 시각: {item.message.scheduledAt.replace("T", " ")} (한국 시간)</Body>
                <Body className={s.body}>{item.message.body}</Body>
                <Body>첨부: {item.attachmentLabels.length ? item.attachmentLabels.join(" · ") : "없음"}</Body>
                {item.retryLocked && (
                  <InfoBar
                    severity="error"
                    title="다시 등록할 수 없는 메시지"
                    message="이전 제출 기록을 먼저 쿨메신저에서 확인해 주세요."
                  />
                )}
              </section>
            ))}
            {available.length === 0 && (
              <Body>검색에 맞는 메시지가 없어요. 검색어를 지우면 전체 검토 목록을 볼 수 있어요.</Body>
            )}
            <CheckBox
              checked={acknowledged}
              onChange={setAcknowledged}
              content={`전체 ${request.preview.length}건의 수신자·내용·시각·첨부를 확인했고 쿨메신저에 전달하는 데 동의해요.`}
            />
          </div>
        </ContentDialog>
      )}
    </>
  );
}
