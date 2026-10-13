// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import { imageHeader } from "./header.ts";

export type ImageFormat = "png" | "jpeg" | "webp";
export type OutputFormat = "original" | ImageFormat;

export function resolveOutputFormat(
  name: string,
  bytes: Uint8Array,
  selection: OutputFormat,
): { format: ImageFormat; extension: string } {
  const format = selection === "original" ? imageHeader(bytes).mime.slice(6) : selection;
  if (format !== "png" && format !== "jpeg" && format !== "webp") throw new Error("ENCODER_UNAVAILABLE");
  const suffix = name.match(/\.([^.]+)$/)?.[1];
  const matching = suffix && (format === "jpeg" ? /^(jpg|jpeg)$/i.test(suffix) : suffix.toLowerCase() === format);
  const extension = selection === "original" && matching ? suffix : format === "jpeg" ? "jpg" : format;
  return { format, extension };
}
