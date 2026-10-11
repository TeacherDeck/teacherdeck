// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { connect, type SchoolRosterSnapshot, type SchoolAccessGrant } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App.tsx";
import { STATE_KEY, loadState } from "./state.ts";
import { emptyState } from "./logic.ts";
function seeded() {
  const state = emptyState();
  state.students = [{ id: "synthetic-student", number: 1, name: "합성 학생", baseCount: 0 }];
  state.pending = { id: "synthetic-student", number: 1, name: "합성 학생", baseCount: 0 };
  return state;
}

vi.stubGlobal("crypto", webcrypto);
afterEach(cleanup);
it("preserves a newly saved record while a common roster read is pending", async () => {
  const initial = seeded();
  const store = new Map<string, unknown>([[STATE_KEY, initial]]);
  const snapshot: SchoolRosterSnapshot = {
    snapshotId: "snapshot",
    revision: 1,
    semester: {
      id: "semester",
      academicYear: 2026,
      term: 1,
      startDate: "2026-03-01",
      endDate: "2026-07-31",
      archived: false,
      readOnly: false,
    },
    context: {
      contextId: "context",
      semesterId: "semester",
      kind: "homeroom",
      label: "합성 학급",
      memberCount: 1,
      revision: 1,
    },
    students: [
      {
        studentId: "student",
        enrollmentId: "enrollment",
        grade: 1,
        classNumber: 1,
        studentNumber: 1,
        displayStudentCode: "1-1-1",
        name: "합성 학생",
        status: "active",
      },
    ],
  };
  const grant: SchoolAccessGrant = {
    grantHandle: "grant",
    scopes: ["roster-basic"],
    contexts: [snapshot.context],
    persistent: true,
  };
  let resolveRoster!: (value: SchoolRosterSnapshot) => void;
  const delayed = new Promise<SchoolRosterSnapshot>((resolve) => {
    resolveRoster = resolve;
  });
  const host = createMockHost({
    granted: ["storage", "fs", "window", "school-data"],
    handlers: {
      "storage.get": (args) => structuredClone(store.get((args as { key: string }).key) ?? null),
      "storage.set": (args) => {
        const { key, value } = args as { key: string; value: unknown };
        store.set(key, structuredClone(value));
        return null;
      },
      "storage.keys": () => [...store.keys()],
      "storage.delete": (args) => {
        store.delete((args as { key: string }).key);
        return null;
      },
      "school-data.status": () => ({ grants: [grant] }),
      "school-data.readRoster": () => delayed,
    },
  });
  const deck = await connect({ window: host.window });
  const view = render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  try {
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "발표 완료" }) as HTMLButtonElement).disabled).toBe(false),
    );
    const commonHeader = screen.getByRole("button", { name: "공통 명부 불러오기" });
    if (commonHeader.getAttribute("aria-expanded") === "false") fireEvent.click(commonHeader);
    fireEvent.click(await screen.findByRole("button", { name: "이 명부 불러오기" }));
    await waitFor(() => expect(host.requests.some((request) => request.method === "readRoster")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "발표 완료" }));
    await screen.findByText("발표 완료를 한 번 기록했어요.");
    expect((await loadState(deck))["events"]).toHaveLength(1);
    await act(async () => {
      resolveRoster(snapshot);
    });
    await screen.findByText("공통 명부를 불러왔어요. 기존 확정 기록은 유지해요.");
    expect((await loadState(deck))["events"]).toHaveLength(1);
  } finally {
    view.unmount();
    deck.dispose();
  }
});
