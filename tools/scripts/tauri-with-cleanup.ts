// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cleanBuildArtifacts } from "./clean-build-artifacts.ts";

const WINDOWS_TARGETS: Record<string, string> = {
  "x86_64-pc-windows-msvc": "x64",
  "x86_64-pc-windows-gnu": "x64",
  "i686-pc-windows-msvc": "x86",
  "i686-pc-windows-gnu": "x86",
  "aarch64-pc-windows-msvc": "arm64",
};

function argument(args: string[], name: string, short?: string): string | undefined {
  const index = args.findIndex((arg) => arg === name || arg === short || arg.startsWith(`${name}=`));
  if (index < 0) return undefined;
  return args[index]?.includes("=") === true ? args[index]?.split("=").slice(1).join("=") : args[index + 1];
}

function bundleArguments(args: string[]): string[] | undefined {
  const values: string[] = [];
  let specified = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg !== "--bundles" && arg !== "-b" && !arg.startsWith("--bundles=") && !arg.startsWith("-b=")) continue;
    specified = true;
    if (arg.includes("=")) values.push(...arg.slice(arg.indexOf("=") + 1).split(","));
    while (args[index + 1] !== undefined && args[index + 1]?.startsWith("-") !== true) {
      index++;
      const value = args[index];
      if (value !== undefined) values.push(...value.split(","));
    }
  }
  return specified ? values : undefined;
}

/** Custom profiles/configuration/runner/Cargo arguments have unknown output layouts: keep all artifacts. */
export function expectedInstaller(root: string, args: string[], env: NodeJS.ProcessEnv): string | undefined {
  if (args[0] !== "build" || args.some((arg) => ["--debug", "-d", "--no-bundle", "--", "--help", "-h"].includes(arg)))
    return undefined;
  if (
    args.some((arg) =>
      ["--profile", "--config", "-c", "--runner", "-r"].some((name) => arg === name || arg.startsWith(`${name}=`)),
    )
  )
    return undefined;
  const triple = argument(args, "--target", "-t");
  if (triple !== undefined && !(triple in WINDOWS_TARGETS)) return undefined;
  const bundles = bundleArguments(args);
  if (bundles !== undefined && !bundles.some((bundle) => bundle === "nsis" || bundle === "all")) return undefined;
  const customTarget = env["CARGO_TARGET_DIR"];
  // Cargo interprets relative target paths in its own cwd. Avoid guessing which directory a CLI override uses.
  if (customTarget !== undefined && !path.isAbsolute(customTarget)) return undefined;
  const target = customTarget === undefined ? path.join(root, "target") : path.resolve(customTarget);
  const relativeTarget = path.relative(path.join(root, "target"), target);
  if (path.isAbsolute(relativeTarget) || relativeTarget.startsWith("..") || relativeTarget.split(path.sep).length > 1)
    return undefined;
  const packageData: unknown = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (
    typeof packageData !== "object" ||
    packageData === null ||
    !("version" in packageData) ||
    typeof packageData.version !== "string" ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(packageData.version)
  )
    return undefined;
  const arch =
    triple === undefined
      ? ({ x64: "x64", ia32: "x86", arm64: "arm64" } as Record<string, string>)[process.arch]
      : WINDOWS_TARGETS[triple];
  if (arch === undefined) return undefined;
  return path.join(
    target,
    ...(triple === undefined ? [] : [triple]),
    "release",
    "bundle",
    "nsis",
    `TeacherDeck_${packageData.version}_${arch}-setup.exe`,
  );
}

/** Fresh output is checked separately so an old installer never turns a failed or no-bundle build into authorization. */
export function cleanupSuccessfulBuild(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  startedAt: number,
  status: number,
): boolean {
  if (status !== 0) return false;
  const installer = expectedInstaller(root, args, env);
  if (installer === undefined || !fs.existsSync(installer)) return false;
  const stat = fs.lstatSync(installer);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.mtimeMs < startedAt) return false;
  const result = cleanBuildArtifacts({ root, currentArtifact: installer, buildSucceeded: true, apply: true });
  if (!result.ready) return false;
  console.log(`빌드 산출물 정리: 이전 파일 ${result.files.length}개, ${result.bytes.toLocaleString("ko-KR")}바이트.`);
  return true;
}

if (import.meta.main === true) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const args = process.argv.slice(2);
  const startedAt = Date.now();
  try {
    const require = createRequire(import.meta.url);
    const cli = require.resolve("@tauri-apps/cli/tauri.js");
    const build = spawnSync(process.execPath, [cli, ...args], {
      cwd: path.join(root, "apps", "desktop"),
      env: process.env,
      stdio: "inherit",
    });
    if (build.error !== undefined || build.signal !== null) process.exitCode = 1;
    else if (build.status !== 0) process.exitCode = build.status ?? 1;
    else {
      try {
        const cleaned = cleanupSuccessfulBuild(root, args, process.env, startedAt, build.status);
        if (args[0] === "build" && !cleaned)
          console.log("새 설치 파일을 확인할 수 없어 이전 빌드 산출물을 보존했습니다.");
      } catch {
        console.error("빌드는 성공했지만 산출물 정리에 실패했습니다. 현재 설치 파일을 보존했습니다.");
        process.exitCode = 2;
      }
    }
  } catch {
    console.error("Tauri 명령을 실행하지 못했습니다. 빌드 산출물을 보존했습니다.");
    process.exitCode = 1;
  }
}
