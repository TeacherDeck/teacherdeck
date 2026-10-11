// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRuntimeApproval, validateRuntimeApproval, verifyManagedAssets } from "../lib/messaging-assets.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
describe("approved CoolReserve runtime boundary", () => {
  it("rejects version changes, added code and removed or altered original notices", () => {
    const approval = loadRuntimeApproval(root);
    for (const mutate of [
      (a: typeof approval) => {
        a.runtime.filename = "python-other.zip";
      },
      (a: typeof approval) => {
        a.files.push({ path: "Lib/site-packages/adodbapi/code.py", size: 0, sha256: "a".repeat(64) });
      },
      (a: typeof approval) => {
        a.files = a.files.filter((f) => f.path !== "LICENSE.txt");
      },
      (a: typeof approval) => {
        const notice = a.files.find((f) => f.path === "LICENSE.txt");
        if (notice === undefined) throw new Error("missing fixture notice");
        notice.sha256 = "a".repeat(64);
      },
    ]) {
      const edited = structuredClone(approval);
      mutate(edited);
      expect(() => validateRuntimeApproval(edited)).toThrow();
    }
  });
  it("checks actual emitted contents and refuses unexpected members", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deck-runtime-test-"));
    try {
      const bytes = Buffer.from("synthetic notice");
      const files = [
        { path: "LICENSE.txt", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
      ];
      fs.writeFileSync(path.join(directory, "LICENSE.txt"), bytes);
      expect(() => verifyManagedAssets(directory, files)).not.toThrow();
      fs.writeFileSync(path.join(directory, "extra.py"), "synthetic");
      expect(() => verifyManagedAssets(directory, files)).toThrow();
      fs.unlinkSync(path.join(directory, "extra.py"));
      fs.writeFileSync(path.join(directory, "LICENSE.txt"), "changed");
      expect(() => verifyManagedAssets(directory, files)).toThrow();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
