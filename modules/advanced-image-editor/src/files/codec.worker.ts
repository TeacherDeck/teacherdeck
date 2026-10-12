// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { decodeDocument, encodeDocument } from "./codec.ts";
import type { EditorDocument } from "../core/model.ts";
import type { ImportedDocument, ImportOptions } from "./psd.ts";
import type { EncodeResult, ExportFormat } from "./codec.ts";
export type CodecRequest =
  | { kind: "decode"; bytes: Uint8Array<ArrayBuffer>; options?: ImportOptions }
  | { kind: "encode"; document: EditorDocument; format: ExportFormat };
export type CodecResponse = { result: ImportedDocument | EncodeResult } | { error: string; reasons: string[] };
self.onmessage = async (event: MessageEvent<CodecRequest>) => {
  try {
    const request = event.data;
    const result =
      request.kind === "decode"
        ? await decodeDocument(request.bytes, request.options)
        : await encodeDocument(request.document, request.format);
    const transfer = new Set<ArrayBuffer>();
    if (request.kind === "decode" && "document" in result) {
      // These buffers belong to this finished decode, never the live editor. Transfer avoids a second decoded copy.
      for (const layer of result.document.layers)
        if (layer.kind === "pixel") {
          if (layer.pixels.data.buffer instanceof ArrayBuffer) transfer.add(layer.pixels.data.buffer);
          if (layer.mask?.buffer instanceof ArrayBuffer) transfer.add(layer.mask.buffer);
        }
      if (result.document.selection?.buffer instanceof ArrayBuffer) transfer.add(result.document.selection.buffer);
    }
    self.postMessage({ result } satisfies CodecResponse, { transfer: [...transfer] });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_FILE";
    // Never send parser error messages: they can contain source text, names or raw metadata.
    const allowed = [
      "PSD_UNSUPPORTED",
      "PSD_COMPLEX_TEXT",
      "PSD_NO_COMPOSITE",
      "INPUT_LIMIT",
      "MEMORY_LIMIT",
      "IMAGE_LIMIT",
      "TEXT_LIMIT",
      "LAYER_LIMIT",
      "ANIMATED_IMAGE",
      "INVALID_PROJECT",
      "INVALID_PSD",
    ];
    const reasons =
      error && typeof error === "object" && "reasons" in error && Array.isArray(error.reasons)
        ? (error.reasons as string[])
        : [];
    self.postMessage({ error: allowed.includes(code) ? code : "INVALID_FILE", reasons } satisfies CodecResponse);
  }
};
