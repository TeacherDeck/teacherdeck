// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm pack:module <id>`: builds a module with Vite and packs it into target/deckmod/<id>-<version>.deckmod.
// The package is written by deck-core (deck-pack), so it always passes the host's validation.
import fs from "node:fs";
import path from "node:path";
import { MODULES_DIR, REPO_ROOT, cargoBin, copyDir, run } from "./lib/modules.ts";

export interface PackSummary {
  id: string;
  version: string;
  requires: Record<string, string>;
  optional: Record<string, string>;
  sha256: string;
  size: number;
  files: number;
}

export interface Packed {
  file: string;
  summary: PackSummary;
}

export function packModule(root: string, id: string): Packed {
  const modDir = path.join(root, MODULES_DIR, id);
  if (!fs.existsSync(path.join(modDir, "module.json"))) throw new Error(`modules/${id}/module.json not found`);
  // 1. Build with the module's own vite.config.ts.
  run(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "build", "--logLevel", "warn"], modDir);
  // 2. Stage: build output + manifest + icon (catalog.md §2: module.json at the package root).
  const staging = path.join(root, "target/deckmod-staging", id);
  fs.rmSync(staging, { recursive: true, force: true });
  copyDir(path.join(modDir, "dist"), staging);
  fs.copyFileSync(path.join(modDir, "module.json"), path.join(staging, "module.json"));
  fs.copyFileSync(path.join(modDir, "icon.svg"), path.join(staging, "icon.svg"));
  // 3. Pack with deck-core.
  const version = (JSON.parse(fs.readFileSync(path.join(modDir, "module.json"), "utf8")) as { version: string }).version;
  const file = path.join(root, "target/deckmod", `${id}-${version}.deckmod`);
  const summary = JSON.parse(cargoBin(root, "deck-pack", [staging, file])) as PackSummary;
  return { file, summary };
}

if (import.meta.main === true) {
  const id = process.argv[2];
  if (id === undefined) {
    console.error("usage: pnpm pack:module <id>");
    process.exit(2);
  }
  const { file, summary } = packModule(REPO_ROOT, id);
  console.log(`packed ${path.relative(REPO_ROOT, file)} (${summary.size} bytes, sha256 ${summary.sha256})`);
}
