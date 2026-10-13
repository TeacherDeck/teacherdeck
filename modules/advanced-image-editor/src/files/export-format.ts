// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { ExportFormat, RasterFormat } from "./codec.ts";

export type ExportSelection = ExportFormat | "source";
export interface ExportTarget {
  format: ExportFormat;
  extension: string;
}

/** Only the opened document determines automatic output; added layers do not change it. */
export function exportTarget(selection: ExportSelection, sourceName = "", sourceFormat?: RasterFormat): ExportTarget {
  if (selection !== "source") return { format: selection, extension: selection === "jpeg" ? "jpg" : selection };
  const extension = /\.([^.]+)$/.exec(sourceName)?.[1] ?? "";
  const lower = extension.toLowerCase();
  const extensionFormat =
    lower === "jpg" || lower === "jpeg" ? "jpeg" : lower === "png" || lower === "webp" ? lower : undefined;
  const format = sourceFormat ?? extensionFormat ?? "png";
  return { format, extension: extensionFormat === format ? extension : format === "jpeg" ? "jpg" : format };
}

export function exportName(name: string, target: ExportTarget | ExportFormat): string {
  const base = name.replace(/\.[^.]+$/, "") || "편집한 이미지";
  const { extension } = typeof target === "string" ? exportTarget(target) : target;
  return `${base}.${extension}`;
}
