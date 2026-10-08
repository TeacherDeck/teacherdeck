// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Pre-commit secret scan (SEC-009). Runs gitleaks on staged changes when it is installed;
// otherwise prints a notice and passes (GitHub push protection is the backstop).
import { spawnSync } from "node:child_process";

const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
if (probe.error !== undefined) {
  console.log("gitleaks가 설치돼 있지 않아 비밀값 검사를 건너뛰어요(SEC-009). 설치: winget install Gitleaks.Gitleaks");
  process.exit(0);
}
const res = spawnSync("gitleaks", ["git", "--pre-commit", "--staged", "--redact", "--no-banner"], { stdio: "inherit" });
if (res.status !== 0) console.log("[SEC-009] 스테이징된 변경에서 비밀값이 의심돼요. 커밋하지 마세요. (정의: docs/spec/security.md)");
process.exit(res.status ?? 1);
