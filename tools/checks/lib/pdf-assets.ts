// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

export const PDF_MODULES = ["pdf-compress", "pdf-mask", "photo-extract", "file-rename"] as const;
export const PDF_ASSET_ALLOWLIST = "tools/checks/pdf-assets.allow.json";
const FONT_FILES = ["Bold", "BoldItalic", "Italic", "Regular"].map((s) => `standard_fonts/LiberationSans-${s}.ttf`);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
interface AssetApproval {
  package: string;
  version: string;
  fontVersion: string;
  source: string;
  fontSource: string;
  license: string;
  licenseFile: string;
  licenseSha256: string;
  files: { path: string; sha256: string }[];
}
interface PackageInfo { name: string; version: string; license: string; dependencies?: Record<string, string> }
export interface PdfResources {
  package: string;
  version: string;
  source: string;
  fontSource: string;
  fonts: { version: string; license: string; paths: string[] };
  assets: { path: string; sha256: string; size: number }[];
  notices: { path: string; name: string; version: string; license: string; source: string; text: string }[];
}

/** The exception is deliberately four exact files, never a permissive license expression. */
export function validateFontApproval(approval: AssetApproval, version: string, readAsset: (name: string) => Uint8Array): void {
  if (approval.package !== "pdfjs-dist" || approval.version !== "6.4.299" || version !== approval.version ||
      approval.files.length !== 4 || [...approval.files.map((f) => f.path)].sort().join("|") !== FONT_FILES.sort().join("|") ||
      approval.licenseFile !== "standard_fonts/LICENSE_LIBERATION") throw new Error("PDF 글꼴 예외 범위 또는 버전이 달라요.");
  for (const file of [...approval.files, { path: approval.licenseFile, sha256: approval.licenseSha256 }]) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || sha256(readAsset(file.path)) !== file.sha256)
      throw new Error("PDF 글꼴 또는 원문 라이선스 해시가 승인 기록과 달라요.");
  }
}

/** Collect only browser PDF dependencies; optional Node canvas code is not shipped. */
export function collectPdfResources(root: string, moduleId: string): PdfResources {
  const approval = JSON.parse(fs.readFileSync(path.join(root, PDF_ASSET_ALLOWLIST), "utf8")) as AssetApproval;
  const require = createRequire(path.join(root, "modules", moduleId, "package.json"));
  const pdfRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const info = JSON.parse(fs.readFileSync(path.join(pdfRoot, "package.json"), "utf8")) as PackageInfo;
  validateFontApproval(approval, info.version, (name) => fs.readFileSync(path.join(pdfRoot, name)));
  const assets: PdfResources["assets"] = [];
  for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const entry of fs.readdirSync(path.join(pdfRoot, directory), { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith("quickjs-eval")) continue;
      if (directory === "standard_fonts" && entry.name.endsWith(".ttf") && !FONT_FILES.includes(`${directory}/${entry.name}`))
        throw new Error("승인되지 않은 PDF 글꼴이 추가됐어요.");
      const bytes = fs.readFileSync(path.join(pdfRoot, directory, entry.name));
      assets.push({ path: `${directory}/${entry.name}`, size: bytes.length, sha256: sha256(bytes) });
    }
  }
  assets.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const notices: PdfResources["notices"] = [];
  const seen = new Set<string>();
  function resolvePackage(name: string, resolver: ReturnType<typeof createRequire>): string {
    // Some packages export their entry point but deliberately hide package.json.
    let directory = path.dirname(resolver.resolve(name));
    for (;;) {
      const candidate = path.join(directory, "package.json");
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as PackageInfo;
        if (pkg.name === name) return candidate;
      }
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error("PDF 의존성 원천 위치를 확인할 수 없어요.");
      directory = parent;
    }
  }
  function collectPackage(packageJson: string): void {
    const directory = path.dirname(packageJson);
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8")) as PackageInfo;
    const identity = `${pkg.name}@${pkg.version}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const licenseFiles = fs.readdirSync(directory).filter((file) => /^(license|copying|notice)(\.|$)/i.test(file));
    if (licenseFiles.length === 0) throw new Error(`PDF 의존성의 원문 고지가 없어요: ${identity}`);
    for (const file of licenseFiles) {
      notices.push({ path: `notices/${pkg.name.replaceAll("/", "_")}@${pkg.version}/${file}`, name: pkg.name,
        version: pkg.version, license: pkg.license, source: `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
        text: fs.readFileSync(path.join(directory, file), "utf8") });
    }
    const localRequire = createRequire(packageJson);
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) collectPackage(resolvePackage(dependency, localRequire));
  }
  collectPackage(require.resolve("pdfjs-dist/package.json"));
  const modulePackage = JSON.parse(fs.readFileSync(path.join(root, "modules", moduleId, "package.json"), "utf8")) as PackageInfo;
  if (modulePackage.dependencies?.["pdf-lib"] !== undefined) collectPackage(require.resolve("pdf-lib/package.json"));
  notices.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { package: info.name, version: info.version, source: approval.source, fontSource: approval.fontSource,
    fonts: { version: approval.fontVersion, license: approval.license, paths: [...FONT_FILES].sort() }, assets, notices };
}
