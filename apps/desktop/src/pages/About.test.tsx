// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
// GEN-007 guard: the About screen keeps the 7(b) attribution and module author credits.
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import additionalTerms from "../../../../LICENSE-ADDITIONAL-TERMS?raw";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { About, attributionLine, licenseSummary } from "./About.tsx";

afterEach(cleanup);

const ATTRIBUTION = "TeacherDeck — Original authors: 신민성, 정영주";

const module: ModuleEntry = {
  resolution: {
    id: "timer",
    state: "ready",
    picked: { version: "0.1.0", source: "bundled" },
    newest: "0.1.0",
    unmetRequires: [],
    unmetOptional: [],
  },
  manifest: {
    manifestVersion: 1,
    id: "timer",
    name: "타이머",
    description: "수업용 타이머",
    version: "0.1.0",
    category: "classroom",
    icon: "icon.svg",
    entry: "index.html",
    authors: [{ name: "홍길동" }, { name: "성춘향" }],
    requires: {},
    optional: {},
  },
  entryUrl: "http://deckmod.localhost/timer/0.1.0/index.html",
  iconUrl: null,
};

describe("About (GEN-007)", () => {
  it("reads the attribution verbatim from LICENSE-ADDITIONAL-TERMS", () => {
    expect(attributionLine(additionalTerms)).toBe(ATTRIBUTION);
  });

  it("shows the 7(b) attribution and module authors", () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <About appVersion="0.0.0" modules={[module]} />
      </FluentProvider>,
    );
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
    expect(screen.getByText(/타이머 0\.1\.0 — 홍길동, 성춘향/)).toBeTruthy();
    expect(screen.getByText(/어떠한 보증도 없이/)).toBeTruthy();
  });
});

describe("About open source notices (ADR-0030)", () => {
  it("summarizes the count and the most common licenses", () => {
    const list = ["MIT", "MIT", "Apache-2.0", "ISC", "0BSD"].map((license) => ({ license }));
    expect(licenseSummary(list, 2)).toBe("5개 · MIT 2 · 0BSD 1 · 외 2종");
    expect(licenseSummary([])).toBe("0개");
  });

  it("groups notices into the app and each tool", async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <About appVersion="0.0.0" modules={[module]} />
      </FluentProvider>,
    );
    expect(screen.getByRole("button", { name: "앱 공통" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "쿨 예약실" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "영상 받기 실행 엔진" })).toBeTruthy();
    expect(screen.getByText(/타이머.*앱 공통 구성 요소만 써요/)).toBeTruthy();
  });

  it("opens original texts by component name, not by file path", async () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <About appVersion="0.0.0" modules={[module]} />
      </FluentProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "쿨 예약실" }));
    fireEvent.click(screen.getByRole("button", { name: "CPython 3.14.8 원문 고지" }));
    expect(screen.getByText("LICENSE.txt")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lib\/site-packages/ })).toBeNull();
  });
});
