// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// check-modules: module layout and manifest checks (MOD-001~004, MOD-012, MOD-013, MOD-015).
// Version-bump-vs-base-branch comparison for MOD-013 runs in CI (Phase 7).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// schemars emits JSON Schema 2020-12 (Phase 3), so use the 2020 dialect.
import { Ajv2020 } from "ajv/dist/2020.js";
import { exists, isRecord, listFiles, read, readJson } from "./lib/files.ts";
import type { Violation } from "./lib/report.ts";

export const MODULES_DIR = "modules";
export const TEMPLATE_DIR = "_template";
export const SCHEMA = "schema/module.schema.json";
/** Marker written by `pnpm new:module` into the module package.json (MOD-001). */
export const TEMPLATE_MARKER_KEY = "deckTemplate";
export const ID_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
const REQUIRED_FILES = ["module.json", "package.json", "index.html", "src/main.tsx", "icon.svg", "CHANGELOG.md"];
const TEST_RE = /\.test\.tsx?$/;
/** Rust validator shared with the host (crates/deck-codegen/src/bin/deck-validate.rs). */
export const VALIDATOR_CRATE = "crates/deck-codegen/Cargo.toml";

/**
 * Runs the host's manifest validation on manifests that already pass the JSON schema, catching
 * rules a schema cannot express (safe paths, parseable ranges, requires/optional overlap).
 * Skipped where the crate is absent (checker fixtures).
 */
export function runtimeValidate(root: string, manifests: readonly string[]): Violation[] {
  if (manifests.length === 0 || !exists(root, VALIDATOR_CRATE)) return [];
  const res = spawnSync("cargo", ["run", "--quiet", "--locked", "-p", "deck-codegen", "--bin", "deck-validate", "--", ...manifests], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error !== undefined || res.status !== 0) {
    return [{ rule: "MOD-004", message: `매니페스트 검증기를 실행하지 못했어요: ${res.error?.message ?? res.stderr.trim()}` }];
  }
  const out = JSON.parse(res.stdout) as { results: { file: string; issues: { field: string; message: string }[] }[] };
  return out.results.flatMap((r) =>
    r.issues.map((i) => ({ rule: "MOD-004", file: r.file, message: i.field === "" ? i.message : `${i.field}: ${i.message}` })),
  );
}

function parseJson(root: string, rel: string, v: Violation[]): unknown {
  try {
    return readJson(root, rel);
  } catch {
    v.push({ rule: "MOD-004", file: rel, message: "JSON으로 읽을 수 없어요." });
    return undefined;
  }
}

export function checkModules(root: string): Violation[] {
  const v: Violation[] = [];
  const modRoot = path.join(root, MODULES_DIR);
  if (!fs.existsSync(modRoot)) return v;
  const dirs = fs
    .readdirSync(modRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== TEMPLATE_DIR)
    .map((e) => e.name)
    .sort();
  if (dirs.length === 0) return v;

  const schemaPresent = exists(root, SCHEMA);
  const validate = schemaPresent ? new Ajv2020({ allErrors: true, strict: false, validateFormats: false, logger: false }).compile(readJson(root, SCHEMA) as object) : null;
  if (!schemaPresent) {
    v.push({ rule: "MOD-004", file: SCHEMA, message: "매니페스트 스키마가 없어 모듈을 검증할 수 없어요. `pnpm gen`을 실행하세요." });
  }
  const files = listFiles(root);
  const schemaValid: string[] = [];

  for (const id of dirs) {
    const base = `${MODULES_DIR}/${id}`;
    if (!ID_RE.test(id)) {
      v.push({ rule: "MOD-002", file: base, message: `모듈 id "${id}"가 형식 ${String(ID_RE)}에 맞지 않아요.` });
    }
    for (const req of REQUIRED_FILES) {
      if (!exists(root, `${base}/${req}`)) v.push({ rule: "MOD-003", file: `${base}/${req}`, message: "필수 파일이 없어요." });
    }

    // package.json: name, private, template marker.
    if (exists(root, `${base}/package.json`)) {
      const pkg = parseJson(root, `${base}/package.json`, v);
      if (isRecord(pkg)) {
        if (pkg["name"] !== `@deck-module/${id}`) {
          v.push({ rule: "MOD-003", file: `${base}/package.json`, message: `name은 "@deck-module/${id}"여야 해요.` });
        }
        if (pkg["private"] !== true) {
          v.push({ rule: "MOD-003", file: `${base}/package.json`, message: '"private": true여야 해요.' });
        }
        if (pkg[TEMPLATE_MARKER_KEY] === undefined) {
          v.push({ rule: "MOD-001", file: `${base}/package.json`, message: "템플릿 표식이 없어요. 모듈은 `pnpm new:module <id>`로만 만들어요." });
        }
      }
    }

    // module.json: id, schema, authors, changelog entry for the current version.
    if (exists(root, `${base}/module.json`)) {
      const manifest = parseJson(root, `${base}/module.json`, v);
      if (isRecord(manifest)) {
        if (manifest["id"] !== id) {
          v.push({ rule: "MOD-002", file: `${base}/module.json`, message: `id(${String(manifest["id"])})가 디렉터리명(${id})과 달라요.` });
        }
        if (validate !== null && !validate(manifest)) {
          for (const e of validate.errors ?? []) {
            v.push({ rule: "MOD-004", file: `${base}/module.json`, message: `스키마 위반: ${e.instancePath || "/"} ${e.message ?? ""}`.trim() });
          }
        } else if (validate !== null) {
          schemaValid.push(`${base}/module.json`);
        }
        const authors = manifest["authors"];
        if (!Array.isArray(authors) || authors.length === 0 || !authors.every((a) => isRecord(a) && typeof a["name"] === "string" && a["name"].trim() !== "")) {
          v.push({ rule: "MOD-012", file: `${base}/module.json`, message: "authors에 이름이 있는 저자가 1명 이상 있어야 해요." });
        }
        const version = manifest["version"];
        if (typeof version === "string" && exists(root, `${base}/CHANGELOG.md`)) {
          const escaped = version.replace(/[.+]/g, "\\$&");
          if (!new RegExp(`^##\\s+\\[?${escaped}\\]?(\\s|$)`, "m").test(read(root, `${base}/CHANGELOG.md`))) {
            v.push({ rule: "MOD-013", file: `${base}/CHANGELOG.md`, message: `현재 버전 ${version}의 항목(## ${version})이 없어요.` });
          }
        }
      }
    }

    if (!files.some((f) => f.startsWith(`${base}/src/`) && TEST_RE.test(f))) {
      v.push({ rule: "MOD-015", file: `${base}/src`, message: "vitest 테스트 파일(*.test.ts, *.test.tsx)이 없어요." });
    }
  }
  v.push(...runtimeValidate(root, schemaValid));
  return v;
}
