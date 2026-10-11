// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupSuccessfulBuild, expectedInstaller } from "./tauri-with-cleanup.ts";

const temporary: string[] = [];
function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deck-wrapper-synthetic-")));
  temporary.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.5.1" }));
  return root;
}
function put(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "synthetic generated installer");
}
afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("successful Tauri build cleanup", () => {
  it("selects the actual Cargo directory and explicit Windows target architecture", () => {
    const root = fixture();
    const args = ["build", "--target", "aarch64-pc-windows-msvc", "--bundles", "nsis"];
    const env = { CARGO_TARGET_DIR: path.join(root, "target", "review-040") };
    expect(expectedInstaller(root, args, env)).toBe(
      path.join(
        env.CARGO_TARGET_DIR,
        "aarch64-pc-windows-msvc",
        "release",
        "bundle",
        "nsis",
        "TeacherDeck_0.5.1_arm64-setup.exe",
      ),
    );
    expect(expectedInstaller(root, ["build", "--target=i686-pc-windows-msvc"], {})).toBe(
      path.join(root, "target", "i686-pc-windows-msvc", "release", "bundle", "nsis", "TeacherDeck_0.5.1_x86-setup.exe"),
    );
  });

  it("conservatively skips commands and output overrides it cannot safely identify", () => {
    const root = fixture();
    for (const args of [
      ["dev"],
      ["build", "--debug"],
      ["build", "--no-bundle"],
      ["build", "--profile", "custom"],
      ["build", "--config=custom.json"],
      ["build", "--runner", "custom"],
      ["build", "--", "--target-dir", "elsewhere"],
      ["build", "--target", "x86_64-unknown-linux-gnu"],
      ["build", "--bundles", "msi"],
      ["build", "--help"],
    ]) {
      expect(expectedInstaller(root, args, {})).toBeUndefined();
    }
    expect(expectedInstaller(root, ["build"], { CARGO_TARGET_DIR: "target/review-040" })).toBeUndefined();
    expect(expectedInstaller(root, ["build"], { CARGO_TARGET_DIR: path.dirname(root) })).toBeUndefined();
    expect(
      expectedInstaller(root, ["build"], { CARGO_TARGET_DIR: path.join(root, "target", "nested", "unknown") }),
    ).toBeUndefined();
  });

  it("accepts NSIS among space-separated or comma-separated bundle values in either order", () => {
    const root = fixture();
    const expected = expectedInstaller(root, ["build"], {});
    expect(expected).toBeDefined();
    for (const args of [
      ["build", "--bundles", "msi", "nsis"],
      ["build", "--bundles", "nsis", "msi"],
      ["build", "--bundles", "msi,nsis"],
      ["build", "--bundles", "nsis,msi"],
      ["build", "--bundles=msi,nsis"],
      ["build", "-b", "msi", "nsis"],
      ["build", "--bundles", "msi", "nsis", "--features", "synthetic-feature"],
    ]) {
      expect(expectedInstaller(root, args, {})).toBe(expected);
    }
    expect(expectedInstaller(root, ["build", "--bundles", "msi", "--features", "nsis"], {})).toBeUndefined();
  });

  it("keeps previous artifacts after failure and when no fresh installer was produced", () => {
    const root = fixture();
    const current = expectedInstaller(root, ["build"], {});
    expect(current).toBeDefined();
    if (current === undefined) throw new Error("synthetic fixture requires a supported architecture");
    put(current);
    const old = path.join(
      root,
      "target",
      "release",
      "bundle",
      "nsis",
      `TeacherDeck_0.3.0_${process.arch === "ia32" ? "x86" : process.arch}-setup.exe`,
    );
    put(old);
    const afterExistingFile = fs.lstatSync(current).mtimeMs + 1000;
    expect(cleanupSuccessfulBuild(root, ["build"], {}, 0, 1)).toBe(false);
    expect(cleanupSuccessfulBuild(root, ["build"], {}, afterExistingFile, 0)).toBe(false);
    expect(fs.existsSync(old)).toBe(true);
    fs.unlinkSync(current);
    expect(cleanupSuccessfulBuild(root, ["build"], {}, 0, 0)).toBe(false);
    expect(fs.existsSync(old)).toBe(true);
  });

  it("cleans only after an exit-zero build with a fresh current installer", () => {
    const root = fixture();
    const current = expectedInstaller(root, ["build"], {});
    if (current === undefined) throw new Error("synthetic fixture requires a supported architecture");
    put(current);
    const old = path.join(path.dirname(current), path.basename(current).replace("0.5.1", "0.3.0"));
    put(old);
    expect(cleanupSuccessfulBuild(root, ["build"], {}, fs.lstatSync(current).mtimeMs, 0)).toBe(true);
    expect(fs.existsSync(current)).toBe(true);
    expect(fs.existsSync(old)).toBe(false);
  });

  it("skips a fresh installer reached through a Windows junction or directory symlink", () => {
    const root = fixture();
    const external = fixture();
    const current = expectedInstaller(root, ["build"], { CARGO_TARGET_DIR: path.join(root, "target", "linked") });
    if (current === undefined) throw new Error("synthetic fixture requires a supported architecture");
    fs.mkdirSync(path.join(root, "target"));
    fs.symlinkSync(external, path.join(root, "target", "linked"), process.platform === "win32" ? "junction" : "dir");
    put(path.join(external, "release", "bundle", "nsis", path.basename(current)));
    const old = path.join(
      root,
      "target",
      "release",
      "bundle",
      "nsis",
      path.basename(current).replace("0.5.1", "0.3.0"),
    );
    put(old);
    expect(
      cleanupSuccessfulBuild(root, ["build"], { CARGO_TARGET_DIR: path.join(root, "target", "linked") }, 0, 0),
    ).toBe(false);
    expect(fs.existsSync(old)).toBe(true);
    expect(fs.existsSync(current)).toBe(true);
  });
});
