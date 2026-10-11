// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { Deck } from "@deck/sdk";
import { Body, Button, InfoBar, PageHeader, makeStyles, tokens } from "@deck/ui";
import { useRef, useState } from "react";
import { pickMeeting } from "./files.ts";
import { emptyMeeting } from "./meeting.ts";
import { recoverMeetingStorage, saveRecoveryBackup, type RecoveryBackup } from "./recovery.ts";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  actions: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalS },
});
export function Recovery({ deck, canContinue, onRetry }: { deck: Deck; canContinue: boolean; onRetry: () => void }) {
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [backup, setBackup] = useState<RecoveryBackup | null>(null);
  const [messageError, setMessageError] = useState(false);
  const task = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setMessageError(false);
    try {
      await action();
    } catch {
      setMessageError(true);
      setMessage(
        "복구하지 못했어요. 저장 공간과 백업 파일을 확인한 뒤 다시 시도해 주세요. 기존 자료는 보존되어 있어요.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <div className={s.page}>
      <PageHeader
        title="회의록 복구"
        description="저장된 자료 일부를 읽지 못했어요. 다시 읽거나 백업으로 복구할 수 있어요."
      />
      <Body>복구를 시작하면 현재 저장 자료의 사본을 먼저 보관해요. 기존 지난 회의 파일은 삭제하지 않아요.</Body>
      {message && <InfoBar severity={messageError ? "error" : "informational"} message={message} />}
      <div className={s.actions}>
        <Button disabled={busy} onClick={onRetry}>
          다시 읽기
        </Button>
        <Button
          disabled={busy}
          appearance="primary"
          onClick={() =>
            void task(async () => {
              await recoverMeetingStorage(deck, canContinue ? undefined : emptyMeeting(), backup);
              onRetry();
            })
          }
        >
          {canContinue ? "현재 회의 계속하기" : "자료를 보관하고 새 회의 시작"}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void task(async () => {
              const meeting = await pickMeeting(deck);
              if (!meeting) return;
              await recoverMeetingStorage(deck, meeting, backup);
              onRetry();
            })
          }
        >
          백업(.json)으로 복구
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void task(async () => {
              setBackup(null);
              const saved = await saveRecoveryBackup(deck);
              if (!saved) return;
              setBackup(saved);
              setMessage("복구 자료 사본을 새 폴더에 저장했어요. 이제 현재 회의를 계속하거나 백업으로 복구해 주세요.");
            })
          }
        >
          복구 자료 사본 저장
        </Button>
      </div>
    </div>
  );
}
