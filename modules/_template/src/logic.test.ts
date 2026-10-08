// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// MOD-015: unit tests for pure logic, mock-host tests for host calls (see modules/timer).
import { describe, expect, it } from "vitest";
import { greeting } from "./logic.ts";

describe("greeting", () => {
  it("names the module", () => {
    expect(greeting("sample-tool")).toBe("sample-tool 준비됐어요");
  });
});
