// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DeckProvider } from "@deck/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchoolData } from "./SchoolData.tsx";
import { renderTimetablePng } from "./school-timetable-image.ts";
vi.mock("./school-timetable-image.ts", () => ({ renderTimetablePng: vi.fn() }));
import { SchoolDataAccess } from "./SchoolDataAccess.tsx";
import { emptyDocument, appendRoster, type SchoolDataHost } from "./school-data-model.ts";
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
    exportBackup: vi.fn(async () => false),
    exportTimetableImage: vi.fn(async () => false),
    readBackup: vi.fn(async () => null),
    recover: vi.fn(async (args) => args.document),
    readWorkbook: vi.fn(async () => null),
    writeWorkbook: vi.fn(async () => false),
    openTimeAlert: vi.fn(async () => null),
    applyTimeAlert: vi.fn(async () => d),
    exportTimeAlert: vi.fn(async () => false),
    closeTimeAlert: vi.fn(async () => {}),
    importRosterPhotos: vi.fn(async () => null),
  };
}
async function focusRegisteredDialog(title: string, inputLabel?: string) {
  const dialog = await screen.findByRole("dialog", { name: title });
  await waitFor(() => expect(dialog.querySelector("[data-tabster-dummy]")).toBeTruthy());
  const target = inputLabel ? within(dialog).getByLabelText(inputLabel) : dialog.querySelector("button");
  if (!target) throw new Error("synthetic dialog focus target missing");
  target.focus();
  expect(document.activeElement).toBe(target);
  await within(dialog).findByRole("button", { name: "취소" });
  return dialog;
}
function timetableCell(name: string) {
  // Locate one cell first, then retain the original role/name/visibility check.
  // A document-wide role query computes names for every Fluent grid button.
  const cell = screen.getByLabelText(name, { selector: "button" }).closest("td");
  if (!cell) throw new Error("synthetic timetable cell missing");
  return within(cell).getByRole("button", { name });
}
function timetableControl(role: "button" | "combobox", name: string) {
  // Labels only locate the candidate; the role query still checks its accessible
  // name and visibility through the original DOM, including hidden ancestors.
  const candidate =
    role === "combobox"
      ? screen.getByLabelText(name, { selector: '[role="combobox"]' })
      : screen.getByText(name).closest("button");
  const parent = candidate?.parentElement;
  if (!parent) throw new Error("synthetic timetable control missing");
  const control = within(parent).getByRole(role, { name });
  expect(control).toBe(candidate);
  return control;
}
async function importedWorkbook(kind: "roster" | "timetable" = "roster") {
  const api = host(),
    before = emptyDocument();
  before.semesters.push({
    id: "sem",
    academicYear: 2026,
    term: 1,
    startDate: "2026-03-01",
    endDate: "2026-07-31",
    archived: false,
    readOnly: false,
  });
  vi.mocked(api.load).mockResolvedValue(before);
  const cell = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const rows =
    kind === "roster"
      ? `<row>${cell("A1", "학년")}${cell("B1", "반")}${cell("C1", "번호")}${cell("D1", "이름")}</row><row>${cell("A2", "1")}${cell("B2", "2")}${cell("C2", "1")}${cell("D2", "합성가")}</row>`
      : `<row>${cell("A1", "")}${cell("B1", "월")}</row><row>${cell("A2", "1")}${cell("B2", "합성과학")}</row>`;
  vi.mocked(api.readWorkbook).mockResolvedValue({
    photoCount: 0,
    parts: { "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows}</sheetData></worksheet>` },
  });
  render(
    <DeckProvider>
      <SchoolData host={api} />
    </DeckProvider>,
  );
  if (kind === "timetable") fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
  const trigger = await screen.findByRole("button", {
    name: kind === "roster" ? "XLSX 명부 가져오기" : "XLSX 시간표 가져오기",
  });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await focusRegisteredDialog(
    kind === "roster" ? "XLSX 학생 명부 확인" : "XLSX 주간 시간표 확인",
    "가져온 자료 미리보기",
  );
  fireEvent.click(await within(dialog).findByRole("button", { name: "확인한 자료 적용" }));
  await screen.findByRole("button", { name: "가져오기 되돌리기" });
  return { api, before };
}
async function openWorkbookUndo() {
  const trigger = await screen.findByRole("button", { name: "가져오기 되돌리기" });
  trigger.focus();
  fireEvent.click(trigger);
  return focusRegisteredDialog("최근 XLSX 가져오기를 되돌릴까요?");
}
describe("trusted school data screens", () => {
  it.each(["roster", "timetable"] as const)(
    "restores the exact pre-import %s snapshot only after confirmation",
    async (kind) => {
      const { api, before } = await importedWorkbook(kind);
      if (kind === "timetable") {
        const label = vi.mocked(api.save).mock.calls[0]?.[0].document.timetable.weeklyTables[0]?.label;
        if (!label) throw new Error("synthetic timetable missing");
        fireEvent.click(screen.getByRole("combobox", { name: "시간표 선택" }));
        fireEvent.click(await screen.findByRole("option", { name: label }));
      }
      let dialog = await openWorkbookUndo();
      fireEvent.click(await within(dialog).findByRole("button", { name: "취소" }));
      await waitFor(() => expect(dialog.isConnected).toBe(false));
      expect(api.save).toHaveBeenCalledOnce();
      dialog = await openWorkbookUndo();
      fireEvent.click(await within(dialog).findByRole("button", { name: "가져오기 되돌리기" }));
      await screen.findByText("최근 XLSX 가져오기 전 자료로 되돌렸어요.");
      await waitFor(() => expect(dialog.isConnected).toBe(false));
      await screen.findByRole("button", { name: "다시 불러오기" });
      expect(api.save).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.save).mock.calls[1]?.[0]).toEqual({ expectedRevision: 1, document: before });
      expect(screen.queryByRole("button", { name: "가져오기 되돌리기" })).toBeNull();
      if (kind === "timetable")
        expect(
          ((await screen.findByRole("button", { name: "선택한 시간표 XLSX 내보내기" })) as HTMLButtonElement).disabled,
        ).toBe(true);
    },
  );
  it("keeps an undo snapshot after failure and retries without changing its expected revision", async () => {
    const { api, before } = await importedWorkbook();
    vi.mocked(api.save).mockRejectedValueOnce(new Error("synthetic write failure"));
    let dialog = await openWorkbookUndo();
    fireEvent.click(await within(dialog).findByRole("button", { name: "가져오기 되돌리기" }));
    await screen.findByText(/가져오기를 되돌리지 못했어요/);
    expect(await screen.findByRole("button", { name: "가져오기 되돌리기" })).toBeTruthy();
    dialog = await openWorkbookUndo();
    fireEvent.click(await within(dialog).findByRole("button", { name: "가져오기 되돌리기" }));
    await screen.findByText("최근 XLSX 가져오기 전 자료로 되돌렸어요.");
    expect(
      vi
        .mocked(api.save)
        .mock.calls.slice(1)
        .map(([args]) => args),
    ).toEqual([
      { expectedRevision: 1, document: before },
      { expectedRevision: 1, document: before },
    ]);
  });
  it("retains undo after a failed subsequent save and discards it after a successful save", async () => {
    const { api } = await importedWorkbook();
    fireEvent.change(screen.getByLabelText("학급 명부 입력"), { target: { value: "1,3,1,합성나" } });
    vi.mocked(api.save).mockRejectedValueOnce(new Error("합성 저장 실패"));
    fireEvent.click(screen.getByRole("button", { name: "명부 추가" }));
    await screen.findByText("합성 저장 실패");
    expect(screen.getByRole("button", { name: "가져오기 되돌리기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "명부 추가" }));
    await screen.findByText("1-3-1 · 합성나 · 재학");
    expect(screen.queryByRole("button", { name: "가져오기 되돌리기" })).toBeNull();
  });
  it("preserves an external revision on stale undo and discards undo when reloading that revision", async () => {
    const { api } = await importedWorkbook();
    const imported = vi.mocked(api.save).mock.calls[0]?.[0].document;
    if (!imported || !imported.students[0]) throw new Error("synthetic import missing");
    const external = structuredClone(imported);
    external.revision = 2;
    if (!external.students[0]) throw new Error("synthetic student missing");
    external.students[0].name = "외부합성";
    let current = structuredClone(external);
    vi.mocked(api.save).mockImplementation(async (args) => {
      if (args.expectedRevision !== current.revision) throw new Error("synthetic revision conflict");
      current = { ...structuredClone(args.document), revision: current.revision + 1 };
      return structuredClone(current);
    });
    vi.mocked(api.load).mockImplementation(async () => structuredClone(current));
    const dialog = await openWorkbookUndo();
    fireEvent.click(await within(dialog).findByRole("button", { name: "가져오기 되돌리기" }));
    await screen.findByText(/가져오기를 되돌리지 못했어요/);
    expect(current).toEqual(external);
    expect(vi.mocked(api.save).mock.calls[1]?.[0].expectedRevision).toBe(1);
    fireEvent.click(await screen.findByRole("button", { name: "다시 불러오기" }));
    await screen.findByText("1-2-1 · 외부합성 · 재학");
    expect(screen.queryByRole("button", { name: "가져오기 되돌리기" })).toBeNull();
  });
  it("loads and saves a restored same-name class by ID without reinterpreting its display text", async () => {
    const api = host();
    const seed = emptyDocument();
    seed.semesters.push({
      id: "sem",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    let serial = 0;
    const d = appendRoster(seed, "sem", "1,1,1,합성가\n1,2,1,합성나", () => `id${++serial}`);
    const first = d.contexts[0],
      second = d.contexts[1];
    if (!first || !second) throw new Error("synthetic context missing");
    first.label = second.label = "합성공동";
    d.timetable.weeklyTables.push({
      id: "week",
      semesterId: "sem",
      label: "복구된 합성 표",
      startDate: null,
      endDate: null,
      entries: [{ weekday: 1, period: 1, contextId: second.id }],
    });
    vi.mocked(api.load).mockResolvedValue(d);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
    expect(screen.getByRole("columnheader", { name: /^토/ }).getAttribute("data-day-tone")).toBe("blue");
    expect(screen.getByRole("columnheader", { name: /^일/ }).getAttribute("data-day-tone")).toBe("red");
    expect(screen.getByRole("columnheader", { name: /^월/ }).getAttribute("data-day-tone")).toBe("neutral");
    fireEvent.click(screen.getByRole("combobox", { name: "시간표 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: "복구된 합성 표" }));
    expect((timetableCell("월요일 1교시: 합성공동") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("combobox", { name: "칸에 넣을 수업" }));
    fireEvent.click(await screen.findByRole("option", { name: "합성공동 · 같은 이름 1" }));
    fireEvent.click(timetableCell("화요일 2교시: 빈 칸"));
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    expect(vi.mocked(api.save).mock.calls[0]?.[0].document.timetable.weeklyTables[0]?.entries).toEqual([
      { weekday: 1, period: 1, contextId: second.id },
      { weekday: 2, period: 2, contextId: first.id },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "텍스트로 붙여넣기·수정" }));
    fireEvent.change(screen.getByLabelText("주간 수업 입력"), { target: { value: "월,1,합성공동" } });
    expect(screen.getByText(/수업 이름이 없거나 중복돼요/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    expect(api.save).toHaveBeenCalledOnce();
  });
  it("keeps unsaved grids separate across semesters and table selection, and locks the target during save", async () => {
    const api = host();
    const seed = emptyDocument();
    for (const term of [1, 2])
      seed.semesters.push({
        id: `sem${term}`,
        academicYear: 2026,
        term,
        startDate: `2026-0${term + 2}-01`,
        endDate: "2026-12-31",
        archived: false,
        readOnly: false,
      });
    let serial = 0;
    let d = appendRoster(seed, "sem1", "1,1,1,합성가", () => `id${++serial}`);
    d = appendRoster(d, "sem2", "1,1,1,합성가", () => `id${++serial}`);
    const first = d.contexts.find((context) => context.semesterId === "sem1");
    if (!first) throw new Error("synthetic context missing");
    d.timetable.weeklyTables.push({
      id: "saved",
      semesterId: "sem1",
      label: "다른 합성 표",
      startDate: null,
      endDate: null,
      entries: [{ weekday: 5, period: 3, contextId: first.id }],
    });
    vi.mocked(api.load).mockResolvedValue(d);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
    fireEvent.click(screen.getByRole("combobox", { name: "칸에 넣을 수업" }));
    fireEvent.click(await screen.findByRole("option", { name: "1학년 1반" }));
    fireEvent.click(timetableCell("월요일 1교시: 빈 칸"));
    fireEvent.click(screen.getByRole("combobox", { name: "시간표 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: "다른 합성 표" }));
    expect(timetableCell("금요일 3교시: 1학년 1반")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "시간표 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: "새 시간표" }));
    expect(timetableCell("월요일 1교시: 1학년 1반")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "현재 학기" }));
    fireEvent.click(await screen.findByRole("option", { name: "2026학년도 2학기" }));
    expect(timetableCell("월요일 1교시: 빈 칸")).toBeTruthy();
    expect((screen.getByRole("button", { name: "시간표 저장" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("combobox", { name: "현재 학기" }));
    fireEvent.click(await screen.findByRole("option", { name: "2026학년도 1학기" }));
    expect(timetableCell("월요일 1교시: 1학년 1반")).toBeTruthy();
    let finish: (() => void) | undefined;
    vi.mocked(api.save).mockImplementationOnce(
      (args) =>
        new Promise((resolve) => {
          finish = () => resolve({ ...args.document, revision: 1 });
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    expect((screen.getByRole("combobox", { name: "현재 학기" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("combobox", { name: "시간표 선택" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      vi.mocked(api.save).mock.calls[0]?.[0].document.timetable.weeklyTables.find((table) => table.id !== "saved")
        ?.semesterId,
    ).toBe("sem1");
    if (!finish) throw new Error("synthetic save missing");
    finish();
    await screen.findByText("주간 시간표를 저장했어요.");
  });
  it("reopens a saved grid with a comma in its class label and preserves existing lessons while editing", async () => {
    const api = host();
    const seed = emptyDocument();
    seed.semesters.push({
      id: "sem",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    let serial = 0;
    const d = appendRoster(seed, "sem", "1,1,1,합성가", () => `id${++serial}`);
    const context = d.contexts[0];
    if (!context) throw new Error("synthetic context missing");
    context.label = "합성과학, 심화";
    d.timetable.weeklyTables.push({
      id: "week",
      semesterId: "sem",
      label: "합성 시간표",
      startDate: null,
      endDate: null,
      entries: [{ weekday: 1, period: 1, contextId: context.id }],
    });
    vi.mocked(api.load).mockResolvedValue(d);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
    fireEvent.click(screen.getByRole("combobox", { name: "시간표 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: "합성 시간표" }));
    expect(timetableCell("월요일 1교시: 합성과학, 심화")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "칸에 넣을 수업" }));
    fireEvent.click(await screen.findByRole("option", { name: context.label }));
    fireEvent.click(timetableCell("화요일 2교시: 빈 칸"));
    fireEvent.click(screen.getByRole("button", { name: "시간표 저장" }));
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce());
    expect(vi.mocked(api.save).mock.calls[0]?.[0].document.timetable.weeklyTables[0]?.entries).toEqual([
      { weekday: 1, period: 1, contextId: context.id },
      { weekday: 2, period: 2, contextId: context.id },
    ]);
  });
  it("places one selected class into multiple grid cells, preserves pasted input, and clears the final saved cell", async () => {
    const api = host();
    const seed = emptyDocument();
    seed.semesters.push({
      id: "sem",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    let serial = 0;
    const d = appendRoster(seed, "sem", "1,1,1,합성가", () => `id${++serial}`);
    vi.mocked(api.load).mockResolvedValue(d);
    await act(async () => {
      render(
        <DeckProvider>
          <SchoolData host={api} />
        </DeckProvider>,
      );
    });
    fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
    fireEvent.click(timetableControl("combobox", "칸에 넣을 수업"));
    fireEvent.click(await screen.findByRole("option", { name: "1학년 1반" }));
    fireEvent.click(timetableCell("월요일 1교시: 빈 칸"));
    fireEvent.click(timetableCell("화요일 2교시: 빈 칸"));
    expect(api.save).not.toHaveBeenCalled();
    expect(timetableCell("월요일 1교시: 1학년 1반")).toBeTruthy();
    fireEvent.click(timetableControl("button", "텍스트로 붙여넣기·수정"));
    const input = screen.getByLabelText("주간 수업 입력");
    fireEvent.change(input, { target: { value: "금,3,1학년 1반" } });
    expect(timetableCell("금요일 3교시: 1학년 1반")).toBeTruthy();
    expect(timetableCell("월요일 1교시: 빈 칸")).toBeTruthy();
    await act(async () => {
      fireEvent.click(timetableControl("button", "시간표 저장"));
    });
    await screen.findByText("주간 시간표를 저장했어요.");
    expect(vi.mocked(api.save).mock.calls[0]?.[0].document.timetable.weeklyTables[0]?.entries).toEqual([
      { weekday: 5, period: 3, contextId: d.contexts[0]?.id },
    ]);
    fireEvent.click(timetableControl("combobox", "칸에 넣을 수업"));
    fireEvent.click(await screen.findByRole("option", { name: "칸 비우기" }));
    fireEvent.click(timetableCell("금요일 3교시: 1학년 1반"));
    await act(async () => {
      fireEvent.click(timetableControl("button", "시간표 저장"));
    });
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.save).mock.calls[1]?.[0].document.timetable.weeklyTables).toHaveLength(1);
    expect(vi.mocked(api.save).mock.calls[1]?.[0].document.timetable.weeklyTables[0]?.entries).toEqual([]);
  });
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
    button.focus();
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
    const openPreview = async () => {
      const trigger = await screen.findByRole("button", { name: "XLSX 명부 가져오기" });
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
      // fireEvent.click does not focus a trigger like a browser pointer click. Preserve
      // the real focus lifecycle and wait for Fluent's observer before entering its popup.
      trigger.focus();
      fireEvent.click(trigger);
      const preview = await screen.findByRole("dialog", { name: "XLSX 학생 명부 확인" });
      await waitFor(() => expect(preview.querySelector("[data-tabster-dummy]")).toBeTruthy());
      const input = within(preview).getByLabelText("가져온 자료 미리보기");
      input.focus();
      expect(document.activeElement).toBe(input);
      await within(preview).findByRole("button", { name: "취소" });
      return preview;
    };
    const dialog = await openPreview();
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(api.save).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    expect(dialog.textContent).toContain("XLSX 학생 명부 확인");
    expect(dialog.textContent).toContain("1명의 학생");
    expect(dialog.textContent).not.toContain("0개의 수업");
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(api.save).not.toHaveBeenCalled();
    const nextDialog = await openPreview();
    fireEvent.click(await within(nextDialog).findByRole("button", { name: "확인한 자료 적용" }));
    await screen.findByText("1-2-1 · 합성가 · 재학");
    expect(api.save).toHaveBeenCalledTimes(1);
  });
});

describe("trusted school JSON and PNG outputs", () => {
  it("requires photo-exclusion confirmation and keeps data on native cancel/failure", async () => {
    const api = host();
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    const open = async () => {
      const trigger = await screen.findByRole("button", { name: "명부·시간표 복구 JSON 저장" });
      await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
      trigger.focus();
      fireEvent.click(trigger);
      return focusRegisteredDialog("명부·시간표 복구 JSON을 저장할까요?");
    };
    let dialog = await open();
    expect(within(dialog).getByText(/사진 파일과 화면의 미저장 수정은 포함하지 않아요/)).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "취소" }));
    expect(api.exportBackup).not.toHaveBeenCalled();
    dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: "복구 JSON 저장" }));
    await waitFor(() => expect(api.exportBackup).toHaveBeenCalledOnce());
    await screen.findByRole("button", { name: "다시 불러오기" });
    expect(screen.queryByText(/복구 JSON을 새 파일로 저장했어요/)).toBeNull();
    vi.mocked(api.exportBackup).mockRejectedValueOnce(new Error("synthetic output rejection"));
    dialog = await open();
    fireEvent.click(await within(dialog).findByRole("button", { name: "복구 JSON 저장" }));
    expect(await screen.findByText(/복구 JSON을 저장하지 못했어요/)).toBeTruthy();
    expect(api.save).not.toHaveBeenCalled();
    expect(api.recover).not.toHaveBeenCalled();
  });
  it("exports the current unsaved grid by ID and never changes persisted school data", async () => {
    const api = host(),
      seed = emptyDocument();
    seed.semesters.push({
      id: "sem",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    });
    let serial = 0;
    const document = appendRoster(seed, "sem", "1,1,1,합성가", () => `id${++serial}`);
    vi.mocked(api.load).mockResolvedValue(document);
    vi.mocked(renderTimetablePng).mockResolvedValue("synthetic-base64");
    vi.mocked(api.exportTimetableImage).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
      <DeckProvider>
        <SchoolData host={api} />
      </DeckProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "일과표·시간표" }));
    fireEvent.click(screen.getByRole("combobox", { name: "칸에 넣을 수업" }));
    fireEvent.click(await screen.findByRole("option", { name: "1학년 1반" }));
    fireEvent.click(timetableCell("일요일 2교시: 빈 칸"));
    fireEvent.change(screen.getByLabelText("시간표 이름"), { target: { value: "미저장 합성표" } });
    fireEvent.click(screen.getByRole("button", { name: "현재 화면 시간표 PNG 저장" }));
    await waitFor(() => expect(api.exportTimetableImage).toHaveBeenCalledWith({ pngBase64: "synthetic-base64" }));
    expect(vi.mocked(renderTimetablePng).mock.calls.at(-1)?.[0]).toMatchObject({
      title: "2026학년도 1학기 · 미저장 합성표",
      entries: [{ weekday: 7, period: 2, contextId: document.contexts[0]?.id }],
    });
    expect(api.save).not.toHaveBeenCalled();
    expect(document.timetable.weeklyTables).toEqual([]);
    expect(screen.queryByText(/PNG 새 파일로 저장했어요/)).toBeNull();
    const trigger = await screen.findByRole("button", { name: "현재 화면 시간표 PNG 저장" });
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);
    expect(await screen.findByText(/현재 화면의 시간표를 PNG 새 파일로 저장했어요/)).toBeTruthy();
    vi.mocked(renderTimetablePng).mockRejectedValueOnce(new Error("시간표 이미지가 너무 커요."));
    await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(trigger);
    expect(await screen.findByText("시간표 이미지가 너무 커요.")).toBeTruthy();
    expect(api.exportTimetableImage).toHaveBeenCalledTimes(2);
    expect(api.save).not.toHaveBeenCalled();
  });
});
