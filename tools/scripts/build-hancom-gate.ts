// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Build our independent std-only x86 callback. Never download/register Hancom's allow-all sample.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = "i686-pc-windows-msvc";
function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error("한글 작업용 경로 확인 모듈을 빌드하지 못했어요.");
}
function exportsCallback(bytes: Buffer): boolean {
  const u32 = (offset: number): number => bytes.readUInt32LE(offset);
  const pe = u32(0x3c);
  if (
    bytes.subarray(0, 2).toString() !== "MZ" ||
    bytes.subarray(pe, pe + 4).toString() !== "PE\0\0" ||
    bytes.readUInt16LE(pe + 4) !== 0x14c ||
    bytes.readUInt16LE(pe + 24) !== 0x10b
  )
    return false;
  const count = bytes.readUInt16LE(pe + 6);
  const sections = pe + 24 + bytes.readUInt16LE(pe + 20);
  const offset = (rva: number): number => {
    for (let index = 0; index < count; index += 1) {
      const section = sections + index * 40;
      const start = u32(section + 12);
      const size = u32(section + 16);
      if (rva >= start && rva - start < size) return u32(section + 20) + rva - start;
    }
    throw new Error("DLL 내부 주소를 확인하지 못했어요.");
  };
  const table = offset(u32(pe + 24 + 96));
  const names = u32(table + 24);
  if (names === 0 || names > 64) return false;
  const address = offset(u32(table + 32));
  for (let index = 0; index < names; index += 1) {
    const begin = offset(u32(address + index * 4));
    const end = bytes.indexOf(0, begin);
    if (end >= begin && end - begin <= 128 && bytes.subarray(begin, end).toString("ascii") === "IsAccessiblePath")
      return true;
  }
  return false;
}
if (process.platform === "win32") {
  // rustup verifies the pinned toolchain distribution. This installs only its x86 std target.
  run("rustup", ["target", "add", target]);
  run("cargo", ["build", "--locked", "--release", "-p", "teacherdeck-hancom-security", "--target", target]);
  const buildRoot = path.resolve(root, process.env["CARGO_TARGET_DIR"] ?? "target");
  const bytes = fs.readFileSync(path.join(buildRoot, target, "release/teacherdeck_hancom_security.dll"));
  if (!exportsCallback(bytes)) throw new Error("한글 DLL의 x86 ABI와 IsAccessiblePath export를 확인하지 못했어요.");
  const destination = path.join(root, "apps/desktop/src-tauri/resources/native/hancom");
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "teacherdeck_hwp_gate.dll"), bytes);
  const sources = ["Cargo.toml", "src/lib.rs", "src/ffi.rs", "src/protocol.rs"].map((file) => ({
    path: file,
    sha256: createHash("sha256")
      .update(fs.readFileSync(path.join(root, "apps/desktop/src-tauri/hancom-security", file)))
      .digest("hex"),
  }));
  fs.writeFileSync(
    path.join(destination, "build.json"),
    `${JSON.stringify(
      {
        target,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        sources,
      },
      null,
      2,
    )}\n`,
  );
}
