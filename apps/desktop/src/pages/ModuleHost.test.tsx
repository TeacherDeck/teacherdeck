// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DeckProvider } from "@deck/ui";
import { afterEach, expect, it, vi } from "vitest";
import type { ModuleBridge } from "../bridge/ModuleBridge.ts";
import type { ModuleEntry } from "../generated/ModuleEntry.ts";
import { ModuleHost } from "./ModuleHost.tsx";

afterEach(cleanup);

it("falls back for missing and failed icons, retries a new icon URL and preserves the iframe", () => {
  const entry: ModuleEntry = {
    resolution: {
      id: "sample-tool",
      state: "ready",
      picked: { version: "0.1.0", source: "bundled" },
      newest: "0.1.0",
      unmetRequires: [],
      unmetOptional: [],
    },
    manifest: {
      manifestVersion: 1,
      id: "sample-tool",
      name: "합성 도구",
      description: "합성 설명",
      version: "0.1.0",
      category: "image",
      icon: "icon.svg",
      entry: "index.html",
      authors: [{ name: "합성 기여자" }],
      requires: {},
      optional: {},
    },
    entryUrl: "http://deckmod.sample-tool.modules.localhost/sample-tool/0.1.0/index.html",
    iconUrl: null,
  };
  const register = vi.fn(),
    unregister = vi.fn();
  const bridge = { register, unregister } as unknown as ModuleBridge;
  const page = (module: ModuleEntry) => (
    <DeckProvider>
      <ModuleHost
        bridge={bridge}
        modules={[module]}
        mounted={["sample-tool"]}
        active="sample-tool"
        loadErrors={new Set()}
      />
    </DeckProvider>
  );
  const { rerender } = render(page(entry));
  const header = screen.getByRole("banner", { name: "도구 정보" });
  const frame = screen.getByTitle("합성 도구");
  expect(header.querySelector("svg")).toBeTruthy();
  rerender(page({ ...entry, iconUrl: "http://deckmod.sample-tool.modules.localhost/icon.svg" }));
  const icon = header.querySelector("img");
  if (icon === null) throw new Error("Expected the module icon");
  fireEvent.error(icon);
  expect(header.querySelector("img")).toBeNull();
  expect(header.querySelector("svg")).toBeTruthy();
  expect(within(header).getByText("합성 도구")).toBeTruthy();
  rerender(page({ ...entry, iconUrl: "http://deckmod.sample-tool.modules.localhost/new-icon.svg" }));
  expect(header.querySelector("img")?.getAttribute("src")).toContain("new-icon.svg");
  expect(screen.getByTitle("합성 도구")).toBe(frame);
  expect(register).toHaveBeenCalledOnce();
  expect(unregister).not.toHaveBeenCalled();
});
