// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { useEffect, useState } from "react";
import type { SchoolAccessRequest, SchoolScope } from "@deck/sdk";
import { Body, Button, Caption, CheckBox, ContentDialog, InfoBar, TextBox, deckTokens, makeStyles } from "@deck/ui";
import type { SchoolDataHost } from "./school-data-model.ts";
const scopeLabels: Record<SchoolScope, string> = {
  "roster-basic": "이름·학년·반·번호",
  photos: "학생 사진",
  timetable: "허용한 학급·수업의 시간표",
};
const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap, maxHeight: "50vh", overflowY: "auto" },
});
/** Mounted in the trusted shell; module text never supplies owner identity or permission. */
export function SchoolDataAccess({ host }: { host: SchoolDataHost }) {
  const s = useStyles(),
    [request, setRequest] = useState<SchoolAccessRequest | null>(null),
    [contexts, setContexts] = useState<string[]>([]),
    [scopes, setScopes] = useState<SchoolScope[]>([]),
    [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(0);
  const available = request?.contexts.filter((c) => !search || c.label.includes(search)) ?? [],
    safePage = Math.min(page, Math.max(0, Math.ceil(available.length / 50) - 1));
  useEffect(() => {
    let active = true,
      running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const items = await host.pending();
        if (active)
          setRequest((previous) => {
            const next = (previous && items.find((r) => r.requestId === previous.requestId)) || items[0] || null;
            return previous?.requestId === next?.requestId ? previous : next;
          });
      } catch {
        /* A failed poll grants no authority. A later poll can recover. */
      } finally {
        running = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [host]);
  useEffect(() => {
    setContexts([]);
    setScopes(request?.requested.scopes.includes("roster-basic") ? ["roster-basic"] : []);
    setRemember(false);
    setError("");
    setSearch("");
    setPage(0);
  }, [request?.requestId]);
  const resolve = async (allow: boolean) => {
    if (!request || busy) return;
    if (
      allow &&
      (!contexts.length || !scopes.length || (scopes.includes("photos") && !scopes.includes("roster-basic")))
    ) {
      setError("학급·수업과 허용할 항목을 선택해 주세요. 사진에는 명부 허용도 필요해요.");
      return;
    }
    setBusy(true);
    try {
      await host.resolveAccess({
        requestId: request.requestId,
        allow,
        contextIds: allow ? contexts : [],
        scopes: allow ? scopes : [],
        remember: allow && remember,
      });
      setRequest(null);
    } catch {
      setError("허용 요청을 처리하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ContentDialog
      open={request !== null}
      title={`${request?.moduleName ?? "도구"}에 학교 자료 허용`}
      {...(busy || !contexts.length || !scopes.length ? {} : { primaryButtonText: "선택한 자료 허용" })}
      closeButtonText="허용하지 않기"
      onClose={(result) => {
        void resolve(result === "primary");
      }}
    >
      <div className={s.list}>
        <Body>이 도구에서 사용할 학급·수업과 자료만 골라 주세요. 설정에서 언제든 허용을 철회할 수 있어요.</Body>
        {request?.contexts.length === 0 && (
          <InfoBar
            severity="informational"
            title="학교 자료가 없어요"
            message="설정의 ‘우리 반·수업 자료’에서 학기와 명부를 먼저 추가해 주세요."
          />
        )}
        {available.length > 50 || search ? (
          <>
            <TextBox
              header="허용할 학급·수업 찾기"
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
            />
            <Caption>
              {available.length}개 중 {safePage * 50 + 1}~{Math.min(available.length, (safePage + 1) * 50)} 표시 ·{" "}
              {contexts.length}개 선택
            </Caption>
            <Button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              이전 학급·수업
            </Button>
            <Button disabled={(safePage + 1) * 50 >= available.length} onClick={() => setPage(safePage + 1)}>
              다음 학급·수업
            </Button>
          </>
        ) : null}
        {available.slice(safePage * 50, safePage * 50 + 50).map((c) => (
          <CheckBox
            key={c.contextId}
            content={`${c.label} · ${c.memberCount}명`}
            checked={contexts.includes(c.contextId)}
            onChange={(checked) =>
              setContexts((ids) => (checked ? [...ids, c.contextId] : ids.filter((id) => id !== c.contextId)))
            }
          />
        ))}
        {request?.requested.scopes.map((scope) => (
          <CheckBox
            key={scope}
            content={scopeLabels[scope]}
            checked={scopes.includes(scope)}
            onChange={(checked) =>
              setScopes((values) => (checked ? [...values, scope] : values.filter((v) => v !== scope)))
            }
          />
        ))}
        {request?.requested.remember && (
          <CheckBox content="다음 실행에도 이 도구에서 사용" checked={remember} onChange={setRemember} />
        )}
        {error && <InfoBar severity="error" title="선택 확인" message={error} />}
      </div>
    </ContentDialog>
  );
}
