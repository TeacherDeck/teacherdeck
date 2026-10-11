// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { connect, type SchoolAccessGrant, type SchoolRosterSnapshot } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SchoolRoster } from "./SchoolRoster.tsx";

vi.stubGlobal("crypto", webcrypto);
afterEach(cleanup);

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
      name: "합성학생",
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

it("uses temporary input without a grant and imports only after both connect and apply", async () => {
  const host = createMockHost({
    granted: ["school-data"],
    handlers: {
      "school-data.status": () => ({ grants: [] }),
      "school-data.requestAccess": () => grant,
      "school-data.readRoster": () => snapshot,
    },
  });
  const deck = await connect({ window: host.window });
  const apply = vi.fn().mockResolvedValue(true);
  const view = render(
    <DeckProvider>
      <SchoolRoster deck={deck} disabled={false} hasRoster={false} previous={[]} onApply={apply} />
    </DeckProvider>,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "공통 명부 사용" }));
  expect(screen.getByText(/이번 작업 명단을 직접 입력/)).toBeDefined();
  expect(host.requests.some((r) => r.method === "requestAccess")).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "공통 명부 사용" }));
  fireEvent.click(screen.getByRole("button", { name: "학급 연결" }));
  const load = await screen.findByRole("button", { name: "이 명부 불러오기" });
  expect(apply).not.toHaveBeenCalled();
  expect(host.requests.some((r) => r.method === "readRoster")).toBe(false);
  fireEvent.click(load);
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply.mock.calls[0]?.[1]).toMatchObject([{ name: "합성학생", number: 1 }]);
  await screen.findByText("합성 학급의 재학 학생 1명을 불러왔어요.");
  view.unmount();
  deck.dispose();
});

it("leaves the current task alone when its remembered sharing grant was revoked", async () => {
  const host = createMockHost({
    granted: ["school-data"],
    handlers: {
      "school-data.status": () => ({ grants: [grant] }),
      "school-data.readRoster": () => {
        throw new Error("PERMISSION_DENIED");
      },
    },
  });
  const deck = await connect({ window: host.window });
  const apply = vi.fn();
  const view = render(
    <DeckProvider>
      <SchoolRoster deck={deck} disabled={false} hasRoster={false} previous={[]} onApply={apply} />
    </DeckProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "이 명부 불러오기" }));
  await screen.findByText(/현재 작업은 유지돼요/);
  expect(apply).not.toHaveBeenCalled();
  view.unmount();
  deck.dispose();
});
