// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { describe, expect, it } from "vitest";
import { micaFor } from "./theme.ts";

describe("micaFor", () => {
  it("keeps Mica only when the page theme matches the Windows theme", () => {
    expect(micaFor(true, "dark", "dark")).toBe(true);
    expect(micaFor(true, "light", "light")).toBe(true);
  });

  it("falls back to the opaque background when the user overrides the Windows theme", () => {
    expect(micaFor(true, "light", "dark")).toBe(false);
    expect(micaFor(true, "dark", "light")).toBe(false);
  });

  it("stays opaque where Mica is unavailable", () => {
    expect(micaFor(false, "light", "light")).toBe(false);
  });
});
