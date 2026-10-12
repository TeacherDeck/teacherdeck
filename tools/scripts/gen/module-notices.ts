// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Per-tool open source notices for the About screen (design-system.md §5, ADR-0030).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { exists } from "../../checks/lib/files.ts";
import { collectPdfResources, PDF_MODULES } from "../../checks/lib/pdf-assets.ts";
import { bundledModuleIds } from "../lib/modules.ts";
import { readZipEntry } from "../lib/zip.ts";
import { collectMessagingNotices, messagingNoticeOwner } from "./messaging-resources.ts";
import type { GenOutput } from "./index.ts";
import type { Notice } from "./third-party.ts";
import type { ModuleNotices, NoticeComponent, NoticeGroup } from "../../../apps/desktop/src/pages/moduleNotices.ts";

export const MODULE_NOTICES = "apps/desktop/src/generated/module-notices.json";

interface PackageInfo {
  name: string;
  version: string;
  license?: string | { type: string };
  licenses?: { type: string }[];
  dependencies?: Record<string, string>;
}

const OCR_MODEL_LICENSE_SHA256 = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function licenseOf(pkg: PackageInfo): string {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license !== undefined) return pkg.license.type;
  if (pkg.licenses !== undefined && pkg.licenses.length > 0) return pkg.licenses.map((l) => l.type).join(" OR ");
  throw new Error(`라이선스가 없는 의존성이 있어요: ${pkg.name}@${pkg.version}`);
}

/** Some packages export their entry point but hide package.json, so walk up from the entry. */
function resolvePackage(name: string, resolver: NodeJS.Require): string {
  let directory: string;
  try {
    return resolver.resolve(`${name}/package.json`);
  } catch {
    directory = path.dirname(resolver.resolve(name));
  }
  for (;;) {
    const candidate = path.join(directory, "package.json");
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as PackageInfo;
      if (pkg.name === name) return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`의존성 위치를 확인할 수 없어요: ${name}`);
    directory = parent;
  }
}

/** Runtime dependency closure of a tool. Workspace packages are followed but not listed. */
function libraryClosure(root: string, id: string): PackageInfo[] {
  const found = new Map<string, PackageInfo>();
  const visited = new Set<string>();
  const visit = (packageJson: string) => {
    if (visited.has(packageJson)) return;
    visited.add(packageJson);
    const pkg = JSON.parse(fs.readFileSync(packageJson, "utf8")) as PackageInfo;
    if (!pkg.name.startsWith("@deck/") && !pkg.name.startsWith("@deck-module/"))
      found.set(`${pkg.name}@${pkg.version}`, pkg);
    const resolver = createRequire(packageJson);
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort())
      visit(fs.realpathSync(resolvePackage(dependency, resolver)));
  };
  visit(path.join(root, "modules", id, "package.json"));
  return [...found.values()];
}

class Texts {
  readonly all: ModuleNotices["texts"] = {};
  add(key: string, title: string, text: string): string {
    const known = this.all[key];
    if (known !== undefined && known.text !== text) throw new Error("같은 고지 키에 다른 원문이 있어요.");
    this.all[key] = { title, text };
    return key;
  }
}

function packageRoot(root: string, id: string, name: string): string {
  return path.dirname(
    fs.realpathSync(resolvePackage(name, createRequire(path.join(root, "modules", id, "package.json")))),
  );
}

/** Original texts of pinned assets, keyed by library identity, plus asset-only components. */
function assetNotices(
  root: string,
  id: string,
  texts: Texts,
): { library: Map<string, string[]>; assets: NoticeComponent[] } {
  const library = new Map<string, string[]>();
  const attach = (identity: string, key: string) => library.set(identity, [...(library.get(identity) ?? []), key]);
  const assets: NoticeComponent[] = [];
  if ((PDF_MODULES as readonly string[]).includes(id)) {
    const pdf = collectPdfResources(root, id);
    for (const notice of pdf.notices) {
      const file = notice.path.split("/").at(-1) ?? notice.path;
      attach(
        `${notice.name}@${notice.version}`,
        texts.add(`npm:${notice.name}@${notice.version}/${file}`, file, notice.text),
      );
    }
    const fontLicense = fs.readFileSync(
      path.join(packageRoot(root, id, "pdfjs-dist"), "standard_fonts/LICENSE_LIBERATION"),
      "utf8",
    );
    assets.push({
      name: "Liberation Sans",
      version: pdf.fonts.version,
      license: pdf.fonts.license,
      kind: "asset",
      texts: [
        texts.add(`asset:liberation-sans@${pdf.fonts.version}/LICENSE_LIBERATION`, "LICENSE_LIBERATION", fontLicense),
      ],
      note: "PDF 문서 렌더링 전용 글꼴",
    });
  }
  if (id === "pdf-mask") {
    for (const [name, files] of [
      ["tesseract.js", ["LICENSE.md", "dist/worker.min.js.LICENSE.txt"]],
      ["tesseract.js-core", ["LICENSE"]],
    ] as const) {
      const directory = packageRoot(root, id, name);
      const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8")) as PackageInfo;
      for (const file of files) {
        const text = fs.readFileSync(path.join(directory, file), "utf8");
        attach(`${pkg.name}@${pkg.version}`, texts.add(`npm:${pkg.name}@${pkg.version}/${file}`, file, text));
      }
    }
    const model = fs.readFileSync(path.join(root, "vendor/ocr/tessdata-fast-4.1.0/LICENSE"));
    if (sha256(model) !== OCR_MODEL_LICENSE_SHA256) throw new Error("OCR 모델 고지 해시가 달라요.");
    assets.push({
      name: "tessdata_fast",
      version: "4.1.0",
      license: "Apache-2.0",
      kind: "asset",
      texts: [texts.add("asset:tessdata-fast@4.1.0/LICENSE", "LICENSE", model.toString("utf8"))],
      note: "한국어·영어 글자 인식 모델",
    });
  }
  return { library, assets };
}

function messagingComponents(root: string, texts: Texts, only?: string[]): NoticeComponent[] {
  const messaging = collectMessagingNotices(root);
  if (messaging === null) return [];
  return messaging.components
    .filter((c) => only === undefined || only.includes(c.name))
    .map((c) => {
      const files = messaging.files.filter((f) => messagingNoticeOwner(f.path) === c.name);
      if (files.length === 0) throw new Error(`실행 환경 구성 요소의 원문 고지가 없어요: ${c.name}`);
      return {
        ...c,
        kind: c.name === "CoolReserve" ? ("library" as const) : ("runtime" as const),
        texts: files.map((f) => texts.add(`runtime:${f.path}`, f.path.replace(/^Lib\/site-packages\//, ""), f.text)),
        ...(c.name === "CoolReserve" ? { note: "원작 예약 등록 코어" } : {}),
      };
    });
}

function mediaGroup(root: string, texts: Texts): NoticeGroup | null {
  const media = path.join(root, "vendor/media");
  if (!exists(root, "vendor/media/README.md")) return null;
  const read = (file: string) => fs.readFileSync(path.join(media, file), "utf8");
  const wheel = (file: string, entry: string) => {
    const text = readZipEntry(fs.readFileSync(path.join(media, file)), entry);
    if (text === null) throw new Error("실행 엔진 wheel에 원문 고지가 없어요.");
    return text.toString("utf8");
  };
  return {
    id: "media-download",
    name: "영상 받기 실행 엔진",
    version: null,
    note: "앱에 들어 있는 영상 받기 기능의 실행 엔진이에요. Deno와 FFmpeg는 설치본에 없고 첫 사용 때 받아요.",
    shared: 0,
    components: [
      ...messagingComponents(root, texts, ["CPython"]),
      {
        name: "yt-dlp",
        version: "2026.8.19",
        license: "Unlicense",
        kind: "runtime",
        texts: [
          texts.add(
            "runtime:yt-dlp@2026.8.19/LICENSE",
            "LICENSE",
            wheel("yt_dlp-2026.8.19-py3-none-any.whl", "yt_dlp-2026.8.19.dist-info/licenses/LICENSE"),
          ),
        ],
      },
      {
        name: "yt-dlp-ejs",
        version: "0.8.0",
        license: "Unlicense AND MIT AND ISC",
        kind: "runtime",
        texts: [
          texts.add(
            "runtime:yt-dlp-ejs@0.8.0/LICENSE",
            "LICENSE",
            wheel("yt_dlp_ejs-0.8.0-py3-none-any.whl", "yt_dlp_ejs-0.8.0.dist-info/licenses/LICENSE"),
          ),
        ],
      },
      {
        name: "Deno",
        version: "2.9.7",
        license: "MIT and third-party notices",
        kind: "runtime",
        texts: [
          texts.add("runtime:deno@2.9.7/LICENSE", "LICENSE", read("DENO-LICENSE.txt")),
          texts.add("runtime:deno@2.9.7/THIRD-PARTY-NOTICES", "제3자 고지", read("DENO-THIRD-PARTY-NOTICES.txt")),
        ],
        note: "첫 사용 때 받아요",
      },
      {
        name: "FFmpeg",
        version: "9.0.2",
        license: "GPL-3.0-or-later",
        kind: "runtime",
        texts: [
          texts.add("runtime:ffmpeg@9.0.2/LICENSE", "LICENSE", read("FFMPEG-LICENSE.txt")),
          texts.add(
            "runtime:ffmpeg@9.0.2/README",
            "README (저작자·구성 라이브러리)",
            read("FFMPEG-UPSTREAM-README.txt"),
          ),
          texts.add("runtime:ffmpeg@9.0.2/BUILD-CONFIG", "빌드 구성", read("FFMPEG-BUILD-CONFIG.txt")),
        ],
        note: "첫 사용 때 받아요",
      },
    ],
  };
}

/** `app` is the app-wide list (third-party.json); identical libraries are counted, not repeated. */
export function collectModuleNotices(root: string, app: Notice[]): ModuleNotices {
  const texts = new Texts();
  const appWide = new Set(app.filter((n) => n.source === "npm").map((n) => `${n.name}@${n.version}`));
  const groups: NoticeGroup[] = bundledModuleIds(root).map((id) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "modules", id, "module.json"), "utf8")) as {
      name: string;
      version: string;
    };
    const { library, assets } = assetNotices(root, id, texts);
    const libraries = libraryClosure(root, id);
    const own = libraries
      .filter((pkg) => !appWide.has(`${pkg.name}@${pkg.version}`))
      .map((pkg): NoticeComponent => ({
        name: pkg.name,
        version: pkg.version,
        license: licenseOf(pkg),
        kind: "library",
        texts: library.get(`${pkg.name}@${pkg.version}`) ?? [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
    for (const identity of library.keys())
      if (!own.some((c) => `${c.name}@${c.version}` === identity))
        throw new Error(`고지 원문의 구성 요소가 목록에 없어요: ${identity}`);
    return {
      id,
      name: manifest.name,
      version: manifest.version,
      shared: libraries.length - own.length,
      components: [...(id === "coolreserve" ? messagingComponents(root, texts) : []), ...assets, ...own],
    };
  });
  const media = mediaGroup(root, texts);
  return {
    $comment: "SPDX-License-Identifier: GPL-3.0-only; 생성물: pnpm gen. 원래 고지의 라이선스는 각 전문을 따름.",
    groups: media === null ? groups : [...groups, media],
    texts: texts.all,
  };
}

export function generateModuleNotices(root: string, app: Notice[]): GenOutput[] {
  if (!exists(root, "apps/desktop/package.json")) return [];
  return [{ path: MODULE_NOTICES, content: `${JSON.stringify(collectModuleNotices(root, app), null, 2)}\n` }];
}
