// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { exists, isRecord } from "./files.ts";
import type { Violation } from "./report.ts";

const CRATE = "apps/desktop/src-tauri/hancom-security";
const RESOURCE = "apps/desktop/src-tauri/resources/native/hancom";
const SOURCES = ["Cargo.toml", "src/lib.rs", "src/ffi.rs", "src/protocol.rs"];
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** An embedded callback must be our exact source build, never the official allow-all sample. */
export function checkHancomAssets(root: string): Violation[] {
  if (!exists(root, `${CRATE}/Cargo.toml`)) return [];
  const failure = (): Violation[] => [
    {
      rule: "SEC-010",
      file: `${RESOURCE}/build.json`,
      message: "한글 경로 확인 DLL의 x86 빌드·해시·현재 소스 일치를 확인하세요(ADR-0027).",
    },
  ];
  try {
    const record: unknown = JSON.parse(fs.readFileSync(path.join(root, RESOURCE, "build.json"), "utf8"));
    if (!isRecord(record) || record["target"] !== "i686-pc-windows-msvc" || !Array.isArray(record["sources"]))
      return failure();
    const sources = record["sources"] as unknown[];
    if (
      sources.length !== SOURCES.length ||
      !SOURCES.every((file, index) => {
        const entry = sources[index];
        return (
          isRecord(entry) &&
          entry["path"] === file &&
          entry["sha256"] === digest(fs.readFileSync(path.join(root, CRATE, file)))
        );
      })
    )
      return failure();
    const bytes = fs.readFileSync(path.join(root, RESOURCE, "teacherdeck_hwp_gate.dll"));
    const pe = bytes.readUInt32LE(0x3c);
    if (
      bytes.length > 2 * 1024 * 1024 ||
      record["size"] !== bytes.length ||
      record["sha256"] !== digest(bytes) ||
      bytes.subarray(0, 2).toString() !== "MZ" ||
      bytes.subarray(pe, pe + 4).toString() !== "PE\0\0" ||
      bytes.readUInt16LE(pe + 4) !== 0x14c
    )
      return failure();
    // The crate may use only std; independent implementation avoids unlicensed sample reuse.
    if (
      /^\s*\[(?:.*\.)?(?:build-|dev-)?dependencies\]/m.test(
        fs.readFileSync(path.join(root, CRATE, "Cargo.toml"), "utf8"),
      )
    )
      return failure();
    return [];
  } catch {
    return failure();
  }
}
