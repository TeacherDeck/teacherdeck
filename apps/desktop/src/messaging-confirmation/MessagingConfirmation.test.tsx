// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeckProvider } from "@deck/ui";
import type { MessagingApprovalRequest } from "@deck/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagingConfirmation, type MessagingConfirmationHost } from "./MessagingConfirmation.tsx";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function request(count = 1): MessagingApprovalRequest {
  return {
    confirmationId: "opaque-one-shot",
    moduleId: "coolreserve",
    moduleName: "합성 메시지",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    preview: Array.from({ length: count }, (_, i) => ({
      message: {
        id: `synthetic-${i}`,
        recipients: ["opaque-recipient"],
        title: i === 0 ? null : `합성 제목 ${i + 1}`,
        body: `합성 본문 ${i + 1}\n둘째 줄·끝까지 확인`,
        scheduledAt: "2026-11-01T12:00",
        attachmentHandles: ["opaque-file"],
        contentRevision: 1,
      },
      recipientLabels: [`합성 수신자 ${i + 1} · 계정 90001`],
      attachmentLabels: [`합성첨부${i + 1}.txt`],
      retryLocked: false,
    })),
  };
}
function mount(item: MessagingApprovalRequest) {
  const host: MessagingConfirmationHost = { pending: vi.fn(async () => [item]), resolve: vi.fn(async () => {}) };
  render(
    <DeckProvider>
      <MessagingConfirmation host={host} />
    </DeckProvider>,
  );
  return host;
}
describe("trusted registration review", () => {
  it("shows all fields and sends one approval only after explicit acknowledgement", async () => {
    const host = mount(request());
    const dialog = await screen.findByRole("dialog", { name: "합성 메시지 예약 등록 확인" });
    const section = within(dialog).getByRole("region", { name: "예약 메시지 1" });
    expect(within(section).getByText(/제목 없음/)).toBeTruthy();
    expect(within(section).getByText(/합성 수신자 1/)).toBeTruthy();
    expect(within(section).getByText(/2026-11-01 12:00/)).toBeTruthy();
    expect(within(section).getByText(/둘째 줄·끝까지 확인/)).toBeTruthy();
    expect(within(section).getByText(/합성첨부1.txt/)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "1건 예약 등록" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "1건 예약 등록" }));
    await waitFor(() =>
      expect(host.resolve).toHaveBeenCalledExactlyOnceWith({ confirmationId: "opaque-one-shot", allow: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("cancel never authorizes a run and locked plans cannot be accepted", async () => {
    const item = request();
    const first = item.preview[0];
    if (!first) throw new Error("synthetic fixture missing");
    first.retryLocked = true;
    const host = mount(item);
    const dialog = await screen.findByRole("dialog", { name: "합성 메시지 예약 등록 확인" });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).queryByRole("button", { name: "1건 예약 등록" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "등록하지 않기" }));
    await waitFor(() =>
      expect(host.resolve).toHaveBeenCalledExactlyOnceWith({ confirmationId: "opaque-one-shot", allow: false }),
    );
  });
  it("keeps 500 full previews searchable with a bounded visible list", async () => {
    const host = mount(request(500));
    const dialog = await screen.findByRole("dialog", { name: "합성 메시지 예약 등록 확인" });
    expect(within(dialog).getAllByRole("region").length).toBe(10);
    const input = within(dialog).getByRole("textbox", { name: "수신자·내용·시각·첨부 찾기" });
    fireEvent.change(input, { target: { value: "합성 본문 500" } });
    const last = within(dialog).getByRole("region", { name: "예약 메시지 500" });
    expect(within(last).getByText(/둘째 줄·끝까지 확인/)).toBeTruthy();
    expect(within(last).getByText(/합성첨부500.txt/)).toBeTruthy();
    expect(host.resolve).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("button", { name: "500건 예약 등록" })).toBeNull();
  });
  it("does not open an expired host request", async () => {
    const item = request();
    item.expiresAt = new Date(Date.now() - 1).toISOString();
    const host = mount(item);
    await waitFor(() => expect(host.pending).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(host.resolve).not.toHaveBeenCalled();
  });
});
