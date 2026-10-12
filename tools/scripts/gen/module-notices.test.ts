// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// GEN-007 guard for ADR-0030: grouping the notices per tool must not drop any notice.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundledModuleIds, REPO_ROOT } from "../lib/modules.ts";
import { readZipEntry } from "../lib/zip.ts";
import { collectMessagingNotices } from "./messaging-resources.ts";
import { collectModuleNotices } from "./module-notices.ts";
import { THIRD_PARTY, type Notice } from "./third-party.ts";

const app = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, THIRD_PARTY), "utf8")) as Notice[];
const notices = collectModuleNotices(REPO_ROOT, app);
const group = (id: string) => notices.groups.find((g) => g.id === id);

describe("module notices (ADR-0030)", () => {
  it("has one group per bundled tool plus the media engine", () => {
    expect(notices.groups.map((g) => g.id)).toEqual([...bundledModuleIds(REPO_ROOT), "media-download"]);
  });

  it("keeps every original CoolReserve runtime notice", () => {
    const messaging = collectMessagingNotices(REPO_ROOT);
    expect(messaging).not.toBeNull();
    const texts = Object.values(notices.texts).map((t) => t.text);
    for (const file of messaging?.files ?? []) expect(texts).toContain(file.text);
    const names = group("coolreserve")?.components.map((c) => c.name) ?? [];
    for (const component of messaging?.components ?? []) expect(names).toContain(component.name);
  });

  it("gives every asset and runtime component its original text", () => {
    for (const g of notices.groups)
      for (const c of g.components)
        if (c.kind !== "library") expect(c.texts.length, `${g.id}/${c.name}`).toBeGreaterThan(0);
  });

  it("references only existing texts and leaves none unreferenced", () => {
    const referenced = new Set(notices.groups.flatMap((g) => g.components.flatMap((c) => c.texts)));
    expect([...referenced].sort()).toEqual(Object.keys(notices.texts).sort());
  });

  it("lists bundled PDF, OCR and media components", () => {
    const names = (id: string) => group(id)?.components.map((c) => c.name) ?? [];
    expect(names("pdf-compress")).toEqual(expect.arrayContaining(["pdfjs-dist", "pdf-lib", "Liberation Sans"]));
    expect(names("pdf-mask")).toEqual(expect.arrayContaining(["tesseract.js", "tesseract.js-core", "tessdata_fast"]));
    expect(names("media-download")).toEqual(["CPython", "yt-dlp", "yt-dlp-ejs", "Deno", "FFmpeg"]);
  });

  it("does not repeat libraries already listed app-wide with the same version", () => {
    const appWide = new Set(app.map((n) => `${n.name}@${n.version}`));
    for (const g of notices.groups)
      for (const c of g.components) if (c.kind === "library") expect(appWide.has(`${c.name}@${c.version}`)).toBe(false);
    expect(group("timer")?.components).toEqual([]);
    expect(group("timer")?.shared).toBeGreaterThan(0);
  });
});

describe("readZipEntry", () => {
  const wheel = fs.readFileSync(path.join(REPO_ROOT, "vendor/media/yt_dlp-2026.8.19-py3-none-any.whl"));

  it("reads a deflated entry and returns null for a missing one", () => {
    expect(readZipEntry(wheel, "yt_dlp-2026.8.19.dist-info/licenses/LICENSE")?.toString("utf8")).toMatch(/unlicense/i);
    expect(readZipEntry(wheel, "missing")).toBeNull();
  });

  it("rejects bytes that are not a ZIP", () => {
    expect(() => readZipEntry(Buffer.alloc(64), "LICENSE")).toThrow();
  });
});
