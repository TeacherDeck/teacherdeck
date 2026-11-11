// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { Body, ContentDialog } from "@deck/ui";
import type { DocumentDecision, DocumentPrompt } from "./bridge/documentProtection.ts";

/** The main shell alone asks about destruction of a protected module document. */
export function DocumentConfirmation({
  prompt,
  moduleName,
  decide,
}: {
  prompt: DocumentPrompt | null;
  moduleName: string;
  decide(decision: DocumentDecision): void;
}) {
  if (prompt === null) return null;
  const saving = prompt.state.saving;
  return (
    <ContentDialog
      open
      title={saving ? "작업을 저장하고 있어요" : "작업을 저장할까요?"}
      {...(!saving ? { primaryButtonText: "저장", secondaryButtonText: "버리기" } : {})}
      closeButtonText="취소"
      defaultButton="close"
      onClose={(result) => decide(result === "primary" ? "save" : result === "secondary" ? "discard" : "cancel")}
    >
      <Body>
        {saving
          ? `${moduleName}의 작업을 저장하고 있어요. 취소하면 이 화면을 유지하며 저장은 계속해요.`
          : `${moduleName}에 저장하지 않은 작업이 있어요.`}
      </Body>
    </ContentDialog>
  );
}
