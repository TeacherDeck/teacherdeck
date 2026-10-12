// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { loadSourceApproval } from "../checks/lib/messaging-assets.ts";

it("recovers locked replacements and receipts, removes only unchanged obsolete source, and preserves local files", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "deck-sync-synthetic-"));
  try {
    const { stdout: output } = await promisify(execFile)(
      process.platform === "win32" ? "pwsh.exe" : "pwsh",
      [
        "-NoProfile",
        "-File",
        path.resolve("tools/scripts/sync-coolreserve-fixture.ps1"),
        "-FixtureRoot",
        fixture,
        "-SyncScript",
        path.resolve("tools/scripts/sync-coolreserve.ps1"),
      ],
      { encoding: "utf8", timeout: 240000 },
    );
    const consumer = output.trim().split(/\r?\n/).at(-1);
    expect(consumer).toBe(path.join(fixture, "consumer"));
    const receipt = loadSourceApproval(consumer ?? "");
    expect(receipt.version).toBe("0.1.2");
    expect(receipt.moduleFiles.map((file) => file.path)).toEqual(["module.json", "src/App.tsx", "src/new.ts"]);
    expect(fs.existsSync(path.join(consumer ?? "", "vendor/coolreserve/.sync-state.json"))).toBe(false);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}, 240000);
