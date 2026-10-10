// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// Bridge protocol v1 (docs/spec/bridge-protocol.md). Shared by the SDK and the shell.
import type { CaptureCompletedEvent } from "./generated/CaptureCompletedEvent.ts";
import type { CaptureFailedEvent } from "./generated/CaptureFailedEvent.ts";
import type { OverlayInfo } from "./generated/OverlayInfo.ts";
import type { ShortcutTriggeredEvent } from "./generated/ShortcutTriggeredEvent.ts";
import type { DeckError } from "./generated/DeckError.ts";
import type { DroppedFiles } from "./generated/DroppedFiles.ts";
import type { ErrorCode } from "./generated/ErrorCode.ts";

/** Integer protocol version carried in every message (BRG-008). */
export const PROTOCOL_VERSION = 1;
/** SDK semver (VER-006). */
export const SDK_VERSION = "0.4.1";
/** Default request timeout; `long` registry methods are exempt (BRG-004). */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** A module must say hello within this time after loading (BRG-003). */
export const HELLO_TIMEOUT_MS = 10_000;
/** Maximum serialized message size (BRG-007). */
export const MAX_MESSAGE_BYTES = 1024 * 1024;
/** Shell origins (release, dev). Fixed in apps/desktop/src-tauri/src/origins.rs. */
export const SHELL_ORIGINS: readonly string[] = ["http://tauri.localhost", "http://localhost:8265"];
/** Module origin (SEC-002). */
export const MODULE_ORIGIN = "http://deckmod.localhost";

/** v1 events (BRG-009). Adding one is a spec change. */
export const EVENT_TOPICS = [
  "theme.changed",
  "fs.dropped",
  "module.visibility",
  "job.progress",
  "capture.completed",
  "capture.failed",
  "overlay.changed",
  "shortcut.triggered",
] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];

export interface ThemePayload {
  mode: "light" | "dark";
  mica: boolean;
  /** Fluent theme tokens serialized by the shell (design-system.md §2). */
  tokens: Record<string, string>;
}

export interface EventPayloads {
  "capture.completed": CaptureCompletedEvent;
  "capture.failed": CaptureFailedEvent;
  "overlay.changed": OverlayInfo;
  "shortcut.triggered": ShortcutTriggeredEvent;
  "theme.changed": ThemePayload;
  "fs.dropped": DroppedFiles;
  "module.visibility": { visible: boolean };
  "job.progress": { id: string; done: number; total: number };
}

export interface InitPayload {
  module: { id: string; version: string };
  host: { app: string; caps: Record<string, string> };
  granted: string[];
  theme: ThemePayload;
}

export type Message =
  | { kind: "hello"; sdk: string }
  | ({ kind: "init" } & InitPayload)
  | { kind: "req"; id: string; cap: string; method: string; args: unknown }
  | { kind: "res"; id: string; ok: true; result: unknown }
  | { kind: "res"; id: string; ok: false; error: DeckError }
  | { kind: "cancel"; id: string }
  | { kind: "evt"; topic: string; payload: unknown };

export type Envelope = { deck: typeof PROTOCOL_VERSION } & Message;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isString = (x: unknown): x is string => typeof x === "string";

/** Structural check of an incoming message (BRG-006: anything else is ignored). */
export function isEnvelope(x: unknown): x is Envelope {
  if (!isObject(x) || x["deck"] !== PROTOCOL_VERSION) return false;
  switch (x["kind"]) {
    case "hello":
      return isString(x["sdk"]);
    case "init":
      return isObject(x["module"]) && isObject(x["host"]) && Array.isArray(x["granted"]) && isObject(x["theme"]);
    case "req":
      return isString(x["id"]) && isString(x["cap"]) && isString(x["method"]) && "args" in x;
    case "res":
      return isString(x["id"]) && (x["ok"] === true ? "result" in x : x["ok"] === false && isObject(x["error"]));
    case "cancel":
      return isString(x["id"]);
    case "evt":
      return isString(x["topic"]) && "payload" in x;
    default:
      return false;
  }
}

/** UTF-8 size of the JSON encoding; Infinity when not JSON-serializable (BRG-007). */
export function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(json).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Error thrown by SDK calls. `code` is a bridge ErrorCode. */
export class DeckCallError extends Error {
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "DeckCallError";
    this.code = code;
    this.details = details;
  }

  static from(e: DeckError): DeckCallError {
    return new DeckCallError(e.code, e.message, e.details);
  }

  toJSON(): DeckError {
    return { code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}
