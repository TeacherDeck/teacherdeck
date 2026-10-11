// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkSecurity } from "../check-security.ts";

const permissions = [
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "allow-presentation-ui-state",
  "allow-presentation-ui-close",
];
function violations(override: Record<string, unknown> = {}, filename = "presentation.json") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deck-presentation-acl-"));
  try {
    const folder = path.join(root, "apps/desktop/src-tauri/capabilities");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, filename),
      JSON.stringify({
        identifier: "presentation",
        windows: ["presentation-*"],
        local: true,
        permissions,
        ...override,
      }),
    );
    return checkSecurity(root).map(({ rule }) => rule);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
describe("presentation ACL exception remains exact", () => {
  it("allows only the approved fixed local surface", () => expect(violations()).toEqual([]));
  it.each([
    { windows: ["*"] },
    { windows: ["main", "presentation-*"] },
    { permissions: [...permissions, "allow-bridge-call"] },
    { permissions: [...permissions, "core:default"] },
    { remote: { urls: ["https://example.invalid"] } },
    { local: false },
  ])("rejects widened authority %j", (override) => expect(violations(override)).toContain("SEC-003"));
  it("rejects a renamed exception file", () => expect(violations({}, "other.json")).toContain("SEC-003"));
});
