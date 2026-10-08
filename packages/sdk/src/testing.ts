// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Mock host for module tests (MOD-015): plays the shell's side of the bridge in memory.
//
//   const host = createMockHost({ granted: ["storage"], handlers: { "storage.get": () => null } });
//   const deck = await connect({ window: host.window });
import type { MessageEventLike, WindowLike } from "./client.ts";
import { CAPABILITIES } from "./generated/registry.ts";
import {
  DeckCallError,
  type Envelope,
  type EventPayloads,
  type EventTopic,
  type InitPayload,
  type Message,
  PROTOCOL_VERSION,
  type ThemePayload,
  isEnvelope,
} from "./protocol.ts";

export type MockHandler = (args: unknown) => unknown;

export interface MockHostOptions {
  module?: { id: string; version: string };
  /** Defaults to every registry cap at its current version. */
  caps?: Record<string, string>;
  /** Caps the module may call (`init.granted`). */
  granted?: string[];
  theme?: ThemePayload;
  /** `"cap.method"` → handler. Throw a DeckCallError to fail. Missing → CAPABILITY_UNAVAILABLE. */
  handlers?: Record<string, MockHandler>;
  /** Origin the mock shell sends from. */
  shellOrigin?: string;
  /** Set false to simulate a shell that never answers `hello`. */
  answerHello?: boolean;
}

export interface MockHost {
  /** Pass to `connect({ window })`. */
  window: WindowLike;
  /** Every request the module sent, in order. */
  readonly requests: { cap: string; method: string; args: unknown }[];
  /** Every envelope the module posted (hello, req, cancel). */
  readonly received: Envelope[];
  /** Sends a bridge event to the module. */
  emit<T extends EventTopic>(topic: T, payload: EventPayloads[T]): void;
  /** Delivers a raw message as if from `source`/`origin` (for BRG-002 tests). */
  deliverRaw(data: unknown, origin: string, source: unknown): void;
  /** Resolves when all queued messages were processed. */
  flush(): Promise<void>;
}

const LIGHT: ThemePayload = { mode: "light", mica: false, tokens: {} };

export function createMockHost(options: MockHostOptions = {}): MockHost {
  const shellOrigin = options.shellOrigin ?? "http://tauri.localhost";
  const caps =
    options.caps ?? Object.fromEntries(Object.entries(CAPABILITIES).map(([name, c]) => [name, c.version]));
  const init: InitPayload = {
    module: options.module ?? { id: "sample-tool", version: "0.1.0" },
    host: { app: "0.0.0", caps },
    granted: options.granted ?? [],
    theme: options.theme ?? LIGHT,
  };
  const listeners = new Set<(e: MessageEventLike) => void>();
  const requests: MockHost["requests"] = [];
  const received: Envelope[] = [];
  let queue: Promise<void> = Promise.resolve();

  const parent = {
    postMessage(message: unknown): void {
      queue = queue.then(() => handle(message));
    },
  };
  const deliverRaw = (data: unknown, origin: string, source: unknown): void => {
    for (const fn of [...listeners]) fn({ data, origin, source });
  };
  const send = (msg: Message): void => deliverRaw({ deck: PROTOCOL_VERSION, ...msg }, shellOrigin, parent);

  function handle(message: unknown): void {
    if (!isEnvelope(message)) return;
    received.push(message);
    if (message.kind === "hello" && options.answerHello !== false) {
      send({ kind: "init", ...init });
    } else if (message.kind === "req") {
      requests.push({ cap: message.cap, method: message.method, args: message.args });
      // Answer outside the queue so a slow handler never blocks later messages (e.g. cancel).
      void respond(message.id, `${message.cap}.${message.method}`, message.args);
    }
  }

  async function respond(id: string, key: string, args: unknown): Promise<void> {
    const handler = options.handlers?.[key];
    try {
      if (handler === undefined) throw new DeckCallError("CAPABILITY_UNAVAILABLE", "mock: no handler");
      const result = await handler(args);
      send({ kind: "res", id, ok: true, result: result ?? null });
    } catch (e) {
      const err = e instanceof DeckCallError ? e : new DeckCallError("INTERNAL", String(e));
      send({ kind: "res", id, ok: false, error: err.toJSON() });
    }
  }

  const window: WindowLike = {
    parent,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    location: { ancestorOrigins: { length: 1, 0: shellOrigin } },
  };

  return {
    window,
    requests,
    received,
    emit: (topic, payload) => send({ kind: "evt", topic, payload }),
    deliverRaw,
    flush: async () => {
      await queue;
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}
