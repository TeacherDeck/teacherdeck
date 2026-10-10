// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Build-time only: PDF resources remain inside each independently packaged module.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

export function pdfAssets(configUrl: string): Plugin {
  let building = false;
  const require = createRequire(configUrl);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const assets = new Map<string, string>();
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true }))
      if (entry.isFile() && !entry.name.startsWith("quickjs-eval"))
        assets.set(`${directory}/${entry.name}`, path.join(root, directory, entry.name));
  return {
    name: "deck-local-pdf-assets",
    configResolved(config) {
      building = config.command === "build";
    },
    buildStart() {
      if (!building) return;
      for (const [name, filename] of assets)
        this.emitFile({ type: "asset", fileName: `pdf-assets/${name}`, source: fs.readFileSync(filename) });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?")[0] ?? "";
        const marker = "/pdf-assets/";
        const index = pathname.indexOf(marker);
        if (index < 0) return next();
        const filename = assets.get(pathname.slice(index + marker.length));
        if (!filename) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader(
          "Content-Type",
          filename.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        );
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(fs.readFileSync(filename));
      });
    },
  };
}
