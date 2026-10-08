// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as ui from "./index.ts";

describe("@deck/ui", () => {
  it("lists every exported component in COMPONENTS (gallery registration)", () => {
    const exported = Object.entries(ui)
      .filter(([name, v]) => typeof v === "function" && /^[A-Z]/.test(name))
      .map(([name]) => name)
      .sort();
    expect([...ui.COMPONENTS].sort()).toEqual(exported);
  });

  it("CapabilityGate shows the update notice when the cap is missing (MOD-007)", () => {
    render(
      <ui.DeckProvider mica={false}>
        <ui.CapabilityGate deck={{ has: () => false }} cap="ocr" feature="글자 인식">
          <span>기능</span>
        </ui.CapabilityGate>
      </ui.DeckProvider>,
    );
    expect(screen.getByText(/앱 업데이트 후 사용 가능/)).toBeTruthy();
    expect(screen.queryByText("기능")).toBeNull();
  });

  it("ToolLayout renders sections in the given order (UI-008)", () => {
    const { container } = render(
      <ui.DeckProvider mica={false}>
        <ui.ToolLayout title="도구">
          <ui.ToolLayout.Section step="input" title="입력">a</ui.ToolLayout.Section>
          <ui.ToolLayout.Section step="result" title="결과">b</ui.ToolLayout.Section>
        </ui.ToolLayout>
      </ui.DeckProvider>,
    );
    const steps = [...container.querySelectorAll("section")].map((el) => el.getAttribute("data-step"));
    expect(steps).toEqual(["input", "result"]);
  });

  it("round-trips the theme payload", () => {
    const payload = ui.themeToPayload("dark", true);
    const theme = ui.payloadToTheme(payload);
    expect(theme.colorNeutralBackground1).toBe(ui.createDeckTheme("dark").colorNeutralBackground1);
    expect(theme.fontFamilyBase).toBe(ui.FONT_STACK);
  });
});
