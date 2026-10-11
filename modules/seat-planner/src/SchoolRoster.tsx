// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck, SchoolAccessGrant, SchoolContextSummary, SchoolRosterSnapshot } from "@deck/sdk";
import { Body, Button, CheckBox, ComboBox, InfoBar, SettingsExpander, deckTokens, makeStyles } from "@deck/ui";
import { useEffect, useRef, useState } from "react";
import { linkedStudents, type LinkedStudent } from "./school-roster.ts";

const useStyles = makeStyles({ body: { display: "flex", flexDirection: "column", gap: deckTokens.itemGap }, row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: deckTokens.inlineGap } });
interface Props {
  deck: Deck;
  disabled: boolean;
  hasRoster: boolean;
  previous: readonly { id: string; baseCount?: number }[];
  onApply(snapshot: SchoolRosterSnapshot, students: LinkedStudent[]): Promise<boolean>;
}
export function SchoolRoster({ deck, disabled, hasRoster, previous, onApply }: Props) {
  const s = useStyles();
  const available = deck.has("school-data");
  const [shared, setShared] = useState(true);
  const [grants, setGrants] = useState<SchoolAccessGrant[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (available) void deck.schoolData.status().then((status) => {
      if (alive.current) setGrants(status.grants);
    }).catch(() => { if (alive.current) setError("공통 명부 연결 상태를 읽지 못했어요. 다시 연결하거나 직접 입력할 수 있어요."); });
    return () => { alive.current = false; };
  }, [deck, available]);
  if (!available) return null;
  const contexts = new Map<string, { grant: SchoolAccessGrant; context: SchoolContextSummary }>();
  for (const grant of grants.filter((g) => g.scopes.includes("roster-basic")))
    for (const context of grant.contexts) contexts.set(context.contextId, { grant, context });
  const selected = contexts.get(choice) ?? contexts.values().next().value;
  async function run(action: () => Promise<void>) {
    if (busy || disabled) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch { if (alive.current) setError("명부를 불러오지 못했어요. 공유 권한이나 공통 자료 변경을 확인하고 다시 시도해 주세요. 현재 작업은 유지돼요."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <SettingsExpander header="공통 명부 불러오기" description={hasRoster ? "현재 작업을 유지하면서 필요한 때 명부를 갱신해요." : "설정에 등록한 우리 반·수업 명부를 바로 불러올 수 있어요."} defaultExpanded={!hasRoster}>
    <div className={s.body}>
      <CheckBox checked={shared} onChange={setShared} disabled={busy || disabled} content="공통 명부 사용" />
      {!shared ? <Body>아래에서 이번 작업 명단을 직접 입력해요. 공통 자료에 등록되지 않아요.</Body> : <>
        <div className={s.row}>
          {contexts.size > 0 && <ComboBox header="불러올 학급·수업" value={selected?.context.contextId ?? ""} disabled={busy || disabled}
            options={[...contexts.values()].map(({ context }) => ({ value: context.contextId, label: `${context.label} · ${context.memberCount}명` }))} onChange={setChoice} />}
          <Button disabled={busy || disabled} onClick={() => void run(async () => {
            const grant = await deck.schoolData.requestAccess({ kinds: ["homeroom", "division"], scopes: ["roster-basic"], remember: true });
            if (grant && alive.current) { setGrants((old) => [...old.filter((g) => g.grantHandle !== grant.grantHandle), grant]); setChoice(grant.contexts[0]?.contextId ?? ""); }
          })}>{contexts.size ? "공유 학급 변경" : "학급 연결"}</Button>
          {selected && <Button appearance="primary" disabled={busy || disabled} onClick={() => void run(async () => {
            const snapshot = await deck.schoolData.readRoster({ grantHandle: selected.grant.grantHandle, contextId: selected.context.contextId, expectedRevision: null });
            const students = await linkedStudents(snapshot, previous);
            if (alive.current && await onApply(snapshot, students)) setMessage(`${snapshot.context.label}의 재학 학생 ${students.length}명을 불러왔어요.`);
          })}>{busy ? "불러오는 중" : "이 명부 불러오기"}</Button>}
        </div>
        {contexts.size === 0 && <Body>등록한 명부가 없다면 티처덱 설정 → 우리 반·수업 자료에서 먼저 등록해 주세요. 직접 입력도 계속 사용할 수 있어요.</Body>}
        <Body>같은 학생의 기존 기록은 유지해요. 여러 반이 섞인 수업은 학년·반·번호를 합친 여섯 자리 번호로 구분해요.</Body>
      </>}
      {message && <InfoBar severity="success" message={message} />}
      {error && <InfoBar severity="error" message={error} />}
    </div>
  </SettingsExpander>;
}
