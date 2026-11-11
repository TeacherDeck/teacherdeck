// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { applyPerspective } from "./geometry.ts";
import { assertMemoryBudget, EditorError, managedDocumentBytes } from "./model.ts";
import { mergeDown, rasterizeDescriptor, renderDocumentCanvas } from "./render.ts";
import { applySelectionMask, featherMask, polygonSelection, selectColorInLayer } from "./selection.ts";
import type { OperationResult, WorkerRequest, WorkerResponse } from "./preview.ts";
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void;
};
const cachedLayers = new Map<string, { pixels: Uint8ClampedArray; mask: Uint8Array | null }>();
scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.kind === "preview") {
      for (const layer of request.doc.layers)
        if (layer.kind === "pixel") {
          const cached = cachedLayers.get(layer.id);
          if (layer.pixels.data.length === 0) {
            if (!cached || cached.pixels.length !== layer.pixels.width * layer.pixels.height * 4)
              throw new Error("미리보기 레이어를 다시 불러와주세요.");
            layer.pixels.data = cached.pixels;
          }
          if (layer.mask && layer.mask.length === 0) {
            if (!cached?.mask || cached.mask.length !== layer.pixels.width * layer.pixels.height)
              throw new Error("미리보기 마스크를 다시 불러와주세요.");
            layer.mask = cached.mask;
          }
          cachedLayers.set(layer.id, { pixels: layer.pixels.data, mask: layer.mask });
        }
      const layerIds = new Set(request.doc.layers.map((layer) => layer.id));
      for (const id of cachedLayers.keys()) if (!layerIds.has(id)) cachedLayers.delete(id);
      assertMemoryBudget(request.doc, managedDocumentBytes(request.doc), request.options.historyBytes ?? 0);
      const canvas = renderDocumentCanvas(request.doc, request.options);
      if (!(canvas instanceof OffscreenCanvas)) throw new Error("미리보기 환경을 열 수 없어요.");
      const bitmap = canvas.transferToImageBitmap();
      scope.postMessage({ id: request.id, ok: true, bitmap }, [bitmap]);
      canvas.width = 1;
      canvas.height = 1;
      return;
    }
    const task = request.task;
    // Track source planes by identity. Heavy operations replace changed planes; unchanged planes
    // return an empty internal marker so the main thread can retain its original buffer and undo size.
    const inputPlanes = new Map<string, { pixels: Uint8ClampedArray; mask: Uint8Array | null }>();
    const inputSelection = "doc" in task ? task.doc.selection : null;
    if ("doc" in task)
      for (const layer of task.doc.layers)
        if (layer.kind === "pixel") inputPlanes.set(layer.id, { pixels: layer.pixels.data, mask: layer.mask });
    let result: OperationResult;
    if (task.kind === "polygon")
      result = { kind: "selection", selection: polygonSelection(task.width, task.height, task.points) };
    else if (task.kind === "select-color")
      result = {
        kind: "selection",
        selection: selectColorInLayer(task.doc, task.id, task.point, task.tolerance, task.contiguous),
      };
    else {
      if (task.kind === "perspective") applyPerspective(task.doc, task.id, task.corners, task.width, task.height);
      else if (task.kind === "feather") featherMask(task.doc, task.id, task.radius);
      else if (task.kind === "merge") mergeDown(task.doc, task.id);
      else if (task.kind === "mask") applySelectionMask(task.doc, task.id, task.operation);
      else rasterizeDescriptor(task.doc, task.id);
      result = { kind: "document", doc: task.doc };
    }
    const buffers = new Set<ArrayBuffer>();
    if (result.kind === "selection") buffers.add(result.selection.buffer as ArrayBuffer);
    else {
      for (const layer of result.doc.layers)
        if (layer.kind === "pixel") {
          const input = inputPlanes.get(layer.id);
          if (input?.pixels === layer.pixels.data) layer.pixels = { ...layer.pixels, data: new Uint8ClampedArray(0) };
          if (layer.mask && input?.mask === layer.mask) layer.mask = new Uint8Array(0);
        }
      if (result.doc.selection && result.doc.selection === inputSelection) result.doc.selection = new Uint8Array(0);
      if (result.doc.selection) buffers.add(result.doc.selection.buffer as ArrayBuffer);
      for (const layer of result.doc.layers)
        if (layer.kind === "pixel") {
          buffers.add(layer.pixels.data.buffer as ArrayBuffer);
          if (layer.mask) buffers.add(layer.mask.buffer as ArrayBuffer);
        }
    }
    scope.postMessage({ id: request.id, ok: true, result }, [...buffers]);
  } catch (error) {
    scope.postMessage({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : "이미지 작업을 완료할 수 없어요.",
      ...(error instanceof EditorError ? { code: error.code } : {}),
    });
  }
};
