// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorAction } from "./EditorAction.tsx";

afterEach(cleanup);

describe("editor icon actions", () => {
  it("keeps its Korean accessible name and describes the shortcut on keyboard focus", async () => {
    const clicked = vi.fn();
    render(
      <DeckProvider>
        <EditorAction icon="open" label="파일 열기" shortcut="Ctrl+O" onClick={clicked} />
      </DeckProvider>,
    );
    const button = screen.getByRole("button", { name: "파일 열기" });
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    act(() => button.focus());
    const description = await screen.findByText("파일 열기 (Ctrl+O)");
    expect(description.closest('[role="tooltip"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "파일 열기" })).toBe(button);
    fireEvent.click(button);
    expect(clicked).toHaveBeenCalledOnce();
  });

  it("announces the selected tool and prevents a disabled action from running", () => {
    const clicked = vi.fn();
    render(
      <DeckProvider>
        <EditorAction icon="brush" label="브러시" selected disabled onClick={clicked} />
        <EditorAction icon="apply" label="적용" labelVisible />
      </DeckProvider>,
    );
    const button = screen.getByRole("button", { name: "브러시", pressed: true });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(clicked).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "적용" }).textContent).toBe("적용");
  });
});
