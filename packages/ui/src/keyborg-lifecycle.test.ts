// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { createRequire } from "node:module";
import { expect, it } from "vitest";

interface KeyboardTracker {
  subscribe(callback: (keyboard: boolean) => void): void;
  setVal(keyboard: boolean): void;
}

interface KeyboardFactory {
  createKeyborg(target: Window): KeyboardTracker;
  disposeKeyborg(tracker: KeyboardTracker): void;
}

const localRequire = createRequire(import.meta.url);
const componentsRequire = createRequire(localRequire.resolve("@fluentui/react-components"));
const fluentRequire = createRequire(componentsRequire.resolve("@fluentui/react-tabster"));
const tabsterRequire = createRequire(fluentRequire.resolve("tabster"));
const fluentKeyboard = fluentRequire("keyborg") as KeyboardFactory;
const tabsterKeyboard = tabsterRequire("keyborg") as KeyboardFactory;

it("keeps both Fluent keyboard subscribers alive when one owner closes", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const target = frame.contentWindow;
  if (target === null) throw new Error("synthetic window is unavailable");
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const fluent = fluentKeyboard.createKeyborg(target);
      const tabster = tabsterKeyboard.createKeyborg(target);
      const fluentModes: boolean[] = [];
      const tabsterModes: boolean[] = [];
      fluent.subscribe((mode) => fluentModes.push(mode));
      tabster.subscribe((mode) => tabsterModes.push(mode));
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(fluentModes).toEqual([true]);
      expect(tabsterModes).toEqual([true]);

      fluentKeyboard.disposeKeyborg(fluent);
      tabster.setVal(false);
      target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      expect(tabsterModes).toEqual([true, false, true]);
      expect(fluentModes).toEqual([true]);
      tabsterKeyboard.disposeKeyborg(tabster);
    }
  } finally {
    frame.remove();
  }
});
