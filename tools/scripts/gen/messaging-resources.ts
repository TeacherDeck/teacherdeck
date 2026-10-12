// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { exists } from "../../checks/lib/files.ts";
import { loadRuntimeApproval, loadSourceApproval, MESSAGING_SOURCE_LOCK } from "../../checks/lib/messaging-assets.ts";

export const MESSAGING_NOTICES_INPUT = "tools/checks/coolreserve-notices.json";

export interface MessagingNotices {
  components: { name: string; version: string; license: string }[];
  files: { path: string; text: string }[];
}

/**
 * Original notices of the managed CoolReserve runtime (ADR-0023). The bytes are committed so
 * generation needs neither network nor Python, and each one must match the approved hash.
 */
export function collectMessagingNotices(root: string): MessagingNotices | null {
  if (!exists(root, MESSAGING_NOTICES_INPUT)) return null;
  const approval = loadRuntimeApproval(root);
  const source = exists(root, MESSAGING_SOURCE_LOCK) ? loadSourceApproval(root) : null;
  const notices = JSON.parse(fs.readFileSync(path.join(root, MESSAGING_NOTICES_INPUT), "utf8")) as {
    files: { path: string; base64: string }[];
  };
  const expected = approval.files.filter((f) => /license|\/isapi\/README\.txt$/i.test(f.path));
  if (new Set(notices.files.map((f) => f.path)).size !== expected.length || notices.files.length !== expected.length)
    throw new Error("원래 실행 환경의 고지 목록과 달라요.");
  const files = notices.files.map((notice) => {
    const bytes = Buffer.from(notice.base64, "base64");
    const original = expected.find((f) => f.path === notice.path);
    if (
      original === undefined ||
      bytes.length !== original.size ||
      createHash("sha256").update(bytes).digest("hex") !== original.sha256
    )
      throw new Error("원래 라이선스 고지의 바이트가 달라요.");
    return { path: notice.path, text: bytes.toString("utf8") };
  });
  return {
    components: [
      { name: "CPython", version: "3.14.8", license: "PSF-2.0 and original notices" },
      { name: "pywinauto", version: "0.6.9", license: "BSD-3-Clause" },
      { name: "comtypes", version: "1.4.17", license: "MIT" },
      { name: "pywin32", version: "312", license: "PSF-2.0 and original notices" },
      { name: "six", version: "1.17.0", license: "MIT" },
      ...(source === null ? [] : [{ name: "CoolReserve", version: source.revision.slice(0, 12), license: "MIT" }]),
    ],
    files: [...files, ...(source === null ? [] : [{ path: "CoolReserve/LICENSE", text: source.licenseText }])],
  };
}

/** Which runtime component an original notice file belongs to. */
export function messagingNoticeOwner(file: string): string {
  if (file === "LICENSE.txt") return "CPython";
  if (file.startsWith("CoolReserve/")) return "CoolReserve";
  const site = /^Lib\/site-packages\/([^/]+)/.exec(file)?.[1] ?? "";
  if (site.startsWith("comtypes")) return "comtypes";
  if (site.startsWith("pywinauto")) return "pywinauto";
  if (site.startsWith("six")) return "six";
  if (/^(pywin32|pythonwin|win32|win32com)/.test(site)) return "pywin32";
  throw new Error("실행 환경 고지의 구성 요소를 알 수 없어요.");
}
