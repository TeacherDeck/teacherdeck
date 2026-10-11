// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { listFiles } from "./files.ts";

export const MESSAGING_RUNTIME_LOCK = "tools/checks/coolreserve-runtime.allow.json";
export const MESSAGING_RUNTIME_DIR = "apps/desktop/src-tauri/resources/native/coolreserve/python";
export const MESSAGING_SOURCE_LOCK = "tools/checks/coolreserve-source.allow.json";
export const MESSAGING_SOURCE_DIR = "apps/desktop/src-tauri/resources/native/coolreserve/source";
const APPROVED_MEMBER_DIGEST = "3c0a5170d41dfbb9465a4bbca2759196d86868cacb4fdbf7276fabe22395381e";
const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
export interface ManagedAsset {
  path: string;
  size: number;
  sha256: string;
}
export interface RuntimeApproval {
  status: string;
  runtime: { filename: string; url: string; sha256: string };
  packages: { name: string; version: string; artifacts: { filename: string; url: string; sha256: string }[] }[];
  files: ManagedAsset[];
}
export interface SourceApproval {
  repository: string;
  revision: string;
  version: string;
  archive: { path: string; sha256: string };
  files: ManagedAsset[];
  moduleFiles: ManagedAsset[];
  licenseText: string;
}
export function loadSourceApproval(root: string): SourceApproval {
  const approval = JSON.parse(fs.readFileSync(path.join(root, MESSAGING_SOURCE_LOCK), "utf8")) as SourceApproval;
  const sourceFiles = [
    "LICENSE",
    "teacherdeck_worker.py",
    ...[
      "__init__",
      "core",
      "engine",
      "windows",
      "gentoo",
      "gentoo_tree",
      "recipients",
      "verification",
      "draft_recovery",
      "waiting",
      "privacy",
      "teacherdeck_worker",
    ].map((name) => `app/${name}.py`),
  ];
  if (
    approval.files
      .map((f) => f.path)
      .sort()
      .join("|") !== sourceFiles.sort().join("|")
  )
    throw new Error("원작 실행 코어의 제한된 파일 목록이 달라요.");
  if (
    approval.repository !== "https://github.com/rochelobeJYJ/CoolReserve" ||
    !/^[a-f0-9]{40}$/.test(approval.revision) ||
    approval.archive.path !== `vendor/coolreserve/${approval.revision}.zip` ||
    !/^[a-f0-9]{64}$/.test(approval.archive.sha256)
  )
    throw new Error("원작의 고정 커밋과 산출물을 확인해 주세요.");
  const notice = Buffer.from(approval.licenseText, "utf8");
  const file = approval.files.find((f) => f.path === "LICENSE");
  if (
    file === undefined ||
    file.size !== notice.length ||
    file.sha256 !== digest(notice) ||
    !approval.licenseText.includes("MIT License")
  )
    throw new Error("CoolReserve의 원래 MIT 저작자 고지가 달라요.");
  if (digest(fs.readFileSync(path.join(root, approval.archive.path))) !== approval.archive.sha256)
    throw new Error("원작 산출물의 해시가 달라요.");
  for (const member of [...approval.files, ...approval.moduleFiles]) {
    if (
      !member.path ||
      member.path.startsWith("/") ||
      member.path.includes("\\") ||
      member.path.split("/").some((p) => p === ".." || p === "." || p === "") ||
      member.path.includes(":")
    )
      throw new Error("원작 파일 경로를 확인해 주세요.");
  }
  for (const member of approval.moduleFiles) {
    const bytes = fs.readFileSync(path.join(root, "modules/coolreserve", member.path));
    if (bytes.length !== member.size || digest(bytes) !== member.sha256)
      throw new Error("티처덱 모듈과 원작 산출물이 달라요. 원천을 갱신한 뒤 다시 가져오세요.");
  }
  const modulePaths = listFiles(root)
    .filter((f) => f.startsWith("modules/coolreserve/"))
    .map((f) => f.slice("modules/coolreserve/".length));
  if (
    modulePaths.sort().join("|") !==
    approval.moduleFiles
      .map((f) => f.path)
      .sort()
      .join("|")
  )
    throw new Error("원작과 모듈 소스의 파일 목록이 달라요.");
  return approval;
}
/** This is an exact-file exception, not a PSF/LGPL allowlist for arbitrary packages. */
export function validateRuntimeApproval(approval: RuntimeApproval): void {
  if (
    approval.status !== "approved-2026-10-11" ||
    approval.runtime.filename !== "python-3.14.8-embed-amd64.zip" ||
    approval.runtime.sha256 !== "a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310" ||
    approval.files.length !== 585
  )
    throw new Error("승인된 Python 실행 환경과 달라요.");
  const packages = approval.packages
    .map((p) => `${p.name}@${p.version}`)
    .sort()
    .join("|");
  if (packages !== "comtypes@1.4.17|pywin32@312|pywinauto@0.6.9|six@1.17.0")
    throw new Error("승인된 helper 의존성과 달라요.");
  const members = approval.files
    .map(({ path: memberPath, size, sha256 }) => ({ path: memberPath, size, sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (digest(JSON.stringify(members)) !== APPROVED_MEMBER_DIGEST)
    throw new Error("실행 환경의 파일·라이선스 고지 잠금이 승인 범위와 달라요.");
}
export function loadRuntimeApproval(root: string): RuntimeApproval {
  const approval = JSON.parse(fs.readFileSync(path.join(root, MESSAGING_RUNTIME_LOCK), "utf8")) as RuntimeApproval;
  validateRuntimeApproval(approval);
  return approval;
}
/** Verifies all emitted bytes and rejects extra executable members, including symlinks. */
export function verifyManagedAssets(directory: string, files: readonly ManagedAsset[]): void {
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
    throw new Error("실제 helper 폴더만 검사할 수 있어요.");
  const expected = new Map(files.map((file) => [file.path, file]));
  if (expected.size !== files.length) throw new Error("중복 자산 경로가 있어요.");
  const found = new Set<string>();
  function walk(base: string, relative: string) {
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(base, entry.name);
      if (entry.isSymbolicLink()) throw new Error("연결 파일은 helper에 포함할 수 없어요.");
      if (entry.isDirectory()) {
        walk(full, key);
        continue;
      }
      const expectedFile = expected.get(key);
      if (!entry.isFile() || expectedFile === undefined) throw new Error("승인 목록 밖 helper 파일이 있어요.");
      const bytes = fs.readFileSync(full);
      if (bytes.length !== expectedFile.size || digest(bytes) !== expectedFile.sha256)
        throw new Error("helper 파일 또는 원래 고지의 해시가 달라요.");
      found.add(key);
    }
  }
  walk(directory, "");
  if (found.size !== expected.size) throw new Error("helper 파일 또는 라이선스 고지가 빠졌어요.");
}
