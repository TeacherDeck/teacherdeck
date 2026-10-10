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
export type { HandleArgs } from "./generated/HandleArgs.ts";
export type { FileRead } from "./generated/FileRead.ts";
export type { CloseReadArgs } from "./generated/CloseReadArgs.ts";
export type { CreateOutputFolderArgs } from "./generated/CreateOutputFolderArgs.ts";
export type { OutputBatch } from "./generated/OutputBatch.ts";
export type { BeginWriteArgs } from "./generated/BeginWriteArgs.ts";
export type { FileWrite } from "./generated/FileWrite.ts";
export type { WriteChunkArgs } from "./generated/WriteChunkArgs.ts";
export type { WriteChunkResult } from "./generated/WriteChunkResult.ts";
export type { WriteIdArgs } from "./generated/WriteIdArgs.ts";
export type { BatchIdArgs } from "./generated/BatchIdArgs.ts";
export type { TransferOptions, WriteBlobArgs } from "./file-transfer.ts";

export type { ClipboardWriteTextArgs } from "./generated/ClipboardWriteTextArgs.ts";
export type { ClipboardWriteRichTextArgs } from "./generated/ClipboardWriteRichTextArgs.ts";
export type { ClipboardBlock } from "./generated/ClipboardBlock.ts";
export type { ClipboardCell } from "./generated/ClipboardCell.ts";
export type { ClipboardRun } from "./generated/ClipboardRun.ts";
export type { PhysicalRect } from "./generated/PhysicalRect.ts";
export type { DisplayInfo } from "./generated/DisplayInfo.ts";
export type { CaptureNaming } from "./generated/CaptureNaming.ts";
export type { CaptureSettings } from "./generated/CaptureSettings.ts";
export type { CaptureArgs } from "./generated/CaptureArgs.ts";
export type { CaptureResult } from "./generated/CaptureResult.ts";
export type { CaptureArmArgs } from "./generated/CaptureArmArgs.ts";
export type { CaptureSession } from "./generated/CaptureSession.ts";
export type { CaptureStatusArgs } from "./generated/CaptureStatusArgs.ts";
export type { CaptureSessionArgs } from "./generated/CaptureSessionArgs.ts";
export type { CaptureUpdateArgs } from "./generated/CaptureUpdateArgs.ts";
export type { CaptureCompletedEvent } from "./generated/CaptureCompletedEvent.ts";
export type { CaptureFailedEvent } from "./generated/CaptureFailedEvent.ts";
export type { CaptureFormat } from "./generated/CaptureFormat.ts";
export type { CaptureNamingMode } from "./generated/CaptureNamingMode.ts";
export type { OverlayStyle } from "./generated/OverlayStyle.ts";
export type { OverlayInfo } from "./generated/OverlayInfo.ts";
export type { OverlayCreateArgs } from "./generated/OverlayCreateArgs.ts";
export type { OverlayArgs } from "./generated/OverlayArgs.ts";
export type { OverlayUpdateArgs } from "./generated/OverlayUpdateArgs.ts";
export type { OverlayUiLayout } from "./generated/OverlayUiLayout.ts";
export type { OverlayUiState } from "./generated/OverlayUiState.ts";
export type { OverlayUiActionArgs } from "./generated/OverlayUiActionArgs.ts";
export type { OverlayUiAction } from "./generated/OverlayUiAction.ts";
export type { ShortcutModifier } from "./generated/ShortcutModifier.ts";
export type { ShortcutRegisterArgs } from "./generated/ShortcutRegisterArgs.ts";
export type { ShortcutInfo } from "./generated/ShortcutInfo.ts";
export type { ShortcutArgs } from "./generated/ShortcutArgs.ts";
export type { ShortcutReplaceArgs } from "./generated/ShortcutReplaceArgs.ts";
export type { ShortcutTriggeredEvent } from "./generated/ShortcutTriggeredEvent.ts";
export type { DestinationGrant } from "./generated/DestinationGrant.ts";
export type { PickDestinationArgs } from "./generated/PickDestinationArgs.ts";
export type { DestinationArgs } from "./generated/DestinationArgs.ts";
export type { DestinationStatusArgs } from "./generated/DestinationStatusArgs.ts";
