// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeckProvider } from "@deck/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchoolData } from "./SchoolData.tsx";
import { SchoolDataAccess } from "./SchoolDataAccess.tsx";
import { emptyDocument, type SchoolDataHost } from "./school-data-model.ts";
vi.stubGlobal("crypto", webcrypto);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function host(): SchoolDataHost {
  let d = emptyDocument();
  return {
    load: vi.fn(async () => structuredClone(d)),
    save: vi.fn(async (args) => {
      d = { ...args.document, revision: d.revision + 1 };
      return structuredClone(d);
    }),
    pending: vi.fn(async () => []),
    resolveAccess: vi.fn(async () => {}),
    grants: vi.fn(async () => []),
    revokeGrant: vi.fn(async () => {}),
    importPhoto: vi.fn(async () => d),
    readBackup: vi.fn(async () => null),
    recover: vi.fn(async (args) => args.document),
    readWorkbook: vi.fn(async () => null),
    writeWorkbook: vi.fn(async () => false),
  };
}
describe("trusted school data screens", () => {
  it("starts with semester input and adds multiple classes as a saved roster", async () => {
    const api = host();
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    const button = await screen.findByRole("button", { name: "새 학기 추가" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    const roster = await screen.findByLabelText("학급 명부 입력");
    fireEvent.change(roster, { target: { value: "1,1,1,합성가\n1,2,1,합성가" } });
    fireEvent.click(screen.getByRole("button", { name: "명부 추가" }));
    await screen.findByText("1-1-1 · 합성가 · 재학");
    expect(screen.getByText("1-2-1 · 합성가 · 재학")).toBeTruthy();
    expect(api.save).toHaveBeenCalledTimes(2);
    expect((await api.load()).contexts).toHaveLength(2);
  });
  it("blocked loading preserves storage until the teacher confirms a selected recovery", async () => {
    const api = host(),
      backup = emptyDocument();
    backup.semesters.push({
      id: "restored",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    vi.mocked(api.load).mockRejectedValue(new Error("opaque"));
    vi.mocked(api.readBackup).mockResolvedValue(backup);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "복구할 학교 자료 JSON 선택" }));
    const dialog = await screen.findByRole("dialog", { name: "선택한 학교 자료로 복구할까요?" });
    expect(api.recover).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "자료 확인 후 복구" }));
    await waitFor(() => expect(api.recover).toHaveBeenCalledWith({ expectedRevision: 0, document: backup }));
    await screen.findByText("손상본을 별도 보존한 뒤 학교 자료를 복구했어요. 도구별 허용은 다시 선택해 주세요.");
  });
  it("requires explicit context selection and sends only requested scopes from trusted UI", async () => {
    const api = host();
    vi.mocked(api.pending).mockResolvedValue([
      {
        requestId: "request",
        moduleId: "presenter-picker",
        moduleName: "합성 도구",
        requested: { kinds: ["homeroom"], scopes: ["roster-basic"], remember: true },
        contexts: [
          { contextId: "context", semesterId: "sem", kind: "homeroom", label: "합성 1반", memberCount: 2, revision: 3 },
        ],
      },
    ]);
    render(
      <DeckProvider>
        <SchoolDataAccess host={api} />
      </DeckProvider>,
    );
    const dialog = await screen.findByRole("dialog", { name: "합성 도구에 학교 자료 허용" });
    expect(within(dialog).queryByRole("button", { name: "선택한 자료 허용" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "합성 1반 · 2명" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "다음 실행에도 이 도구에서 사용" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "선택한 자료 허용" }));
    await waitFor(() =>
      expect(api.resolveAccess).toHaveBeenCalledWith({
        requestId: "request",
        allow: true,
        contextIds: ["context"],
        scopes: ["roster-basic"],
        remember: true,
      }),
    );
  });
  it("native XLSX cancellation and preview cancellation preserve data; only confirmation applies roster", async () => {
    const api = host(),
      d = emptyDocument();
    d.semesters.push({
      id: "sem",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    vi.mocked(api.load).mockResolvedValue(d);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    const button = await screen.findByRole("button", { name: "XLSX 명부 가져오기" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(api.readWorkbook).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(api.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    const cell = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
    vi.mocked(api.readWorkbook).mockResolvedValue({
      photoCount: 0,
      parts: {
        "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row>${cell("A1", "학년")}${cell("B1", "반")}${cell("C1", "번호")}${cell("D1", "이름")}</row><row>${cell("A2", "1")}${cell("B2", "2")}${cell("C2", "1")}${cell("D2", "합성가")}</row></sheetData></worksheet>`,
      },
    });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "XLSX 학생 명부 확인" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(button);
    const nextDialog = await screen.findByRole("dialog", { name: "XLSX 학생 명부 확인" });
    fireEvent.click(within(nextDialog).getByRole("button", { name: "확인한 자료 적용" }));
    await screen.findByText("1-2-1 · 합성가 · 재학");
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});
