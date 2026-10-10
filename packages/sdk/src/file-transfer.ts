// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// File bytes remain bounded: read GETs <=256KiB; authenticated write requests <=64KiB.
import type { Deck } from "./client.ts";
import type { FileHandleInfo } from "./generated/FileHandleInfo.ts";
import type { HandleArgs } from "./generated/HandleArgs.ts";
import type { BeginWriteArgs } from "./generated/BeginWriteArgs.ts";
import type { ErrorCode } from "./generated/ErrorCode.ts";
import { DeckCallError } from "./protocol.ts";

export interface TransferOptions {
  signal?: AbortSignal;
}
/** Blob replaces the generated beginWrite size; the SDK derives its exact byte length. */
export type WriteBlobArgs = Omit<BeginWriteArgs, "size"> & { blob: Blob };
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const READ_CHUNK_BYTES = 256 * 1024;
const WRITE_CHUNK_BYTES = 64 * 1024;
const cancelled = () => new DeckCallError("CANCELLED", "파일 작업을 취소했어요.");
const invalid = () => new DeckCallError("INVALID_ARGS", "파일 전송 정보가 올바르지 않아요.");
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelled();
}
function safeError(error: unknown, signal?: AbortSignal): DeckCallError {
  if (signal?.aborted) return cancelled();
  return error instanceof DeckCallError ? error : new DeckCallError("INTERNAL", "파일을 전송하지 못했어요.");
}
function resourceUrl(value: string, origin: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    !origin ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/_resources\/[a-f0-9]{32}$/.test(url.pathname)
  )
    throw invalid();
  return url;
}
/** Refuse a response before accumulating more than the requested chunk. */
async function boundedBytes(response: Response, expected: number): Promise<Uint8Array> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) !== expected)) {
    await response.body?.cancel().catch(() => undefined);
    throw invalid();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const bytes = new Uint8Array(expected);
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > expected) throw invalid();
      bytes.set(value, offset);
      offset += value.length;
    }
    if (offset !== expected) throw invalid();
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function httpError(response: Response): Promise<DeckCallError> {
  const statusCodes: Record<number, ErrorCode> = {
    400: "INVALID_ARGS",
    403: "PERMISSION_DENIED",
    404: "NOT_FOUND",
    409: "BUSY",
    500: "INTERNAL",
  };
  let code: ErrorCode = statusCodes[response.status] ?? "INTERNAL";
  const reader = response.body?.getReader();
  if (reader) {
    try {
      const parts: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 4096) break;
        parts.push(value);
      }
      if (length <= 4096) {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.length;
        }
        const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
        const codes: ErrorCode[] = [
          "PERMISSION_DENIED",
          "CAPABILITY_UNAVAILABLE",
          "VERSION_MISMATCH",
          "INVALID_ARGS",
          "NOT_FOUND",
          "CANCELLED",
          "TIMEOUT",
          "BUSY",
          "INTERNAL",
        ];
        if (typeof body === "object" && body !== null && "code" in body && codes.includes(body.code as ErrorCode))
          code = body.code as ErrorCode;
      }
    } catch {
      /* Keep status-derived code; never expose response text or token URLs. */
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return new DeckCallError(code, "파일을 읽지 못했어요.");
}

/** Internal factory; only its typed helpers are exposed through deck.fs. */
export function createFileTransfer(fs: Deck["fs"], ownOrigin: () => string | undefined) {
  async function* readChunks(args: HandleArgs, { signal }: TransferOptions = {}): AsyncGenerator<Uint8Array> {
    checkAbort(signal);
    // Do not cancel bridge open: its late result is needed to close the real host resource.
    const file = await fs.openRead(args);
    let closePromise: Promise<void> | undefined;
    const close = () => (closePromise ??= fs.closeRead({ readId: file.readId }));
    const abort = () => {
      void close().catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    let failed = false;
    try {
      checkAbort(signal);
      if (
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > MAX_FILE_BYTES ||
        !Number.isSafeInteger(file.chunkBytes) ||
        file.chunkBytes <= 0 ||
        file.chunkBytes > READ_CHUNK_BYTES
      )
        throw invalid();
      const url = resourceUrl(file.url, ownOrigin());
      for (let offset = 0; offset < file.size;) {
        checkAbort(signal);
        const length = Math.min(file.chunkBytes, file.size - offset);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("length", String(length));
        const init: RequestInit = {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        };
        if (signal) init.signal = signal;
        const response = await globalThis.fetch(url.href, init);
        if (!response.ok) throw await httpError(response);
        const bytes = await boundedBytes(response, length);
        checkAbort(signal);
        offset += bytes.length;
        yield bytes;
      }
      checkAbort(signal);
    } catch (error) {
      failed = true;
      throw safeError(error, signal);
    } finally {
      signal?.removeEventListener("abort", abort);
      await close().catch((error: unknown) => {
        if (!failed) throw safeError(error);
      });
    }
  }
  async function writeBlob(
    { batchId, suggestedName, blob }: WriteBlobArgs,
    { signal }: TransferOptions = {},
  ): Promise<FileHandleInfo> {
    checkAbort(signal);
    if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.size > MAX_FILE_BYTES) throw invalid();
    // A cancelled beginWrite must still deliver its id so we can explicitly abort.
    const file = await fs.beginWrite({ batchId, suggestedName, size: blob.size });
    let abortPromise: Promise<void> | undefined;
    let committing = false;
    let committed = false;
    let failed = false;
    const abortWrite = () => (abortPromise ??= fs.abortWrite({ writeId: file.writeId }));
    const abort = () => {
      if (!committing) void abortWrite().catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      checkAbort(signal);
      if (!Number.isSafeInteger(file.chunkBytes) || file.chunkBytes <= 0 || file.chunkBytes > WRITE_CHUNK_BYTES)
        throw invalid();
      for (let offset = 0; offset < blob.size;) {
        checkAbort(signal);
        const length = Math.min(file.chunkBytes, blob.size - offset);
        const data = Array.from(new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()));
        if (data.length !== length) throw invalid();
        checkAbort(signal);
        const args = { writeId: file.writeId, offset, data };
        let result;
        try {
          result = await fs.writeChunk(args);
        } catch (error) {
          // One identical retry supports an accepted chunk whose response was lost.
          if (!(error instanceof DeckCallError) || error.code !== "TIMEOUT") throw error;
          checkAbort(signal);
          result = await fs.writeChunk(args);
        }
        checkAbort(signal);
        if (result.nextOffset !== offset + length) throw invalid();
        offset = result.nextOffset;
      }
      checkAbort(signal);
      // Once commit starts, let the host publish/abort state machine choose the result.
      // A published file is preserved and reported as success even if the signal then aborts.
      committing = true;
      const result = await fs.commitWrite({ writeId: file.writeId });
      committed = true;
      return result;
    } catch (error) {
      failed = true;
      throw safeError(error, committing ? undefined : signal);
    } finally {
      signal?.removeEventListener("abort", abort);
      if (!committed) {
        await abortWrite().catch((error: unknown) => {
          if (!failed) throw safeError(error);
        });
      }
    }
  }
  return { readChunks, writeBlob };
}
