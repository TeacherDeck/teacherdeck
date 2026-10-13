// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)";
const INSTALLER = new RegExp(`^TeacherDeck_(${VERSION})_(x64|x86|arm64)-setup\\.exe$`);
const STABLE_VERSION = new RegExp(`^${VERSION}$`);
const MODULE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface CleanupOptions {
  root: string;
  currentArtifact?: string | undefined;
  buildSucceeded?: boolean;
  apply?: boolean;
}

export interface CleanupResult {
  mode: "dry-run" | "apply";
  ready: boolean;
  reason: string;
  files: string[];
  bytes: number;
}

interface Candidate {
  file: string;
  version: string;
  arch: string;
}

interface Identity {
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

function equalPath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Reject directory junctions, symlinks, escaped paths and noncanonical reparse paths. */
function safePath(root: string, file: string): boolean {
  if (!inside(root, file)) return false;
  let current = root;
  try {
    for (const part of path.relative(root, file).split(path.sep)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink() || !equalPath(fs.realpathSync.native(current), current)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function regularFile(root: string, file: string): boolean {
  return safePath(root, file) && fs.lstatSync(file).isFile();
}

function directories(root: string, directory: string): string[] {
  if (!safePath(root, directory) || !fs.lstatSync(directory).isDirectory()) return [];
  return fs
    .readdirSync(directory)
    .sort()
    .map((name) => path.join(directory, name))
    .filter((file) => safePath(root, file) && fs.lstatSync(file).isDirectory());
}

/** Only the fixed release layout and one custom Cargo target directory are searched. */
function installerDirectories(root: string): string[] {
  const target = path.join(root, "target");
  const children = directories(root, target);
  const triples = children
    .flatMap((dir) => directories(root, dir))
    .filter((dir) => /^(?:x86_64|i686|aarch64)-pc-windows-(?:msvc|gnu)$/.test(path.basename(dir)));
  const releaseRoots = [
    path.join(target, "release"),
    ...[...children, ...triples].map((dir) => path.join(dir, "release")),
  ];
  return releaseRoots
    .map((dir) => path.join(dir, "bundle", "nsis"))
    .filter((dir) => safePath(root, dir) && fs.lstatSync(dir).isDirectory());
}

function compareVersion(a: string, b: string): number {
  const right = b.split(".").map(BigInt);
  for (const [index, left] of a.split(".").map(BigInt).entries()) {
    const other = right[index];
    if (other === undefined) throw new Error("invalid version");
    if (left < other) return -1;
    if (left > other) return 1;
  }
  return 0;
}

function identity(file: string): Identity {
  const stat = fs.lstatSync(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, dev: stat.dev };
}

function sameIdentity(file: string, previous: Identity): boolean {
  const current = identity(file);
  return (
    current.size === previous.size &&
    current.mtimeMs === previous.mtimeMs &&
    current.ino === previous.ino &&
    current.dev === previous.dev
  );
}

function manifestVersion(root: string, file: string): string | undefined {
  if (!regularFile(root, file)) return undefined;
  const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    typeof data.version !== "string" ||
    !STABLE_VERSION.test(data.version)
  )
    return undefined;
  return data.version;
}

function staleModulePackages(root: string): string[] {
  const out = path.join(root, "target", "deckmod");
  if (!safePath(root, out) || !fs.lstatSync(out).isDirectory()) return [];
  const files: string[] = [];
  for (const moduleDir of directories(root, path.join(root, "modules"))) {
    const id = path.basename(moduleDir);
    if (!MODULE_ID.test(id)) continue;
    const version = manifestVersion(root, path.join(moduleDir, "module.json"));
    if (version === undefined) continue;
    const current = path.join(out, `${id}-${version}.deckmod`);
    if (!regularFile(root, current) || fs.lstatSync(current).size === 0) continue;
    const pattern = new RegExp(`^${id}-(${VERSION})\\.deckmod$`);
    for (const name of fs.readdirSync(out).sort()) {
      const match = pattern.exec(name);
      const file = path.join(out, name);
      if (match?.[1] !== undefined && compareVersion(match[1], version) < 0 && regularFile(root, file))
        files.push(file);
    }
  }
  return files;
}

/** Only release resources whose current catalog and packages match this successful source bundle. */
function staleBundledPackages(root: string, witnesses: Map<string, Identity>): string[] {
  const source = path.join(root, "apps/desktop/src-tauri/resources/modules");
  const catalogPath = path.join(source, "index.json");
  if (!regularFile(root, catalogPath)) return [];
  const catalogBytes = fs.readFileSync(catalogPath);
  const catalog: unknown = JSON.parse(catalogBytes.toString("utf8"));
  if (
    typeof catalog !== "object" ||
    catalog === null ||
    !("modules" in catalog) ||
    typeof catalog.modules !== "object" ||
    catalog.modules === null ||
    Array.isArray(catalog.modules)
  )
    return [];
  const files: string[] = [];
  for (const directory of installerDirectories(root)) {
    const output = path.join(directory, "../..", "modules");
    const outputCatalog = path.join(output, "index.json");
    if (!regularFile(root, outputCatalog) || !fs.readFileSync(outputCatalog).equals(catalogBytes)) continue;
    witnesses.set(catalogPath, identity(catalogPath));
    witnesses.set(outputCatalog, identity(outputCatalog));
    for (const [id, entries] of Object.entries(catalog.modules)) {
      if (!MODULE_ID.test(id) || !Array.isArray(entries) || entries.length !== 1) continue;
      const entry: unknown = entries[0];
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("version" in entry) ||
        typeof entry.version !== "string" ||
        !STABLE_VERSION.test(entry.version) ||
        !("sha256" in entry) ||
        typeof entry.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !("size" in entry) ||
        typeof entry.size !== "number" ||
        entry.size <= 0 ||
        manifestVersion(root, path.join(root, "modules", id, "module.json")) !== entry.version
      )
        continue;
      const relative = path.join(id, entry.version, `${id}-${entry.version}.deckmod`);
      const currentCopies = [path.join(source, relative), path.join(output, relative)];
      if (
        !currentCopies.every(
          (file) =>
            regularFile(root, file) &&
            fs.lstatSync(file).size === entry.size &&
            createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256,
        )
      )
        continue;
      for (const file of currentCopies) witnesses.set(file, identity(file));
      for (const versionDirectory of directories(root, path.join(output, id))) {
        const version = path.basename(versionDirectory);
        if (!STABLE_VERSION.test(version) || compareVersion(version, entry.version) >= 0) continue;
        const file = path.join(versionDirectory, `${id}-${version}.deckmod`);
        if (regularFile(root, file)) files.push(file);
      }
    }
  }
  return files;
}

/** Cleanup follows a successful build; a missing/failed build always retains every artifact. */
export function cleanBuildArtifacts(options: CleanupOptions): CleanupResult {
  const result: CleanupResult = {
    mode: options.apply === true ? "apply" : "dry-run",
    ready: false,
    reason: "성공한 빌드의 현재 설치 파일을 지정해야 합니다.",
    files: [],
    bytes: 0,
  };
  if (options.buildSucceeded !== true || options.currentArtifact === undefined) return result;
  try {
    const requestedRoot = path.resolve(options.root);
    const root = fs.realpathSync.native(requestedRoot);
    if (!equalPath(requestedRoot, root) || fs.lstatSync(requestedRoot).isSymbolicLink()) {
      result.reason = "작업 폴더가 링크이므로 정리를 중단했습니다.";
      return result;
    }
    const current = path.resolve(root, options.currentArtifact);
    const currentName = INSTALLER.exec(path.basename(current));
    const version = manifestVersion(root, path.join(root, "package.json"));
    const allowedDirectories = installerDirectories(root);
    if (
      version === undefined ||
      currentName === null ||
      currentName[1] !== version ||
      !regularFile(root, current) ||
      fs.lstatSync(current).size === 0 ||
      !allowedDirectories.some((dir) => equalPath(dir, path.dirname(current)))
    ) {
      result.reason = "현재 앱 버전과 일치하는 안전한 설치 파일이 없어 정리를 중단했습니다.";
      return result;
    }
    const currentIdentity = identity(current);
    const candidates: Candidate[] = [];
    for (const directory of allowedDirectories) {
      for (const name of fs.readdirSync(directory).sort()) {
        const match = INSTALLER.exec(name);
        const file = path.join(directory, name);
        if (match?.[1] !== undefined && match[2] !== undefined && regularFile(root, file)) {
          candidates.push({ file, version: match[1], arch: match[2] });
        }
      }
    }
    // An empty installer is not a usable fallback: only nonempty versions protect an architecture's latest build.
    const latest = new Map<string, string>();
    for (const item of candidates) {
      if (fs.lstatSync(item.file).size === 0) continue;
      const previous = latest.get(item.arch);
      if (previous === undefined || compareVersion(item.version, previous) > 0) latest.set(item.arch, item.version);
    }
    const files: string[] = [];
    for (const item of candidates) {
      if (compareVersion(item.version, version) >= 0 || item.version === latest.get(item.arch)) continue;
      files.push(item.file);
      const signature = `${item.file}.sig`;
      if (regularFile(root, signature)) files.push(signature);
    }
    const witnesses = new Map<string, Identity>();
    files.push(...staleModulePackages(root), ...staleBundledPackages(root, witnesses));
    files.sort();
    const identities = files.map(identity);
    result.files = files.map((file) => path.relative(root, file).split(path.sep).join("/"));
    result.bytes = identities.reduce((sum, stat) => sum + stat.size, 0);
    result.ready = true;
    result.reason = "현재 설치 파일과 아키텍처별 최신 버전을 보존합니다.";
    if (options.apply === true) {
      // Validate the complete plan before its first unlink, then recheck each boundary immediately before unlink.
      if (
        !regularFile(root, current) ||
        !sameIdentity(current, currentIdentity) ||
        [...witnesses].some(([file, previous]) => !regularFile(root, file) || !sameIdentity(file, previous)) ||
        files.some((file, index) => {
          const previous = identities[index];
          return previous === undefined || !regularFile(root, file) || !sameIdentity(file, previous);
        })
      ) {
        throw new Error("artifact changed");
      }
      for (const [index, file] of files.entries()) {
        const previous = identities[index];
        if (
          previous === undefined ||
          !regularFile(root, current) ||
          !sameIdentity(current, currentIdentity) ||
          [...witnesses].some(
            ([witness, previousIdentity]) => !regularFile(root, witness) || !sameIdentity(witness, previousIdentity),
          ) ||
          !regularFile(root, file) ||
          !sameIdentity(file, previous)
        ) {
          throw new Error("artifact changed");
        }
        fs.unlinkSync(file);
        // Resource version folders contain only generated packages. Remove them only when now empty.
        const directory = path.dirname(file);
        if (
          file.endsWith(".deckmod") &&
          STABLE_VERSION.test(path.basename(directory)) &&
          safePath(root, directory) &&
          fs.readdirSync(directory).length === 0
        )
          fs.rmdirSync(directory);
      }
    }
    return result;
  } catch {
    // Do not print filesystem errors: they may contain user paths or file contents (PRV-003).
    throw new Error(
      "[PRV-006] 빌드 산출물 확인 또는 정리에 실패했습니다. 현재 설치 파일을 보존했습니다. (정의: docs/spec/privacy.md)",
    );
  }
}

if (import.meta.main === true) {
  const args = process.argv.slice(2);
  const currentIndex = args.indexOf("--current-artifact");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  try {
    const result = cleanBuildArtifacts({
      root,
      currentArtifact: currentIndex < 0 ? undefined : args[currentIndex + 1],
      buildSucceeded: args.includes("--successful-build"),
      apply: args.includes("--apply"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "빌드 산출물 정리에 실패했습니다.");
    process.exitCode = 1;
  }
}
