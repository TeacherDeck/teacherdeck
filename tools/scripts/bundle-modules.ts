// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// `pnpm bundle:modules`: packs every module and writes the bundled index the host loads at startup
// (apps/desktop/src-tauri/resources/modules/, catalog.md §1). Output is generated and gitignored.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, moduleIds } from "./lib/modules.ts";
import { packModule } from "./pack-module.ts";

export const RESOURCES = "apps/desktop/src-tauri/resources/modules";

export function bundleModules(root: string): string[] {
  const out = path.join(root, RESOURCES);
  for (const e of fs.existsSync(out) ? fs.readdirSync(out) : []) {
    if (e !== ".gitkeep") fs.rmSync(path.join(out, e), { recursive: true, force: true });
  }
  const modules: Record<string, unknown[]> = {};
  for (const id of moduleIds(root)) {
    const { file, summary } = packModule(root, id);
    const url = `${id}/${summary.version}/`;
    const target = path.join(out, url, `${id}-${summary.version}.deckmod`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    modules[id] = [
      {
        version: summary.version,
        requires: summary.requires,
        optional: summary.optional,
        sha256: summary.sha256,
        size: summary.size,
        url,
        revoked: false,
      },
    ];
  }
  // Bundled modules ship with the app, so seq stays 1; remote catalogs use their own sequence.
  const index = { format: 1, seq: 1, generatedAt: new Date().toISOString(), modules };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return Object.keys(modules);
}

if (import.meta.main === true) {
  const ids = bundleModules(REPO_ROOT);
  console.log(`bundled ${ids.length} module(s): ${ids.join(", ") || "(none)"}`);
}
