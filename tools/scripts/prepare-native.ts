// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Approved private helper materialization; no global Python installation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadRuntimeApproval, verifyManagedAssets, MESSAGING_RUNTIME_DIR } from "../checks/lib/messaging-assets.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (process.platform === "win32") {
  const approval = loadRuntimeApproval(root);
  const runtime = path.join(root, MESSAGING_RUNTIME_DIR);
  let prepared = false;
  if (fs.existsSync(runtime)) {
    try {
      verifyManagedAssets(runtime, approval.files);
      prepared = true;
    } catch {
      /* Preserve unrelated files; the preparer rejects them. */
    }
  }
  const scripts = [...(prepared ? [] : ["prepare-messaging.ps1"]), "prepare-messaging-source.ps1"];
  // PowerShell 7's inherited module path can hide or shadow Windows PowerShell 5.1 utilities.
  // These fixed scripts only need the Windows-shipped modules, including hashing and downloads.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
  );
  environment["PSModulePath"] = path.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/Modules",
  );
  for (const script of scripts) {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "tools/scripts", script),
      ],
      { cwd: root, stdio: "inherit", windowsHide: true, env: environment },
    );
    if (result.status !== 0) throw new Error("승인된 쿨 예약실 구성 파일을 준비하지 못했어요.");
  }
  verifyManagedAssets(runtime, approval.files);
}
