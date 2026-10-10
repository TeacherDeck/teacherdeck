// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeckProvider, Image } from "./index.ts";
afterEach(cleanup);
describe("Image", () => {
  it("renders a descriptive local preview with lazy decoding and its display box", () => {
    render(
      <DeckProvider>
        <Image src="blob:synthetic-thumbnail" alt="합성 사진 1" width={64} height={88} objectFit="contain" />
      </DeckProvider>,
    );
    const image = screen.getByRole("img", { name: "합성 사진 1" });
    expect(image.getAttribute("src")).toBe("blob:synthetic-thumbnail");
    expect(image.getAttribute("width")).toBe("64");
    expect(image.getAttribute("height")).toBe("88");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(getComputedStyle(image).objectFit).toBe("contain");
  });
  it("uses responsive containment by default and accepts a caller class", () => {
    render(
      <DeckProvider>
        <Image src="blob:synthetic-preview" alt="합성 이미지" className="preview" />
      </DeckProvider>,
    );
    const image = screen.getByRole("img", { name: "합성 이미지" });
    expect(image.classList.contains("preview")).toBe(true);
    expect(image.hasAttribute("width")).toBe(false);
    expect(getComputedStyle(image).maxWidth).toBe("100%");
    expect(getComputedStyle(image).objectFit).toBe("contain");
  });
  it("supports cover fit without removing the alternative text", () => {
    render(
      <DeckProvider>
        <Image src="blob:synthetic-cover" alt="합성 사진 잘림 예시" objectFit="cover" />
      </DeckProvider>,
    );
    expect(getComputedStyle(screen.getByRole("img", { name: "합성 사진 잘림 예시" })).objectFit).toBe("cover");
  });
});
