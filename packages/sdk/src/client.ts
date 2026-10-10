// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
import type { DisplayInfo } from "./generated/DisplayInfo.ts";
import type { CaptureArgs } from "./generated/CaptureArgs.ts";
import type { CaptureResult } from "./generated/CaptureResult.ts";
import type { CaptureArmArgs } from "./generated/CaptureArmArgs.ts";
import type { CaptureSession } from "./generated/CaptureSession.ts";
import type { CaptureStatusArgs } from "./generated/CaptureStatusArgs.ts";
import type { CaptureSessionArgs } from "./generated/CaptureSessionArgs.ts";
import type { CaptureUpdateArgs } from "./generated/CaptureUpdateArgs.ts";
import type { OverlayInfo } from "./generated/OverlayInfo.ts";
import type { OverlayCreateArgs } from "./generated/OverlayCreateArgs.ts";
import type { OverlayArgs } from "./generated/OverlayArgs.ts";
import type { OverlayUpdateArgs } from "./generated/OverlayUpdateArgs.ts";
import type { ShortcutRegisterArgs } from "./generated/ShortcutRegisterArgs.ts";
import type { ShortcutInfo } from "./generated/ShortcutInfo.ts";
import type { ShortcutArgs } from "./generated/ShortcutArgs.ts";
import type { ShortcutReplaceArgs } from "./generated/ShortcutReplaceArgs.ts";
import type { DestinationGrant } from "./generated/DestinationGrant.ts";
import type { PickDestinationArgs } from "./generated/PickDestinationArgs.ts";
import type { DestinationStatusArgs } from "./generated/DestinationStatusArgs.ts";
import type { DestinationArgs } from "./generated/DestinationArgs.ts";
// Bridge client used by every module (packages/sdk/AGENTS.md). Framework-agnostic.
import type { ClipboardWriteTextArgs } from "./generated/ClipboardWriteTextArgs.ts";
import type { ClipboardWriteRichTextArgs } from "./generated/ClipboardWriteRichTextArgs.ts";
import type { DroppedFiles } from "./generated/DroppedFiles.ts";
import type { FileHandleInfo } from "./generated/FileHandleInfo.ts";
import type { FolderHandleInfo } from "./generated/FolderHandleInfo.ts";
import type { PickFilesArgs } from "./generated/PickFilesArgs.ts";
import { CAPABILITIES } from "./generated/registry.ts";
import type { SystemInfo } from "./generated/SystemInfo.ts";
import type { HandleArgs } from "./generated/HandleArgs.ts";
import type { FileRead } from "./generated/FileRead.ts";
import type { CloseReadArgs } from "./generated/CloseReadArgs.ts";
import type { CreateOutputFolderArgs } from "./generated/CreateOutputFolderArgs.ts";
import type { OutputBatch } from "./generated/OutputBatch.ts";
import type { BeginWriteArgs } from "./generated/BeginWriteArgs.ts";
import type { FileWrite } from "./generated/FileWrite.ts";
import type { WriteChunkArgs } from "./generated/WriteChunkArgs.ts";
import type { WriteChunkResult } from "./generated/WriteChunkResult.ts";
import type { WriteIdArgs } from "./generated/WriteIdArgs.ts";
import type { BatchIdArgs } from "./generated/BatchIdArgs.ts";
import { createFileTransfer, type TransferOptions, type WriteBlobArgs } from "./file-transfer.ts";
import {
  DEFAULT_TIMEOUT_MS,
  DeckCallError,
  type Envelope,
  type EventPayloads,
  type EventTopic,
  HELLO_TIMEOUT_MS,
  type InitPayload,
  MAX_MESSAGE_BYTES,
  type Message,
  PROTOCOL_VERSION,
  SDK_VERSION,
  SHELL_ORIGINS,
  type ThemePayload,
  isEnvelope,
  jsonByteLength,
} from "./protocol.ts";

/** Minimal message-event shape (the real MessageEvent satisfies it). */
export interface MessageEventLike {
  data: unknown;
  origin: string;
  source: unknown;
}

/** The parts of `window` the SDK uses; tests pass a fake (see `@deck/sdk/testing`). */
export interface WindowLike {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: "message", listener: (e: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (e: MessageEventLike) => void): void;
  location?: { origin?: string; ancestorOrigins?: { readonly length: number; readonly [index: number]: string } };
}

export interface ConnectOptions {
  /** Defaults to the global `window`. */
  window?: WindowLike;
  /** Overrides the 30 s default request timeout (tests). */
  timeoutMs?: number;
  /** Overrides the 10 s wait for `init` (tests). */
  initTimeoutMs?: number;
  /** Defaults to `console`. */
  logger?: Pick<Console, "warn" | "debug">;
}

export interface CallOptions {
  /** Aborting sends `cancel` and rejects with `CANCELLED` (BRG-005). */
  signal?: AbortSignal;
  /** Per-call timeout override. */
  timeoutMs?: number;
}

type Listener<T extends EventTopic> = (payload: EventPayloads[T]) => void;

export interface Deck {
  /** This module as the shell identified it. */
  readonly module: { id: string; version: string };
  /** App version and provided capability versions. */
  readonly host: { app: string; caps: Record<string, string> };
  /** Current theme (updated on `theme.changed`). */
  readonly theme: ThemePayload;
  /** SDK semver and bridge protocol version (VER-006). */
  readonly sdk: { version: string; protocol: number };
  /** Whether a capability can be called. Check optional caps before use (MOD-007). */
  has(cap: string): boolean;
  /** Version of a capability on this host, or null. */
  version(cap: string): string | null;
  /** Low-level call. Prefer the typed helpers below. */
  call<T = unknown>(cap: string, method: string, args?: unknown, options?: CallOptions): Promise<T>;
  /** Subscribes to a bridge event; returns an unsubscribe function. */
  on<T extends EventTopic>(topic: T, listener: Listener<T>): () => void;
  /** Detaches from the bridge and rejects pending calls. */
  dispose(): void;
  readonly capture: {
    displays(): Promise<DisplayInfo[]>;
    capture(args: CaptureArgs): Promise<CaptureResult>;
    arm(args: CaptureArmArgs): Promise<CaptureSession>;
    status(args: CaptureStatusArgs): Promise<CaptureSession | null>;
    update(args: CaptureUpdateArgs): Promise<CaptureSession>;
    trigger(args: CaptureSessionArgs): Promise<CaptureResult>;
    resetSequence(args: CaptureSessionArgs): Promise<CaptureSession>;
    stop(args: CaptureSessionArgs): Promise<void>;
  };
  readonly overlay: {
    status(args: OverlayArgs): Promise<OverlayInfo>;
    create(args: OverlayCreateArgs): Promise<OverlayInfo>;
    update(args: OverlayUpdateArgs): Promise<OverlayInfo>;
    show(args: OverlayArgs): Promise<OverlayInfo>;
    hide(args: OverlayArgs): Promise<OverlayInfo>;
    close(args: OverlayArgs): Promise<void>;
  };
  readonly globalShortcut: {
    status(args: ShortcutArgs): Promise<ShortcutInfo>;
    register(args: ShortcutRegisterArgs): Promise<ShortcutInfo>;
    replace(args: ShortcutReplaceArgs): Promise<ShortcutInfo>;
    unregister(args: ShortcutArgs): Promise<void>;
  };
  readonly clipboard: {
    writeText(args: ClipboardWriteTextArgs): Promise<void>;
    writeRichText(args: ClipboardWriteRichTextArgs): Promise<void>;
  };
  readonly system: { info(): Promise<SystemInfo> };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  readonly fs: {
    pickDestination(args: PickDestinationArgs): Promise<DestinationGrant | null>;
    destinationStatus(args: DestinationStatusArgs): Promise<DestinationGrant | null>;
    revealDestination(args: DestinationArgs): Promise<void>;
    revokeDestination(args: DestinationArgs): Promise<void>;
    pickFiles(args?: PickFilesArgs): Promise<FileHandleInfo[]>;
    pickFolder(): Promise<FolderHandleInfo | null>;
    stat(handle: string): Promise<FileHandleInfo>;
    reveal(handle: string): Promise<void>;
    openRead(args: HandleArgs): Promise<FileRead>;
    closeRead(args: CloseReadArgs): Promise<void>;
    createOutputFolder(args: CreateOutputFolderArgs): Promise<OutputBatch>;
    beginWrite(args: BeginWriteArgs): Promise<FileWrite>;
    writeChunk(args: WriteChunkArgs): Promise<WriteChunkResult>;
    commitWrite(args: WriteIdArgs): Promise<FileHandleInfo>;
    abortWrite(args: WriteIdArgs): Promise<void>;
    closeOutputFolder(args: BatchIdArgs): Promise<void>;
    readChunks(args: HandleArgs, options?: TransferOptions): AsyncIterable<Uint8Array>;
    writeBlob(args: WriteBlobArgs, options?: TransferOptions): Promise<FileHandleInfo>;
  };
  readonly window: {
    setAlwaysOnTop(value: boolean): Promise<void>;
    setFullscreen(value: boolean): Promise<void>;
  };
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: DeckCallError): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function isLong(cap: string, method: string): boolean {
  const c = (CAPABILITIES as Record<string, { methods: Record<string, { long: boolean }> }>)[cap];
  return c?.methods[method]?.long === true;
}

function declaredShellOrigin(win: WindowLike): string | undefined {
  const first = win.location?.ancestorOrigins?.[0];
  return first !== undefined && SHELL_ORIGINS.includes(first) ? first : undefined;
}

/**
 * Connects to the shell: sends `hello`, waits for `init` (BRG-003) and returns the client.
 * Call it once at module startup, before rendering anything that uses host features.
 */
export function connect(options: ConnectOptions = {}): Promise<Deck> {
  const win = options.window ?? (globalThis as unknown as { window: WindowLike }).window;
  const log = options.logger ?? console;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let shellOrigin = declaredShellOrigin(win);
  let init: InitPayload | undefined;
  let theme: ThemePayload | undefined;
  const pending = new Map<string, Pending>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const checked = new Set<string>();

  const post = (msg: Message): void => {
    win.parent.postMessage({ deck: PROTOCOL_VERSION, ...msg } satisfies Envelope, shellOrigin ?? "*");
  };

  return new Promise<Deck>((resolveConnect, rejectConnect) => {
    const onMessage = (e: MessageEventLike): void => {
      // BRG-002: only the parent window, only from the shell origin.
      if (e.source !== win.parent || !SHELL_ORIGINS.includes(e.origin)) return;
      if (shellOrigin !== undefined && e.origin !== shellOrigin) return;
      if (!isEnvelope(e.data)) {
        log.debug("[deck] ignored malformed message");
        return;
      }
      const msg = e.data;
      if (init === undefined) {
        if (msg.kind !== "init") return;
        shellOrigin = e.origin;
        init = { module: msg.module, host: msg.host, granted: msg.granted, theme: msg.theme };
        theme = msg.theme;
        clearTimeout(initTimer);
        resolveConnect(deck);
        return;
      }
      switch (msg.kind) {
        case "res": {
          const p = pending.get(msg.id);
          if (p === undefined) return;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(DeckCallError.from(msg.error));
          return;
        }
        case "evt": {
          if (msg.topic === "theme.changed") theme = msg.payload as ThemePayload;
          for (const fn of listeners.get(msg.topic) ?? []) fn(msg.payload);
          return;
        }
        default:
          log.debug(`[deck] ignored ${msg.kind} message`);
      }
    };

    const initTimer = setTimeout(() => {
      win.removeEventListener("message", onMessage);
      rejectConnect(new DeckCallError("TIMEOUT", "셸이 응답하지 않아요(init 없음)."));
    }, options.initTimeoutMs ?? HELLO_TIMEOUT_MS);

    const requireInit = (): InitPayload => {
      if (init === undefined) throw new DeckCallError("INTERNAL", "init 전에는 호출할 수 없어요(BRG-003).");
      return init;
    };

    const call = <T>(cap: string, method: string, args: unknown = {}, opts: CallOptions = {}): Promise<T> => {
      const { granted, host } = requireInit();
      if (!granted.includes(cap)) {
        if (!checked.has(cap)) {
          log.warn(`[MOD-007] deck.has("${cap}")로 확인하지 않고 호출했어요. optional 캡은 확인 후 쓰세요.`);
        }
        return Promise.reject(
          cap in host.caps
            ? new DeckCallError(
                "PERMISSION_DENIED",
                `[MOD-006] module.json에 선언하지 않았거나 쓸 수 없는 캡이에요: ${cap}`,
              )
            : new DeckCallError("CAPABILITY_UNAVAILABLE", `이 앱 버전에는 없는 기능이에요: ${cap}`),
        );
      }
      if (jsonByteLength(args) > MAX_MESSAGE_BYTES) {
        return Promise.reject(new DeckCallError("INVALID_ARGS", "요청이 1MB를 넘어요(BRG-007)."));
      }
      if (opts.signal?.aborted === true) {
        return Promise.reject(new DeckCallError("CANCELLED", "취소했어요."));
      }
      const id = crypto.randomUUID();
      return new Promise<T>((resolve, reject) => {
        const limit = opts.timeoutMs ?? (isLong(cap, method) ? undefined : timeoutMs);
        const timer =
          limit === undefined
            ? undefined
            : setTimeout(() => {
                pending.delete(id);
                reject(new DeckCallError("TIMEOUT", `${cap}.${method} 응답이 없어요.`));
              }, limit);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        opts.signal?.addEventListener(
          "abort",
          () => {
            if (!pending.delete(id)) return;
            clearTimeout(timer);
            post({ kind: "cancel", id });
            reject(new DeckCallError("CANCELLED", "취소했어요."));
          },
          { once: true },
        );
        post({ kind: "req", id, cap, method, args });
      });
    };

    const callFs11 = <T>(method: string, args: unknown): Promise<T> => {
      const { granted, host } = requireInit();
      if (!granted.includes("fs")) return call<T>("fs", method, args);
      const version = /^1\.(\d+)\.\d+$/.exec(host.caps["fs"] ?? "");
      if (!version || Number(version[1]) < 1)
        return Promise.reject(
          new DeckCallError("VERSION_MISMATCH", "파일 전송은 fs 1.1 이상 앱에서 사용할 수 있어요."),
        );
      return call<T>("fs", method, args);
    };
    const deck: Deck = {
      get module() {
        return requireInit().module;
      },
      get host() {
        return requireInit().host;
      },
      get theme() {
        return theme ?? requireInit().theme;
      },
      sdk: { version: SDK_VERSION, protocol: PROTOCOL_VERSION },
      has(cap) {
        checked.add(cap);
        return requireInit().granted.includes(cap);
      },
      version(cap) {
        return requireInit().host.caps[cap] ?? null;
      },
      call,
      on(topic, listener) {
        const set = listeners.get(topic) ?? new Set();
        set.add(listener as (p: unknown) => void);
        listeners.set(topic, set);
        return () => set.delete(listener as (p: unknown) => void);
      },
      dispose() {
        win.removeEventListener("message", onMessage);
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(new DeckCallError("CANCELLED", "연결을 닫았어요."));
        }
        pending.clear();
      },
      capture: {
        displays: () => call<DisplayInfo[]>("capture", "displays", {}),
        capture: (args) => call<CaptureResult>("capture", "capture", args),
        arm: (args) => call<CaptureSession>("capture", "arm", args),
        status: (args) => call<CaptureSession | null>("capture", "status", args),
        update: (args) => call<CaptureSession>("capture", "update", args),
        trigger: (args) => call<CaptureResult>("capture", "trigger", args),
        resetSequence: (args) => call<CaptureSession>("capture", "resetSequence", args),
        stop: (args) => call("capture", "stop", args).then(() => undefined),
      },
      overlay: {
        status: (args) => call<OverlayInfo>("overlay", "status", args),
        create: (args) => call<OverlayInfo>("overlay", "create", args),
        update: (args) => call<OverlayInfo>("overlay", "update", args),
        show: (args) => call<OverlayInfo>("overlay", "show", args),
        hide: (args) => call<OverlayInfo>("overlay", "hide", args),
        close: (args) => call("overlay", "close", args).then(() => undefined),
      },
      globalShortcut: {
        status: (args) => call<ShortcutInfo>("global-shortcut", "status", args),
        register: (args) => call<ShortcutInfo>("global-shortcut", "register", args),
        replace: (args) => call<ShortcutInfo>("global-shortcut", "replace", args),
        unregister: (args) => call("global-shortcut", "unregister", args).then(() => undefined),
      },
      clipboard: {
        writeText: (args) => call("clipboard", "writeText", args).then(() => undefined),
        writeRichText: (args) => call("clipboard", "writeRichText", args).then(() => undefined),
      },
      system: { info: () => call<SystemInfo>("system", "info") },
      storage: {
        get: <T>(key: string) => call<T | null>("storage", "get", { key }),
        set: (key, value) => call("storage", "set", { key, value }).then(() => undefined),
        delete: (key) => call("storage", "delete", { key }).then(() => undefined),
        keys: () => call<string[]>("storage", "keys"),
      },
      fs: {
        pickDestination: (args) => call<DestinationGrant | null>("fs", "pickDestination", args),
        destinationStatus: (args) => call<DestinationGrant | null>("fs", "destinationStatus", args),
        revealDestination: (args) => call("fs", "revealDestination", args).then(() => undefined),
        revokeDestination: (args) => call("fs", "revokeDestination", args).then(() => undefined),
        pickFiles: (args = {}) => call<FileHandleInfo[]>("fs", "pickFiles", args),
        pickFolder: () => call<FolderHandleInfo | null>("fs", "pickFolder"),
        stat: (handle) => call<FileHandleInfo>("fs", "stat", { handle }),
        reveal: (handle) => call("fs", "reveal", { handle }).then(() => undefined),
        openRead: (args) => callFs11<FileRead>("openRead", args),
        closeRead: (args) => callFs11("closeRead", args).then(() => undefined),
        createOutputFolder: (args) => callFs11<OutputBatch>("createOutputFolder", args),
        beginWrite: (args) => callFs11<FileWrite>("beginWrite", args),
        writeChunk: (args) => callFs11<WriteChunkResult>("writeChunk", args),
        commitWrite: (args) => callFs11<FileHandleInfo>("commitWrite", args),
        abortWrite: (args) => callFs11("abortWrite", args).then(() => undefined),
        closeOutputFolder: (args) => callFs11("closeOutputFolder", args).then(() => undefined),
        readChunks: (args, opts) => createFileTransfer(deck.fs, () => win.location?.origin).readChunks(args, opts),
        writeBlob: (args, opts) => createFileTransfer(deck.fs, () => win.location?.origin).writeBlob(args, opts),
      },
      window: {
        setAlwaysOnTop: (value) => call("window", "setAlwaysOnTop", { value }).then(() => undefined),
        setFullscreen: (value) => call("window", "setFullscreen", { value }).then(() => undefined),
      },
    };

    win.addEventListener("message", onMessage);
    post({ kind: "hello", sdk: SDK_VERSION });
  });
}

export type { DroppedFiles };
