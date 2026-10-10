// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Shell side of the bridge (docs/spec/bridge-protocol.md). Pure class: no React, no Tauri; the
// host functions are injected so the rules are unit-tested (ModuleBridge.test.ts).
import {
  DeckCallError,
  type Envelope,
  type EventPayloads,
  type EventTopic,
  HELLO_TIMEOUT_MS,
  type InitPayload,
  MAX_MESSAGE_BYTES,
  type Message,
  type MessageEventLike,
  PROTOCOL_VERSION,
  isEnvelope,
  jsonByteLength,
} from "@deck/sdk";

/** A module iframe's window as the bridge sees it. */
export interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BridgeHost {
  /** Builds `init` for a module (version, caps, granted, theme). */
  init(moduleId: string): Promise<InitPayload>;
  /** Forwards an authorized request to Rust `host_invoke` (CAP-008 re-checks everything). */
  invoke(moduleId: string, cap: string, method: string, args: unknown): Promise<unknown>;
  /** Module did not say hello in time (BRG-003). */
  onLoadError(moduleId: string): void;
  debug?(message: string): void;
}

interface Frame {
  moduleId: string;
  origin: string;
  window: FrameWindow;
  helloTimer: ReturnType<typeof setTimeout> | undefined;
  ready: boolean;
  cancelled: Set<string>;
}

export class ModuleBridge {
  private readonly frames = new Map<unknown, Frame>();
  private readonly host: BridgeHost;
  private readonly helloTimeoutMs: number;

  constructor(host: BridgeHost, helloTimeoutMs = HELLO_TIMEOUT_MS) {
    this.host = host;
    this.helloTimeoutMs = helloTimeoutMs;
  }

  /** Call when an iframe for `moduleId` starts loading. */
  register(win: FrameWindow, moduleId: string, entryUrl: string): void {
    this.unregister(win);
    const origin = moduleEntryOrigin(moduleId, entryUrl);
    if (origin === null) {
      this.host.onLoadError(moduleId);
      return;
    }
    const helloTimer = setTimeout(() => {
      const f = this.frames.get(win);
      if (f !== undefined && !f.ready) this.host.onLoadError(moduleId);
    }, this.helloTimeoutMs);
    this.frames.set(win, { moduleId, origin, window: win, helloTimer, ready: false, cancelled: new Set() });
  }

  /** Call when the iframe is removed. */
  unregister(win: FrameWindow): void {
    const f = this.frames.get(win);
    if (f !== undefined) clearTimeout(f.helloTimer);
    this.frames.delete(win);
  }

  /** `message` event handler for the shell window. */
  handle(event: MessageEventLike): void {
    // BRG-001: only known module iframes, only from the module origin. The module id comes from
    // the iframe mapping, never from the message.
    const frame = this.frames.get(event.source);
    if (frame === undefined || event.origin !== frame.origin) return;
    if (!isEnvelope(event.data)) {
      this.host.debug?.("ignored malformed module message");
      return;
    }
    const msg = event.data;
    switch (msg.kind) {
      case "hello":
        void this.onHello(frame);
        return;
      case "req":
        void this.onRequest(frame, msg);
        return;
      case "cancel":
        frame.cancelled.add(msg.id);
        this.post(frame, {
          kind: "res",
          id: msg.id,
          ok: false,
          error: new DeckCallError("CANCELLED", "취소했어요.").toJSON(),
        });
        return;
      default:
        this.host.debug?.(`ignored ${msg.kind} from module`);
    }
  }

  /** Sends an event to one module (fs.dropped, module.visibility, job.progress). */
  sendEvent<T extends EventTopic>(moduleId: string, topic: T, payload: EventPayloads[T]): void {
    for (const f of this.frames.values()) {
      if (f.moduleId === moduleId && f.ready) this.post(f, { kind: "evt", topic, payload });
    }
  }

  /** Sends an event to every ready module (theme.changed). */
  broadcast<T extends EventTopic>(topic: T, payload: EventPayloads[T]): void {
    for (const f of this.frames.values()) if (f.ready) this.post(f, { kind: "evt", topic, payload });
  }

  private post(frame: Frame, msg: Message): void {
    if (this.frames.get(frame.window) !== frame) return;
    frame.window.postMessage({ deck: PROTOCOL_VERSION, ...msg } satisfies Envelope, frame.origin);
  }

  private async onHello(frame: Frame): Promise<void> {
    clearTimeout(frame.helloTimer);
    try {
      const init = await this.host.init(frame.moduleId);
      if (this.frames.get(frame.window) !== frame) return;
      frame.ready = true;
      this.post(frame, { kind: "init", ...init });
    } catch {
      if (this.frames.get(frame.window) === frame) this.host.onLoadError(frame.moduleId);
    }
  }

  private async onRequest(frame: Frame, msg: Extract<Message, { kind: "req" }>): Promise<void> {
    const reply = (m: Message): void => {
      if (frame.cancelled.delete(msg.id)) return; // already answered with CANCELLED
      this.post(frame, m);
    };
    if (!frame.ready) {
      reply({
        kind: "res",
        id: msg.id,
        ok: false,
        error: new DeckCallError("PERMISSION_DENIED", "init 전 요청이에요(BRG-003).").toJSON(),
      });
      return;
    }
    if (jsonByteLength(msg.args) > MAX_MESSAGE_BYTES) {
      reply({
        kind: "res",
        id: msg.id,
        ok: false,
        error: new DeckCallError("INVALID_ARGS", "요청이 1MB를 넘어요(BRG-007).").toJSON(),
      });
      return;
    }
    try {
      const result = await this.host.invoke(frame.moduleId, msg.cap, msg.method, msg.args);
      if (jsonByteLength(result) > MAX_MESSAGE_BYTES) {
        reply({
          kind: "res",
          id: msg.id,
          ok: false,
          error: new DeckCallError("INTERNAL", "응답이 1MB를 넘어요(BRG-007).").toJSON(),
        });
        return;
      }
      reply({ kind: "res", id: msg.id, ok: true, result: result ?? null });
    } catch (e) {
      reply({ kind: "res", id: msg.id, ok: false, error: toDeckError(e) });
    }
  }
}

/** Accepts only the exact host-generated entry origin for this module, never a suffix alone. */
export function moduleEntryOrigin(moduleId: string, entryUrl: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(moduleId)) return null;
  try {
    const url = new URL(entryUrl);
    const origin = `http://deckmod.${moduleId}.modules.localhost`;
    if (
      !entryUrl.startsWith(`${origin}/`) ||
      url.origin !== origin ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !url.pathname.startsWith(`/${moduleId}/`)
    )
      return null;
    return origin;
  } catch {
    return null;
  }
}

/** Normalizes anything thrown by `invoke` into a DeckError payload. */
export function toDeckError(e: unknown): ReturnType<DeckCallError["toJSON"]> {
  if (e instanceof DeckCallError) return e.toJSON();
  if (typeof e === "object" && e !== null && "code" in e && "message" in e) {
    const { code, message } = e as { code: string; message: string };
    return new DeckCallError(code as DeckCallError["code"], String(message)).toJSON();
  }
  return new DeckCallError("INTERNAL", "내부 오류가 발생했어요.").toJSON();
}
