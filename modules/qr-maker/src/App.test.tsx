// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { connect } from "@deck/sdk";
import { createMockHost } from "@deck/sdk/testing";
import { DeckProvider } from "@deck/ui";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import type { GenerateQr } from "./generate.ts";
import { encodeQr, type QrImage } from "./qr.ts";

async function setup(generate: GenerateQr = async (text) => encodeQr(text)) {
  const host = createMockHost({ module: { id: "qr-maker", version: "0.1.0" }, caps: { fs: "1.2.0" }, granted: ["fs"] });
  const deck = await connect({ window: host.window });
  render(
    <DeckProvider>
      <App deck={deck} generate={generate} />
    </DeckProvider>,
  );
  return deck;
}
afterEach(cleanup);

describe("QR creator flow", () => {
  it("starts with disabled PNG saving, automatically previews valid input, and clears with input focus", async () => {
    const deck = await setup();
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "웹 주소" }), {
      target: { value: "https://example.org/synthetic" },
    });
    await screen.findByRole("img", { name: "입력한 내용을 담은 QR 코드" });
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "비우기" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "웹 주소" }));
    deck.dispose();
  });

  it("ignores a replaced generation even when its promise completes late", async () => {
    const requests: { text: string; signal: AbortSignal; resolve: (image: QrImage) => void }[] = [];
    const deck = await setup(
      (text, signal) =>
        new Promise((resolve) => {
          requests.push({ text, signal, resolve });
        }),
    );
    const input = screen.getByRole("textbox", { name: "웹 주소" });
    fireEvent.change(input, { target: { value: "https://example.org/first" } });
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.change(input, { target: { value: "https://example.org/current" } });
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]?.signal.aborted).toBe(true);
    await act(async () => {
      requests[0]?.resolve(encodeQr("https://example.org/first"));
    });
    expect(screen.queryByRole("img")).toBeNull();
    await act(async () => {
      requests[1]?.resolve(encodeQr("https://example.org/current"));
    });
    expect(screen.getByRole("img").getAttribute("src")).toContain(
      encodeURIComponent(encodeQr("https://example.org/current").svg),
    );
    deck.dispose();
  });

  it("shows actionable validation and permits literal text without URL validation", async () => {
    const deck = await setup();
    fireEvent.change(screen.getByRole("textbox", { name: "웹 주소" }), { target: { value: "합성 글" } });
    expect(screen.getByText(/http:\/\/ 또는 https:\/\//)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "글" }));
    await screen.findByRole("img");
    expect(screen.getByRole("textbox", { name: "QR 코드에 넣을 글" }).tagName).toBe("TEXTAREA");
    deck.dispose();
  });

  it("regenerates after mode changes or link whitespace when the encoded text stays the same", async () => {
    const deck = await setup();
    fireEvent.change(screen.getByRole("textbox", { name: "웹 주소" }), {
      target: { value: "https://example.org/synthetic" },
    });
    await screen.findByRole("img");
    fireEvent.change(screen.getByRole("textbox", { name: "웹 주소" }), {
      target: { value: "https://example.org/synthetic " },
    });
    await screen.findByRole("img");
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "웹 주소" }), {
      target: { value: "https://example.org/synthetic" },
    });
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("radio", { name: "글" }));
    await screen.findByRole("img");
    expect(screen.getByRole("button", { name: "PNG 저장" }).hasAttribute("disabled")).toBe(false);
    deck.dispose();
  });
});
