// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeckProvider } from "@deck/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchoolPortability } from "./SchoolPortability.tsx";
import { emptyDocument, type SchoolDataHost } from "./school-data-model.ts";
import type { TimeAlertPreview } from "../generated/TimeAlertPreview.ts";
afterEach(cleanup);
type Host = Pick<
  SchoolDataHost,
  "openTimeAlert" | "applyTimeAlert" | "exportTimeAlert" | "closeTimeAlert" | "importRosterPhotos"
>;
function setup() {
  const document = emptyDocument();
  document.revision = 3;
  document.semesters.push({
    id: "sem",
    academicYear: 2026,
    term: 1,
    startDate: "2026-03-01",
    endDate: "2026-07-31",
    archived: false,
    readOnly: false,
  });
  const preview: TimeAlertPreview = {
    sessionHandle: "synthetic-backup",
    schemaVersion: 7,
    photoCount: 2,
    tables: [],
    warnings: ["합성 비공개 표 보존 안내"],
    document: emptyDocument(),
  };
  preview.document.students.push({ id: "imported-student", name: "합성동명", photoId: null });
  document.students.push({ id: "existing-student", name: "합성동명", photoId: null });
  const api: Host = {
    openTimeAlert: vi.fn(async () => preview),
    applyTimeAlert: vi.fn(async () => ({ ...document, revision: 4 })),
    exportTimeAlert: vi.fn(async () => false),
    closeTimeAlert: vi.fn(async () => {}),
    importRosterPhotos: vi.fn(async () => null),
  };
  const onSaved = vi.fn();
  const view = render(
    <DeckProvider>
      <SchoolPortability
        host={api}
        document={document}
        semesterId="sem"
        busy={false}
        onBusy={vi.fn()}
        onSaved={onSaved}
      />
    </DeckProvider>,
  );
  fireEvent.click(screen.getByText("사진 포함 이동·TimeAlert 백업"));
  return { api, onSaved, view, preview };
}
async function dialog(title: string, label: string) {
  const found = await screen.findByRole("dialog", { name: title });
  await waitFor(() => expect(found.querySelector("[data-tabster-dummy]")).toBeTruthy());
  // A resolved host mock can open the next surface before the preceding one finishes
  // closing. Give Tabster the actual input focus that browser modal entry establishes
  // before querying actions through the accessibility tree.
  const focus = within(found).getByLabelText(label);
  focus.focus();
  expect(document.activeElement).toBe(focus);
  await within(found).findByRole("button", { name: "취소" });
  expect(found.hasAttribute("aria-hidden")).toBe(false);
  return found;
}
async function openPreview() {
  const trigger = await screen.findByRole("button", { name: "TimeAlert 백업 가져오기" });
  trigger.focus();
  fireEvent.click(trigger);
  const password = await dialog("TimeAlert 백업 암호", "백업 암호");
  fireEvent.change(within(password).getByLabelText("백업 암호"), { target: { value: "합성 암호" } });
  fireEvent.click(await within(password).findByRole("button", { name: "파일 선택·확인" }));
  return dialog("TimeAlert 명부·시간표 확인", "기존 학생 찾기 · 이름 또는 학적");
}
describe("trusted TimeAlert portability review", () => {
  it("preview cancellation closes the private session without saving or auto-merging same names", async () => {
    const { api, onSaved } = setup();
    const review = await openPreview();
    expect(vi.mocked(api.applyTimeAlert)).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(api.closeTimeAlert).toHaveBeenCalledWith({ sessionHandle: "synthetic-backup" }));
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("only confirmed apply uses current revision and explicit links, preserving saved source until success", async () => {
    const { api, onSaved } = setup();
    const review = await openPreview();
    fireEvent.click(await within(review).findByRole("button", { name: "확인한 자료 추가" }));
    await waitFor(() =>
      expect(api.applyTimeAlert).toHaveBeenCalledWith({
        sessionHandle: "synthetic-backup",
        expectedRevision: 3,
        studentLinks: [],
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ revision: 4 }));
    expect(api.closeTimeAlert).not.toHaveBeenCalled();
  });
  it("new backup requires matching passwords and a cancelled output never reports success", async () => {
    const { api, onSaved } = setup();
    const trigger = await screen.findByRole("button", { name: "사진 포함 백업 저장" });
    trigger.focus();
    fireEvent.click(trigger);
    const password = await dialog("사진 포함 백업에 암호 설정", "백업 암호");
    fireEvent.change(within(password).getByLabelText("백업 암호"), { target: { value: "합성 암호" } });
    fireEvent.change(within(password).getByLabelText("백업 암호 다시 입력"), { target: { value: "다른 암호" } });
    expect(within(password).queryByRole("button", { name: "새 백업 저장" })).toBeNull();
    fireEvent.change(within(password).getByLabelText("백업 암호 다시 입력"), { target: { value: "합성 암호" } });
    fireEvent.click(await within(password).findByRole("button", { name: "새 백업 저장" }));
    await waitFor(() =>
      expect(api.exportTimeAlert).toHaveBeenCalledWith({
        sessionHandle: null,
        expectedRevision: 3,
        password: "합성 암호",
      }),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("사진을 포함한 새 백업을 저장했어요. 원본 파일은 유지돼요.")).toBeNull();
  });
  it("late backup-picker success after unmount closes its new private handle without applying", async () => {
    const { api, onSaved, view, preview } = setup();
    let complete!: (value: TimeAlertPreview) => void;
    vi.mocked(api.openTimeAlert).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const trigger = await screen.findByRole("button", { name: "TimeAlert 백업 가져오기" });
    trigger.focus();
    fireEvent.click(trigger);
    const password = await dialog("TimeAlert 백업 암호", "백업 암호");
    fireEvent.change(within(password).getByLabelText("백업 암호"), { target: { value: "합성 암호" } });
    fireEvent.click(await within(password).findByRole("button", { name: "파일 선택·확인" }));
    await waitFor(() => expect(api.openTimeAlert).toHaveBeenCalledOnce());
    view.unmount();
    expect(api.closeTimeAlert).not.toHaveBeenCalled();
    complete(preview);
    await waitFor(() => expect(api.closeTimeAlert).toHaveBeenCalledWith({ sessionHandle: preview.sessionHandle }));
    expect(api.applyTimeAlert).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
  it("late photo-picker success after unmount closes its private photo session", async () => {
    const { api, onSaved, view } = setup();
    let complete!: (value: Awaited<ReturnType<Host["importRosterPhotos"]>>) => void;
    vi.mocked(api.importRosterPhotos).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const trigger = await screen.findByRole("button", { name: "사진명렬표 명부·사진 가져오기" });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(api.importRosterPhotos).toHaveBeenCalledOnce());
    view.unmount();
    complete({
      sessionHandle: "late-photo-session",
      expectedRevision: 3,
      workbook: { parts: {}, photoCount: 0 },
      photoKeys: [],
      document: null,
    });
    await waitFor(() => expect(api.closeTimeAlert).toHaveBeenCalledWith({ sessionHandle: "late-photo-session" }));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
