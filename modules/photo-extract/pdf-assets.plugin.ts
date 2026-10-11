// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Build-time only: PDF resources remain inside each independently packaged module.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export function pdfAssets(configUrl: string): Plugin {
  let building = false;
  const require = createRequire(configUrl);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const metadata = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(configUrl)), "src/generated/pdf-resources.json"), "utf8")) as {
    package: string; version: string; source: string; fontSource: string;
    assets: { path: string; size: number; sha256: string }[];
    notices: { path: string; text: string }[];
  };
  const installed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  if (metadata.package !== "pdfjs-dist" || installed.version !== metadata.version) throw new Error("PDF 자산 버전이 달라요. pnpm gen으로 승인 목록을 확인하세요.");
  const assets = new Map<string, Uint8Array>();
  const actualNames: string[] = [];
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && !entry.name.startsWith("quickjs-eval")) actualNames.push(`${directory}/${entry.name}`);
    }
  }
  if (actualNames.sort().join("|") !== metadata.assets.map((a) => a.path).sort().join("|")) throw new Error("PDF 자산 목록이 바뀌었어요. 원문 고지와 승인 범위를 확인하세요.");
  for (const asset of metadata.assets) {
    if (!/^(cmaps|standard_fonts|wasm|iccs)\/[^/\\]+$/.test(asset.path) || asset.path.includes("..")) throw new Error("PDF 자산 경로가 잘못됐어요.");
    const bytes = fs.readFileSync(path.join(root, asset.path));
    if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("PDF 자산 해시가 승인 목록과 달라요.");
    assets.set(asset.path, bytes);
  }
  for (const notice of metadata.notices) assets.set(notice.path, new TextEncoder().encode(notice.text));
  assets.set("THIRD-PARTY.json", new TextEncoder().encode(JSON.stringify(metadata, null, 2)));
  return {
    name: "deck-local-pdf-assets",
    configResolved(config) {
      building = config.command === "build";
    },
    buildStart() {
      if (!building) return;
      for (const [name, bytes] of assets)
        this.emitFile({ type: "asset", fileName: `pdf-assets/${name}`, source: bytes });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?")[0] ?? "";
        const marker = "/pdf-assets/";
        const index = pathname.indexOf(marker);
        if (index < 0) return next();
        const name = pathname.slice(index + marker.length);
        const bytes = assets.get(name);
        if (!bytes) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader(
          "Content-Type",
          name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
        );
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(bytes);
      });
    },
  };
}
