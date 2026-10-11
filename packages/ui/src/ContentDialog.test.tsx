// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, ContentDialog, DeckProvider, type ContentDialogResult } from "./index.ts";

afterEach(cleanup);

function ConditionalDialog({ onClose }: { onClose: (result: ContentDialogResult) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DeckProvider>
      <Button onClick={() => setOpen(true)}>확인 열기</Button>
      {open && (
        <ContentDialog
          open
          title="합성 확인"
          primaryButtonText="적용"
          secondaryButtonText="다른 선택"
          closeButtonText="취소"
          onClose={(result) => {
            setOpen(false);
            onClose(result);
          }}
        >
          합성 자료를 확인해요.
        </ContentDialog>
      )}
    </DeckProvider>
  );
}

describe("ContentDialog accessibility lifetime", () => {
  it("restores the accessible background when its last conditional dialog closes and reopens", async () => {
    const closed = vi.fn();
    const { container } = render(<ConditionalDialog onClose={closed} />);
    for (const action of ["취소", "적용", "다른 선택", "Escape"]) {
      fireEvent.click(screen.getByRole("button", { name: "확인 열기" }));
      const dialog = await screen.findByRole("dialog", { name: "합성 확인" });
      // jsdom has no layout or real pointer focus. Wait for Tabster's DOM observer to
      // register the surface, then focus its action as a browser pointer click does.
      await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
      (dialog.querySelector("button") as HTMLButtonElement).focus();
      await waitFor(() => expect(container.getAttribute("aria-hidden")).toBe("true"));
      if (action === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else fireEvent.click(within(dialog).getByRole("button", { name: action }));
      await waitFor(() => expect(container.hasAttribute("aria-hidden")).toBe(false));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("button", { name: "확인 열기" })).toBeTruthy();
    }
    expect(closed.mock.calls).toEqual([["none"], ["primary"], ["secondary"], ["none"]]);
  });
});
