// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { host, overlayControls, presentationControls } from "./host.ts";
afterEach(clearMocks);
it("requests handshake grants without activating the module", async () => {
  const calls: unknown[] = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    return [];
  });
  await host.moduleGranted("synthetic-tool");
  await host.moduleActivated(null);
  expect(calls).toEqual([
    { command: "module_activated", args: { moduleId: "synthetic-tool", activate: false } },
    { command: "module_activated", args: { moduleId: null } },
  ]);
});
it("real Tauri event API scopes every host listener to its current window", async () => {
  for (const label of ["main", "capture-overlay-synthetic", "presentation-synthetic"]) {
    const subscriptions: unknown[] = [];
    mockWindows(label);
    mockIPC((command, args) => {
      if (command === "plugin:event|listen") {
        subscriptions.push(args?.target);
        return 1;
      }
      return undefined;
    });
    await overlayControls.onState(() => undefined);
    await host.onModuleEvent(() => undefined);
    await host.onShowModule(() => undefined);
    await host.onFsDropped(() => undefined);
    await presentationControls.onChanged(() => undefined);
    expect(subscriptions).toEqual(Array.from({ length: 5 }, () => ({ kind: "Window", label })));
  }
});
