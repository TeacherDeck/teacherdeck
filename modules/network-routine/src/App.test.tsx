// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect, DeckCallError, type RoutineStatus, type NetworkConfigureArgs } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { defaultSettings } from "./logic.ts";
import { patchFor, rulesFor } from "./profile.ts";
afterEach(cleanup);
function fixture(): RoutineStatus {
  const settings = defaultSettings();
  settings.decision_mode = "hybrid";
  settings.internal.dns1 = "192.0.2.53";
  settings.schedule.days.mon = { enabled: true, start: "22:00", end: "06:00" };
  settings.wifi_rules.internal_names = ["합성 내부망"];
  return {
    routineHandle: "routine",
    profile: { profileHandle: "profile", revision: 4 },
    adapter: { adapterHandle: "adapter", displayName: "합성 어댑터", adapterType: "Wireless", available: true },
    internal: patchFor(settings),
    rules: rulesFor(settings),
    enabled: true,
    decision: null,
    snapshot: {
      dhcp: true,
      ips: ["192.0.2.10"],
      dns: [],
      connectedWifi: "합성 내부망",
      visibleWifi: [],
      locationPermissionRequired: false,
      elevationRequired: false,
    },
    state: {
      manualOverrideSegmentId: "",
      manualOverrideMode: null,
      lastHandledSegmentId: "",
      lastHandledMode: null,
      lastAppliedMode: null,
    },
    triggers: ["boot", "logon", "unlock", "console", "wifi", "schedule"].map((kind) => ({
      kind,
      required: true,
      registered: true,
    })),
    originalAutomationDetected: false,
    error: null,
  };
}
async function setup(options: { damaged?: boolean; cancelled?: boolean; stale?: boolean } = {}) {
  let status = fixture();
  if (options.stale) status = { ...status, enabled: false, error: "RECONFIGURE_REQUIRED" };
  const host = createMockHost({
    module: { id: "network-routine", version: "0.1.0" },
    granted: ["network"],
    handlers: {
      "network.adapters": () => [status.adapter],
      "network.status": () => {
        if (options.damaged) throw new DeckCallError("INTERNAL", "synthetic damaged state");
        return status;
      },
      "network.inspect": () => status.snapshot,
      "network.saveProfile": () => ({ profileHandle: "profile", revision: 5 }),
      "network.configureRoutine": (args) => {
        const a = args as NetworkConfigureArgs;
        status = {
          ...status,
          profile: { profileHandle: a.profileHandle, revision: a.revision + 1 },
          rules: a.rules,
          enabled: a.enabled,
          error: null,
        };
        return { routineHandle: status.routineHandle, status };
      },
      "network.apply": () => {
        if (options.cancelled) throw new DeckCallError("CANCELLED", "synthetic UAC cancellation");
        return { snapshot: status.snapshot, manualOverrideSegment: "segment" };
      },
      "network.evaluate": () => status,
      "network.stopRoutine": () => {
        status = { ...status, enabled: false };
        return { stopped: true };
      },
    },
  });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} />
    </DeckProvider>,
  );
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "저장 상태 다시 불러오기" }) as HTMLButtonElement).disabled).toBe(false),
  );
  return { host, deck };
}
describe("network routine native SDK workflow", () => {
  it("shows changed-runner recovery and resumes only after explicit save and registration", async () => {
    const { host, deck } = await setup({ stale: true });
    expect(screen.getByText(/앱이 업데이트되거나 설치 위치가 바뀌었어요/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "내부망으로 수동 전환" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "자동 루틴 켜기" }));
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    await waitFor(() => expect(screen.getByText("설정을 저장하고 자동 루틴을 켰어요.")).toBeTruthy());
    expect(screen.queryByText(/앱이 업데이트되거나 설치 위치가 바뀌었어요/)).toBeNull();
    expect((screen.getByRole("button", { name: "내부망으로 수동 전환" }) as HTMLButtonElement).disabled).toBe(false);
    expect(host.requests.some((r) => r.method === "configureRoutine")).toBe(true);
    expect(host.requests.some((r) => r.method === "apply")).toBe(false);
    deck.dispose();
  });
  it("restores overnight rules and all six triggers; keeps typed newline input and blocks dirty apply", async () => {
    const { host, deck } = await setup();
    expect((screen.getByRole("textbox", { name: "월요일 시작" }) as HTMLInputElement).value).toBe("22:00");
    expect(screen.getAllByText("등록됨")).toHaveLength(6);
    const input = screen.getByRole("textbox", { name: "내부망 Wi-Fi 이름" });
    fireEvent.change(input, { target: { value: "합성 내부망\n" } });
    expect((input as HTMLTextAreaElement).value).toBe("합성 내부망\n");
    fireEvent.change(input, { target: { value: "합성 내부망\n두 번째 합성망" } });
    expect((screen.getByRole("button", { name: "내부망으로 수동 전환" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
    await waitFor(() => expect(screen.getByText("설정을 저장하고 자동 루틴을 켰어요.")).toBeTruthy());
    const configure = host.requests.find((r) => r.method === "configureRoutine")?.args as NetworkConfigureArgs;
    expect(configure.rules.days).toHaveLength(7);
    expect(configure.rules.days[0]).toEqual({ enabled: true, start: "22:00", end: "06:00" });
    expect(configure.rules.internalNames).toEqual(["합성 내부망", "두 번째 합성망"]);
    expect(configure.revision).toBe(5);
    expect(host.requests.some((r) => r.method === "apply")).toBe(false);
    deck.dispose();
  });
  it("does not overwrite damaged saved data when status cannot be read", async () => {
    const { host, deck } = await setup({ damaged: true });
    expect(screen.getByText("저장한 설정을 불러오지 못했어요. 저장 상태를 먼저 확인해 주세요.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "기본 DNS" }), { target: { value: "192.0.2.53" } });
    const save = screen.getByRole("button", { name: "설정 저장" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(host.requests.some((r) => r.method === "saveProfile")).toBe(false);
    deck.dispose();
  });
  it("reports UAC cancellation without recording a successful manual switch", async () => {
    const { host, deck } = await setup({ cancelled: true });
    fireEvent.click(screen.getByRole("button", { name: "내부망으로 수동 전환" }));
    await waitFor(() =>
      expect(
        screen.getByText("관리자 승인을 취소했어요. 저장 상태와 현재 네트워크를 다시 확인해 주세요."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/수동 우선:/)).toBeNull();
    expect(host.requests.find((r) => r.method === "apply")?.args).toEqual({
      profileHandle: "profile",
      revision: 4,
      mode: "internal",
    });
    expect(host.requests.filter((r) => r.method === "status")).toHaveLength(1);
    deck.dispose();
  });
});
