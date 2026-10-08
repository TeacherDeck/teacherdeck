// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-versions: the app version comes from root package.json only (VER-001).
import path from "node:path";
import { exists, isRecord, listFiles, read, readJson } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";
import { cargoWorkspaceVersion, hasOwnPackageVersion } from "./lib/versions.ts";

export const TAURI_CONF = "apps/desktop/src-tauri/tauri.conf.json";

export function checkVersions(root: string): Violation[] {
  const v: Violation[] = [];
  const pkg = readJson(root, "package.json");
  const version = isRecord(pkg) && typeof pkg["version"] === "string" ? pkg["version"] : null;
  if (version === null) {
    return [{ rule: "VER-001", file: "package.json", message: "루트 package.json에 version이 없어요." }];
  }

  if (exists(root, "Cargo.toml")) {
    const cargoVersion = cargoWorkspaceVersion(read(root, "Cargo.toml"));
    if (cargoVersion !== version) {
      v.push({ rule: "VER-001", file: "Cargo.toml", message: `[workspace.package] version(${cargoVersion ?? "없음"})이 package.json(${version})과 달라요. \`pnpm sync-versions\`를 실행하세요.` });
    }
  }

  for (const f of listFiles(root).filter((p) => p.endsWith("/Cargo.toml"))) {
    if (hasOwnPackageVersion(read(root, f))) {
      v.push({ rule: "VER-001", file: f, message: "크레이트 버전은 `version.workspace = true`로 워크스페이스를 따라야 해요." });
    }
  }

  if (exists(root, TAURI_CONF)) {
    const conf = readJson(root, TAURI_CONF);
    const ref = isRecord(conf) ? conf["version"] : undefined;
    const target = typeof ref === "string" ? path.posix.normalize(path.posix.join(path.posix.dirname(TAURI_CONF), ref)) : null;
    if (target !== "package.json") {
      v.push({ rule: "VER-001", file: TAURI_CONF, message: 'version은 루트 package.json을 가리키는 경로("../../../package.json")여야 해요.' });
    }
  }
  return v;
}
