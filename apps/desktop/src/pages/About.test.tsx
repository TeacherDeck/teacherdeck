// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
// GEN-007 guard: the About screen keeps the 7(b) attribution and module author credits.
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import additionalTerms from "../../../../LICENSE-ADDITIONAL-TERMS?raw";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { About, attributionLine } from "./About.tsx";

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
