// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// @deck/sdk public entry. Modules call host features only through this package (MOD-006).
export { connect } from "./client.ts";
export type { CallOptions, ConnectOptions, Deck, MessageEventLike, WindowLike } from "./client.ts";
export {
  DEFAULT_TIMEOUT_MS,
  DeckCallError,
  EVENT_TOPICS,
  HELLO_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  MODULE_ORIGIN,
  PROTOCOL_VERSION,
  SDK_VERSION,
  SHELL_ORIGINS,
  isEnvelope,
  jsonByteLength,
} from "./protocol.ts";
export type { Envelope, EventPayloads, EventTopic, InitPayload, Message, ThemePayload } from "./protocol.ts";
export { CAPABILITIES } from "./generated/registry.ts";
export type { CapName } from "./generated/registry.ts";
export type { DeckError } from "./generated/DeckError.ts";
export type { DroppedFiles } from "./generated/DroppedFiles.ts";
export type { ErrorCode } from "./generated/ErrorCode.ts";
export type { FileFilter } from "./generated/FileFilter.ts";
export type { FileHandleInfo } from "./generated/FileHandleInfo.ts";
export type { FolderHandleInfo } from "./generated/FolderHandleInfo.ts";
export type { PickFilesArgs } from "./generated/PickFilesArgs.ts";
export type { SystemInfo } from "./generated/SystemInfo.ts";
