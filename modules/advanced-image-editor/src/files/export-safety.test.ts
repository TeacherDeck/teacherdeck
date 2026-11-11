// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorHistory } from "../core/history.ts";
import {
  assertMemoryBudget,
  createDocument,
  createPixelLayer,
  createRaster,
  managedDocumentBytes,
  LIMITS,
} from "../core/model.ts";
import { encodeDocument } from "./codec.ts";
import { exportDocument } from "./index.ts";
import { decodeProject, encodeProjectBlob, projectEncodingScratch, projectSaveHeadroom } from "./project.ts";
import { rasterEncodingScratch } from "./export-budget.ts";

afterEach(() => vi.unstubAllGlobals());

describe("bounded editable saves", () => {
  it("saves and reopens a 12MP single-layer project through the production codec under the unchanged memory ceiling", async () => {
    const document = createDocument(4000, 3000);
    const pixels = createRaster(4000, 3000);
    for (let at = 0; at < pixels.data.length; at++) pixels.data[at] = (at * 17 + 29) & 255;
    document.layers.push(createPixelLayer(pixels));
    expect(LIMITS.managedBytes).toBe(256 * 1024 * 1024);
    expect(() => assertMemoryBudget(document, projectSaveHeadroom(document))).not.toThrow();
    const output = await exportDocument(document, "deckimage", new AbortController().signal, async (request) => {
      if (request.kind !== "encode") throw new Error("fixture");
      return encodeDocument(request.document, request.format);
    });
    const restored = decodeProject(new Uint8Array(await output.blob.arrayBuffer()));
    const reopened = restored.layers[0];
    if (reopened?.kind !== "pixel") throw new Error("fixture");
    expect([reopened.pixels.width, reopened.pixels.height]).toEqual([4000, 3000]);
    let differences = 0;
    for (let at = 0; at < pixels.data.length; at++) if (pixels.data[at] !== reopened.pixels.data[at]) differences++;
    expect(differences).toBe(0);
    expect(output.blob.type).toBe("application/vnd.teacherdeck.image");
  }, 90_000);

  it("preserves incompressible pixels across many ZIP chunks", async () => {
    const document = createDocument(512, 512);
    const pixels = createRaster(512, 512);
    let state = 17;
    for (let at = 0; at < pixels.data.length; at++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels.data[at] = state & 255;
    }
    document.layers.push(createPixelLayer(pixels));
    const output = encodeProjectBlob(document);
    expect(output.size).toBeGreaterThan(pixels.data.length);
    expect(projectEncodingScratch(document)).toBeGreaterThan(output.size * 2);
    const restored = decodeProject(new Uint8Array(await output.arrayBuffer())).layers[0];
    expect(restored?.kind === "pixel" && restored.pixels.data.every((value, at) => value === pixels.data[at])).toBe(
      true,
    );
  });

  it("rejects a large canvas whose project could be saved but could not safely reopen", () => {
    const document = createDocument(6000, 4000);
    document.layers.push(createPixelLayer(createRaster(5000, 2900)));
    expect(() => projectSaveHeadroom(document)).toThrow("작업 파일을 안전하게 저장할 크기를 넘어요.");
    expect(document.layers).toHaveLength(1);
  });

  it("reserves save memory during edits and refuses an impossible state without losing the undo chain", () => {
    const document = createDocument(4000, 3000);
    document.layers.push(createPixelLayer(createRaster(4000, 3000)));
    const history = new EditorHistory(undefined, projectSaveHeadroom);
    const edited = history.perform(document, "합성 이동", (draft) => {
      if (draft.layers[0]) draft.layers[0].transform.x = 1;
    });
    expect(managedDocumentBytes(edited) + projectSaveHeadroom(edited) + history.memoryBytes).toBeLessThan(
      LIMITS.managedBytes,
    );
    expect(() =>
      history.perform(edited, "과도한 복제", (draft) => {
        draft.layers.push(createPixelLayer(createRaster(4000, 3000)));
      }),
    ).toThrow();
    expect(history.canUndo).toBe(true);
    expect(history.undo(edited).layers[0]?.transform.x).toBe(0);
    expect(edited.layers).toHaveLength(1);
  });

  it("renders a 12MP raster with one canvas and no second ImageData plane", async () => {
    const document = createDocument(4000, 3000);
    const pixels = createRaster(4000, 3000);
    pixels.data.fill(255);
    document.layers.push(createPixelLayer(pixels));
    const written: Uint8ClampedArray[] = [];
    let canvases = 0;
    vi.stubGlobal(
      "ImageData",
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          canvases++;
        }
        getContext() {
          return { putImageData: (image: { data: Uint8ClampedArray }) => written.push(image.data) };
        }
        async convertToBlob({ type }: { type: string }) {
          return new Blob(["synthetic encoded raster"], { type });
        }
      },
    );
    expect(() =>
      assertMemoryBudget(document, managedDocumentBytes(document) + rasterEncodingScratch(document)),
    ).not.toThrow();
    const output = await exportDocument(document, "png", new AbortController().signal, async (request) => {
      if (request.kind !== "encode") throw new Error("fixture");
      return encodeDocument(request.document, request.format);
    });
    expect(output.blob.type).toBe("image/png");
    expect(canvases).toBe(1);
    expect(written[0]?.length).toBe(48_000_000);
    expect(written[0]?.[0]).toBe(255);
    expect(written[0]?.at(-1)).toBe(255);
    expect(written[0] === pixels.data).toBe(false);
    expect(pixels.data[0]).toBe(255);
  }, 90_000);
});
