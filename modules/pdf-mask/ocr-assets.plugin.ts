// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/** Keep the pinned engine, models and their original notices inside the module. */
export function ocrAssets(configUrl: string): Plugin {
  const require = createRequire(configUrl);
  const assets = new Map<string, Buffer>();
  for (const [name, version, files] of [
    ["tesseract.js", "6.0.1", ["dist/worker.min.js", "dist/worker.min.js.LICENSE.txt", "LICENSE.md"]],
    ["tesseract.js-core", "6.0.0", ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "LICENSE"]],
  ] as const) {
    const root = path.dirname(require.resolve(`${name}/package.json`));
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
    if (metadata.version !== version) throw new Error("OCR 엔진 버전을 확인해 주세요.");
    for (const file of files) {
      const output = file.startsWith("LICENSE") ? `${name}-LICENSE` : path.basename(file);
      assets.set(output, fs.readFileSync(path.join(root, file)));
    }
  }
  const modelRoot = fileURLToPath(new URL("../../vendor/ocr/tessdata-fast-4.1.0/", configUrl));
  const models = [
    ["eng.traineddata", "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"],
    ["kor.traineddata", "6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2"],
    ["LICENSE", "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"],
  ];
  for (const [name, hash] of models) {
    if (!name) throw new Error("OCR 모델 목록이 잘못됐어요.");
    const data = fs.readFileSync(path.join(modelRoot, name));
    if (createHash("sha256").update(data).digest("hex") !== hash) throw new Error("OCR 모델 해시가 달라요.");
    assets.set(name === "LICENSE" ? "tessdata-fast-LICENSE" : name, data);
  }
  assets.set(
    "NOTICE.json",
    Buffer.from(
      JSON.stringify(
        {
          engine: "https://github.com/naptha/tesseract.js/tree/v6.0.1",
          core: "https://github.com/naptha/tesseract.js-core/tree/v6.0.0",
          models: "https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0",
          license: "Apache-2.0",
          files: [...assets].map(([name, bytes]) => ({
            name,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          })),
        },
        null,
        2,
      ),
    ),
  );
  let building = false;
  return {
    name: "deck-local-ocr-assets",
    configResolved(config) {
      building = config.command === "build";
    },
    buildStart() {
      if (building)
        for (const [name, source] of assets) this.emitFile({ type: "asset", fileName: `ocr-assets/${name}`, source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = (request.url ?? "").split("?")[0] ?? "";
        const start = url.indexOf("/ocr-assets/");
        if (start < 0) return next();
        const name = url.slice(start + "/ocr-assets/".length);
        const data = assets.get(name);
        if (!data) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(data);
      });
    },
  };
}
