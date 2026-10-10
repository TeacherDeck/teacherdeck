// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-security: Tauri config and ACL (SEC-001, SEC-003, SEC-007) and GitHub workflows (CI-001~004).
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { exists, isRecord, listFiles, read, readJson } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";

export const TAURI_DIR = "apps/desktop/src-tauri";
export const MAIN_WINDOW = "main";
const OVERLAY_LABELS = ["capture-overlay-*", "capture-toolbar-*"];
const OVERLAY_PERMISSIONS = [
  "core:event:allow-listen",
  "core:event:allow-unlisten",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "allow-overlay-ui-state",
  "allow-overlay-ui-action",
];
const sameStrings = (value: unknown, expected: string[]): boolean =>
  Array.isArray(value) && value.length === expected.length && expected.every((item) => value.includes(item));
const FORBIDDEN_PLUGIN_PREFIXES = ["fs:", "shell:", "http:"];
const SIGNING_SECRET_RE = /secrets\.TAURI_SIGNING_/;
const SHA_PIN_RE = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;

const isRemote = (s: unknown): boolean => typeof s === "string" && /^https?:\/\//i.test(s);

/** SEC-002: module frames use only the reserved module suffix and the debug probe origin. */
export function hasSafeFrameSources(csp: unknown): boolean {
  const frameSrc = isRecord(csp)
    ? csp["frame-src"]
    : typeof csp === "string"
      ? /(?:^|;)\s*frame-src\s+([^;]+)/.exec(csp)?.[1]
      : undefined;
  if (frameSrc === undefined) return true;
  const sources = typeof frameSrc === "string" ? frameSrc.trim().split(/\s+/) : Array.isArray(frameSrc) ? frameSrc : [];
  return (
    sources.length > 0 &&
    sources.every(
      (s) => s === "'none'" || s === "'self'" || s === "http://*.modules.localhost" || s === "http://deckmod.localhost",
    )
  );
}

function checkTauri(root: string, v: Violation[]): void {
  const confPath = `${TAURI_DIR}/tauri.conf.json`;
  if (exists(root, confPath)) {
    const conf = readJson(root, confPath);
    const app = isRecord(conf) && isRecord(conf["app"]) ? conf["app"] : {};
    const build = isRecord(conf) && isRecord(conf["build"]) ? conf["build"] : {};
    const security = isRecord(app["security"]) ? app["security"] : {};
    const enabledCaps = security["capabilities"];
    if (
      enabledCaps !== undefined &&
      !sameStrings(enabledCaps, ["main"]) &&
      !sameStrings(enabledCaps, ["main", "capture-overlay"])
    ) {
      v.push({
        rule: "SEC-003",
        file: confPath,
        message:
          "활성 ACL은 main과 승인된 capture-overlay 식별자만 허용해요. 인라인 권한이나 다른 창 ACL은 허용하지 않아요.",
      });
    }
    const csp = security["csp"];
    if (csp === undefined || csp === null || csp === "" || (isRecord(csp) && Object.keys(csp).length === 0)) {
      v.push({ rule: "SEC-001", file: confPath, message: "app.security.csp가 설정돼 있지 않아요." });
    }
    if (!hasSafeFrameSources(csp)) {
      v.push({
        rule: "SEC-002",
        file: confPath,
        message:
          "frame-src는 예약된 모듈 origin과 디버그 프로브만 허용해요. localhost 전체나 원격 호스트를 허용하지 않아요.",
      });
    }
    if (isRemote(build["frontendDist"])) {
      v.push({
        rule: "SEC-001",
        file: confPath,
        message: "build.frontendDist는 로컬 번들이어야 해요. 원격 URL을 로드하지 않아요.",
      });
    }
    const windows = Array.isArray(app["windows"]) ? (app["windows"] as unknown[]) : [];
    for (const w of windows) {
      if (!isRecord(w)) continue;
      if (isRemote(w["url"])) {
        v.push({ rule: "SEC-001", file: confPath, message: `창 "${String(w["label"])}"이 원격 URL을 로드해요.` });
      }
      if (w["devtools"] === true) {
        v.push({
          rule: "SEC-007",
          file: confPath,
          message: `창 "${String(w["label"])}"에 devtools: true가 있어요. 릴리스 빌드에서 devtools를 끄세요.`,
        });
      }
    }
  }

  const cargoPath = `${TAURI_DIR}/Cargo.toml`;
  if (exists(root, cargoPath)) {
    const tauriDep = /^tauri\s*=\s*(\{[^\n]*\})/m.exec(read(root, cargoPath))?.[1] ?? "";
    if (/features\s*=\s*\[[^\]]*"devtools"/.test(tauriDep)) {
      v.push({
        rule: "SEC-007",
        file: cargoPath,
        message: 'tauri 의존성에 "devtools" 기능이 켜져 있어 릴리스에서도 devtools가 열려요.',
      });
    }
  }

  for (const f of listFiles(root).filter((p) => p.startsWith(`${TAURI_DIR}/capabilities/`) && p.endsWith(".json"))) {
    const cap = readJson(root, f);
    if (!isRecord(cap)) continue;
    const windows = cap["windows"];
    // ADR-0017: the one approved local overlay ACL is an exact contract, never a broad exception.
    const overlay = f === `${TAURI_DIR}/capabilities/overlay.json` && cap["identifier"] === "capture-overlay";
    if (overlay) {
      if (
        !sameStrings(windows, OVERLAY_LABELS) ||
        cap["local"] !== true ||
        !sameStrings(cap["permissions"], OVERLAY_PERMISSIONS)
      ) {
        v.push({
          rule: "SEC-003",
          file: f,
          message: "캡처 보조 창은 승인된 두 label, local:true와 이벤트·드래그·오버레이 전용 명령 6개만 허용해요.",
        });
      }
    } else if (
      !sameStrings(windows, [MAIN_WINDOW]) ||
      cap["identifier"] === "capture-overlay" ||
      f.endsWith("/overlay.json")
    ) {
      v.push({
        rule: "SEC-003",
        file: f,
        message: `일반 ACL의 windows는 ["${MAIN_WINDOW}"]만 허용해요. 캡처 예외는 승인된 overlay.json 계약에만 적용돼요.`,
      });
    }
    if (cap["webviews"] !== undefined) {
      v.push({ rule: "SEC-003", file: f, message: "webviews 지정은 쓰지 않아요. 셸 메인 창에만 권한을 줘요." });
    }
    if (cap["remote"] !== undefined) {
      v.push({ rule: "SEC-003", file: f, message: "remote 설정으로 원격 origin에 IPC를 열지 않아요." });
    }
    const perms = Array.isArray(cap["permissions"]) ? (cap["permissions"] as unknown[]) : [];
    for (const p of perms) {
      const id = typeof p === "string" ? p : isRecord(p) && typeof p["identifier"] === "string" ? p["identifier"] : "";
      if (FORBIDDEN_PLUGIN_PREFIXES.some((prefix) => id.startsWith(prefix))) {
        v.push({
          rule: "SEC-003",
          file: f,
          message: `프론트엔드에 ${id} 권한을 주지 않아요. OS 접근은 Rust 캡을 거쳐요.`,
        });
      }
    }
  }
}

function triggers(on: unknown): Record<string, unknown> {
  if (typeof on === "string") return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((k) => [String(k), null]));
  return isRecord(on) ? on : {};
}

function checkWorkflow(f: string, src: string, v: Violation[]): void {
  let wf: unknown;
  try {
    wf = parseYaml(src);
  } catch {
    v.push({ rule: "CI-005", file: f, message: "YAML로 읽을 수 없어요." });
    return;
  }
  if (!isRecord(wf)) return;
  const on = triggers(wf["on"]);

  if ("pull_request_target" in on) {
    v.push({ rule: "CI-001", file: f, message: "pull_request_target를 쓰지 않아요." });
  }

  // CI-002: every remote action pinned to a full commit SHA with a version comment.
  src.split("\n").forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*["']?([^\s"'#]+)["']?\s*(#.*)?$/.exec(line);
    if (m === null) return;
    const ref = m[1] ?? "";
    if (ref.startsWith("./")) return;
    if (ref.startsWith("docker://")) {
      if (!/@sha256:[0-9a-f]{64}$/.test(ref))
        v.push({ rule: "CI-002", file: f, line: i + 1, message: `docker 이미지를 digest로 고정하세요: ${ref}` });
      return;
    }
    if (!SHA_PIN_RE.test(ref)) {
      v.push({ rule: "CI-002", file: f, line: i + 1, message: `action을 전체 커밋 SHA로 고정하세요: ${ref}` });
    } else if (m[2] === undefined || !/#\s*v?\d/.test(m[2])) {
      v.push({ rule: "CI-002", file: f, line: i + 1, message: `SHA 뒤에 버전 주석(# vX.Y.Z)을 다세요: ${ref}` });
    }
  });

  // CI-003: top-level permissions present and read-only.
  const perms = wf["permissions"];
  const readOnly = (p: unknown): boolean =>
    p === "read-all" || (isRecord(p) && Object.values(p).every((x) => x === "read" || x === "none"));
  if (perms === undefined) {
    v.push({ rule: "CI-003", file: f, message: "최상위 permissions를 명시하세요(기본 contents: read)." });
  } else if (!readOnly(perms)) {
    v.push({
      rule: "CI-003",
      file: f,
      message: "최상위 permissions는 읽기 전용이어야 해요. 쓰기 권한은 필요한 잡에만 주세요.",
    });
  }

  // CI-004: signing secrets only in tag-triggered jobs bound to the `release` environment.
  const jobs = isRecord(wf["jobs"]) ? wf["jobs"] : {};
  for (const [name, job] of Object.entries(jobs)) {
    if (!SIGNING_SECRET_RE.test(JSON.stringify(job))) continue;
    const env = isRecord(job) ? job["environment"] : undefined;
    const envName = typeof env === "string" ? env : isRecord(env) ? env["name"] : undefined;
    if (envName !== "release") {
      v.push({
        rule: "CI-004",
        file: f,
        message: `잡 "${name}"이 서명 시크릿을 쓰지만 environment가 release가 아니에요.`,
      });
    }
    const push = on["push"];
    const tagOnly =
      Object.keys(on).length === 1 && isRecord(push) && push["tags"] !== undefined && push["branches"] === undefined;
    if (!tagOnly) {
      v.push({
        rule: "CI-004",
        file: f,
        message: `잡 "${name}"이 서명 시크릿을 쓰므로 워크플로는 태그 push로만 트리거돼야 해요.`,
      });
    }
  }
}

export function checkSecurity(root: string): Violation[] {
  const v: Violation[] = [];
  checkTauri(root, v);
  for (const f of listFiles(root)) {
    if (f.startsWith(".github/workflows/") && [".yml", ".yaml"].includes(path.posix.extname(f))) {
      checkWorkflow(f, read(root, f), v);
    }
  }
  return v;
}
