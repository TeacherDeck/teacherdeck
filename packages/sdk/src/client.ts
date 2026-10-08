// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Bridge client used by every module (packages/sdk/AGENTS.md). Framework-agnostic.
import type { DroppedFiles } from "./generated/DroppedFiles.ts";
import type { FileHandleInfo } from "./generated/FileHandleInfo.ts";
import type { FolderHandleInfo } from "./generated/FolderHandleInfo.ts";
import type { PickFilesArgs } from "./generated/PickFilesArgs.ts";
import { CAPABILITIES } from "./generated/registry.ts";
import type { SystemInfo } from "./generated/SystemInfo.ts";
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
  location?: { ancestorOrigins?: { readonly length: number; readonly [index: number]: string } };
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
  readonly system: { info(): Promise<SystemInfo> };
  readonly storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  readonly fs: {
    pickFiles(args?: PickFilesArgs): Promise<FileHandleInfo[]>;
    pickFolder(): Promise<FolderHandleInfo | null>;
    stat(handle: string): Promise<FileHandleInfo>;
    reveal(handle: string): Promise<void>;
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
            ? new DeckCallError("PERMISSION_DENIED", `[MOD-006] module.json에 선언하지 않았거나 쓸 수 없는 캡이에요: ${cap}`)
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
      system: { info: () => call<SystemInfo>("system", "info") },
      storage: {
        get: <T>(key: string) => call<T | null>("storage", "get", { key }),
        set: (key, value) => call("storage", "set", { key, value }).then(() => undefined),
        delete: (key) => call("storage", "delete", { key }).then(() => undefined),
        keys: () => call<string[]>("storage", "keys"),
      },
      fs: {
        pickFiles: (args = {}) => call<FileHandleInfo[]>("fs", "pickFiles", args),
        pickFolder: () => call<FolderHandleInfo | null>("fs", "pickFolder"),
        stat: (handle) => call<FileHandleInfo>("fs", "stat", { handle }),
        reveal: (handle) => call("fs", "reveal", { handle }).then(() => undefined),
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
