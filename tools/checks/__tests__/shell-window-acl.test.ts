// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hostRoot = new URL("../../../apps/desktop/src-tauri/", import.meta.url);
const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, hostRoot), "utf8"));

describe("custom title bar least-privilege ACL", () => {
  it("grants exactly the six title bar commands to the local main window", () => {
    const capability = readJson("capabilities/main.json") as {
      windows: string[];
      local: boolean;
      remote?: unknown;
      permissions: (string | { identifier: string })[];
    };
    expect(capability.windows).toEqual(["main"]);
    expect(capability.local).toBe(true);
    expect(Object.hasOwn(capability, "remote")).toBe(false);
    const identifiers = capability.permissions.map((permission) =>
      typeof permission === "string" ? permission : permission.identifier,
    );
    // Drag-region double-click uses internal-toggle-maximize; caption buttons use toggle-maximize.
    // Broad core/window defaults or other window commands must not enter this grant.
    expect(identifiers.filter((id) => id.startsWith("core:window:")).sort()).toEqual([
      "core:window:allow-close",
      "core:window:allow-internal-toggle-maximize",
      "core:window:allow-is-maximized",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
    ]);
    expect(identifiers).not.toContain("core:default");
  });

  it("loads only the main capability, preserving module iframe isolation", () => {
    const configuration = readJson("tauri.conf.json") as {
      app: { security: { capabilities: unknown[] } };
    };
    expect(configuration.app.security.capabilities).toEqual(["main"]);
  });
});
