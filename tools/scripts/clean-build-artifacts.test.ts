// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanBuildArtifacts } from "./clean-build-artifacts.ts";

const temporary: string[] = [];
function fixture(): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "deck-cleanup-synthetic-")));
  temporary.push(root);
  put(root, "package.json", JSON.stringify({ version: "0.5.1" }));
  return root;
}
function put(root: string, relative: string, contents = "synthetic generated artifact"): string {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
}
const current = "target/review-040/release/bundle/nsis/TeacherDeck_0.5.1_x64-setup.exe";
const old = "target/release/bundle/nsis/TeacherDeck_0.3.0_x64-setup.exe";

afterEach(() => {
  for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bounded build artifact cleanup", () => {
  it("defaults to a dry run and only applies when explicitly requested after success", () => {
    const root = fixture();
    put(root, current);
    put(root, old);
    put(root, `${old}.sig`);
    const options = { root, currentArtifact: current, buildSucceeded: true };
    const preview = cleanBuildArtifacts(options);
    expect(preview.ready).toBe(true);
    expect(preview.mode).toBe("dry-run");
    expect(preview.files).toEqual([old, `${old}.sig`]);
    expect(fs.existsSync(path.join(root, old))).toBe(true);
    const applied = cleanBuildArtifacts({ ...options, apply: true });
    expect(applied.files).toEqual(preview.files);
    expect(applied.bytes).toBe(preview.bytes);
    expect(fs.existsSync(path.join(root, old))).toBe(false);
    expect(fs.existsSync(path.join(root, `${old}.sig`))).toBe(false);
    expect(fs.existsSync(path.join(root, current))).toBe(true);
  });

  it("preserves current copies, newer versions, prereleases, and newest architecture without current build", () => {
    const root = fixture();
    put(root, current);
    put(root, old);
    const kept = [
      "target/release/bundle/nsis/TeacherDeck_0.5.1_x64-setup.exe",
      "target/release/bundle/nsis/TeacherDeck_0.6.0_x64-setup.exe",
      "target/release/bundle/nsis/TeacherDeck_0.5.2-beta.1_x64-setup.exe",
      "target/release/bundle/nsis/TeacherDeck_0.3.2_arm64-setup.exe",
    ];
    for (const file of kept) put(root, file);
    const olderArm = "target/release/bundle/nsis/TeacherDeck_0.3.1_arm64-setup.exe";
    put(root, olderArm);
    const result = cleanBuildArtifacts({ root, currentArtifact: current, buildSucceeded: true, apply: true });
    expect(result.files).toEqual([old, olderArm].sort());
    for (const file of kept) expect(fs.existsSync(path.join(root, file))).toBe(true);
  });

  it("leaves all artifacts after failure, a missing or empty installer, or a stale app version", () => {
    const root = fixture();
    put(root, current);
    put(root, old);
    const base = { root, currentArtifact: current, apply: true };
    expect(cleanBuildArtifacts({ ...base, buildSucceeded: false }).ready).toBe(false);
    expect(
      cleanBuildArtifacts({ root, currentArtifact: "target/missing.exe", buildSucceeded: true, apply: true }).ready,
    ).toBe(false);
    expect(cleanBuildArtifacts({ ...base, currentArtifact: old, buildSucceeded: true }).ready).toBe(false);
    put(root, current, "");
    expect(cleanBuildArtifacts({ ...base, buildSucceeded: true }).ready).toBe(false);
    expect(fs.existsSync(path.join(root, old))).toBe(true);
  });

  it("retains the newest usable architecture fallback when a higher version installer is empty", () => {
    const root = fixture();
    put(root, "package.json", JSON.stringify({ version: "0.6.0" }));
    const fresh = "target/review-040/release/bundle/nsis/TeacherDeck_0.6.0_x64-setup.exe";
    const fallback = "target/release/bundle/nsis/TeacherDeck_0.4.0_arm64-setup.exe";
    const empty = "target/release/bundle/nsis/TeacherDeck_0.5.1_arm64-setup.exe";
    const previous = "target/release/bundle/nsis/TeacherDeck_0.3.0_arm64-setup.exe";
    put(root, fresh);
    put(root, fallback);
    put(root, empty, "");
    put(root, previous);
    const result = cleanBuildArtifacts({ root, currentArtifact: fresh, buildSucceeded: true, apply: true });
    expect(result.files).toEqual([empty, previous].sort());
    expect(fs.existsSync(path.join(root, fresh))).toBe(true);
    expect(fs.existsSync(path.join(root, fallback))).toBe(true);
    expect(fs.lstatSync(path.join(root, fallback)).size).toBeGreaterThan(0);
  });

  it("does not accept an installer outside the workspace or an unrecognized directory", () => {
    const root = fixture();
    const sibling = fixture();
    put(root, old);
    const escaped = put(sibling, current);
    expect(cleanBuildArtifacts({ root, currentArtifact: escaped, buildSucceeded: true, apply: true }).ready).toBe(
      false,
    );
    const wrongDirectory = put(root, "documents/TeacherDeck_0.5.1_x64-setup.exe");
    expect(
      cleanBuildArtifacts({ root, currentArtifact: wrongDirectory, buildSucceeded: true, apply: true }).ready,
    ).toBe(false);
    expect(fs.existsSync(path.join(root, old))).toBe(true);
    expect(fs.existsSync(escaped)).toBe(true);
  });

  it("rejects a junction or symlink anywhere in the current artifact path", () => {
    const root = fixture();
    const sibling = fixture();
    put(root, old);
    put(sibling, "release/bundle/nsis/TeacherDeck_0.5.1_x64-setup.exe");
    fs.symlinkSync(sibling, path.join(root, "target", "review-040"), process.platform === "win32" ? "junction" : "dir");
    const result = cleanBuildArtifacts({ root, currentArtifact: current, buildSucceeded: true, apply: true });
    expect(result.ready).toBe(false);
    expect(fs.existsSync(path.join(root, old))).toBe(true);
  });

  it("never follows linked old output directories and refuses a linked workspace root", () => {
    const root = fixture();
    const sibling = fixture();
    put(root, current);
    const external = put(sibling, "release/bundle/nsis/TeacherDeck_0.1.0_x64-setup.exe");
    fs.symlinkSync(sibling, path.join(root, "target", "linked-old"), process.platform === "win32" ? "junction" : "dir");
    expect(cleanBuildArtifacts({ root, currentArtifact: current, buildSucceeded: true, apply: true }).files).toEqual(
      [],
    );
    expect(fs.existsSync(external)).toBe(true);
    const alias = path.join(sibling, "workspace-link");
    fs.symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
    expect(
      cleanBuildArtifacts({ root: alias, currentArtifact: current, buildSucceeded: true, apply: true }).ready,
    ).toBe(false);
  });

  it("ignores documents, caches, logs, native resources, arbitrary exe/msi and directories", () => {
    const root = fixture();
    put(root, current);
    put(root, old);
    const kept = [
      "target/hwp-focus/pnpm-runtime/node_modules/runtime.exe",
      "target/release/teacherdeck.exe",
      "target/release/deps/compiler.rlib",
      "target/release/modules/timer/0.1.0/timer-0.1.0.deckmod",
      "target/release/bundle/nsis/uninstaller.exe",
      "target/release/bundle/nsis/TeacherDeck_0.1.0_x64.msi",
      "target/release/bundle/nsis/TeacherDeck_0.1.0_x64-setup.exe.notes",
      "target/qa.log",
      "target/qa-result.json",
      "documents/TeacherDeck_0.1.0_x64-setup.exe",
      ".git/synthetic-index",
    ];
    for (const file of kept) put(root, file);
    expect(cleanBuildArtifacts({ root, currentArtifact: current, buildSucceeded: true, apply: true }).files).toEqual([
      old,
    ]);
    for (const file of kept) expect(fs.existsSync(path.join(root, file))).toBe(true);
  });

  it("prunes module packages only below the current manifest version with its nonempty package present", () => {
    const root = fixture();
    put(root, current);
    put(root, "modules/timer/module.json", JSON.stringify({ version: "0.3.1" }));
    const stale = "target/deckmod/timer-0.2.0.deckmod";
    const kept = [
      "target/deckmod/timer-0.3.1.deckmod",
      "target/deckmod/timer-0.4.0.deckmod",
      "target/deckmod/timer-0.3.1-beta.1.deckmod",
      "target/deckmod/unknown-0.1.0.deckmod",
    ];
    put(root, stale);
    for (const file of kept) put(root, file);
    put(root, "modules/quick-note/module.json", JSON.stringify({ version: "0.2.0" }));
    put(root, "target/deckmod/quick-note-0.1.0.deckmod");
    const result = cleanBuildArtifacts({ root, currentArtifact: current, buildSucceeded: true, apply: true });
    expect(result.files).toEqual([stale]);
    for (const file of kept) expect(fs.existsSync(path.join(root, file))).toBe(true);
    expect(fs.existsSync(path.join(root, "target/deckmod/quick-note-0.1.0.deckmod"))).toBe(true);
  });
});
