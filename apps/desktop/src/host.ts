// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// The shell's only door to the Rust host. `@tauri-apps/api` may be imported here and nowhere in
// modules or packages (apps/desktop/AGENTS.md, MOD-005).
import type { EventPayloads, OverlayUiAction, OverlayUiState } from "@deck/sdk";
import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FsDroppedEvent } from "./generated/FsDroppedEvent.ts";
import type { ModuleEntry } from "./generated/ModuleEntry.ts";
import type { ShellInfo } from "./generated/ShellInfo.ts";
import type { UpdateStatus } from "./generated/UpdateStatus.ts";
import type { DocumentAction } from "./generated/DocumentAction.ts";
import type { DocumentActionResult } from "./generated/DocumentActionResult.ts";
import type { DocumentExitRequest } from "./generated/DocumentExitRequest.ts";

function listenCurrent<T>(event: string, handler: EventCallback<T>) {
  return listen<T>(event, handler, { target: { kind: "Window", label: getCurrentWindow().label } });
}
export const FS_DROPPED_EVENT = "deck://fs-dropped";

/** Restricted local student view; no main-shell commands or module bridge. */
export const presentationControls = {
  state: () => invoke<import("@deck/sdk").PresentationViewState>("presentation_ui_state"),
  close: () => invoke("presentation_ui_close").then(() => undefined),
  onChanged: (callback: () => void) => listenCurrent<number>("deck://presentation-changed", callback),
};
export type PresentationControlsHost = typeof presentationControls;

/** Trusted shell review of immutable recipient, schedule, body and attachment previews. */
export const messagingConfirmationHost = {
  pending: () => invoke<import("@deck/sdk").MessagingApprovalRequest[]>("messaging_pending_confirmations"),
  resolve: (args: import("@deck/sdk").MessagingApprovalResolution) =>
    invoke("messaging_resolve_confirmation", { args }).then(() => undefined),
};

/** Trusted main-shell settings only; modules receive narrow school-data projections. */
export const schoolDataHost = {
  openTimeAlert: (args: import("./generated/TimeAlertOpenArgs.ts").TimeAlertOpenArgs) =>
    invoke<import("./generated/TimeAlertPreview.ts").TimeAlertPreview | null>("school_data_open_timealert", { args }),
  applyTimeAlert: (args: import("./generated/TimeAlertApplyArgs.ts").TimeAlertApplyArgs) =>
    invoke<import("@deck/sdk").SchoolDataDocument>("school_data_apply_timealert", { args }),
  exportTimeAlert: (args: import("./generated/TimeAlertExportArgs.ts").TimeAlertExportArgs) =>
    invoke<boolean>("school_data_export_timealert", { args }),
  closeTimeAlert: (args: import("./generated/TimeAlertCloseArgs.ts").TimeAlertCloseArgs) =>
    invoke("school_data_close_timealert", { args }).then(() => undefined),
  importRosterPhotos: (args: import("./generated/TimeAlertRosterPhotosArgs.ts").TimeAlertRosterPhotosArgs) =>
    invoke<import("./generated/TimeAlertRosterPhotosPreview.ts").TimeAlertRosterPhotosPreview | null>(
      "school_data_import_roster_photos",
      { args },
    ),
  load: () => invoke<import("@deck/sdk").SchoolDataDocument>("school_data_load"),
  save: (args: import("@deck/sdk").SaveSchoolDataArgs) =>
    invoke<import("@deck/sdk").SchoolDataDocument>("school_data_save", { args }),
  pending: () => invoke<import("@deck/sdk").SchoolAccessRequest[]>("school_data_pending"),
  resolveAccess: (args: import("@deck/sdk").SchoolAccessResolution) =>
    invoke("school_data_resolve_access", { args }).then(() => undefined),
  grants: () => invoke<import("@deck/sdk").SchoolGrantRecord[]>("school_data_grants"),
  revokeGrant: (moduleId: string, grantHandle: string) =>
    invoke("school_data_revoke_grant", { moduleId, grantHandle }).then(() => undefined),
  importPhoto: (args: import("@deck/sdk").SchoolImportPhotoArgs) =>
    invoke<import("@deck/sdk").SchoolDataDocument>("school_data_import_photo", { args }),
  exportBackup: () => invoke<boolean>("school_data_export_backup"),
  exportTimetableImage: (args: import("./generated/SchoolTimetableImageArgs.ts").SchoolTimetableImageArgs) =>
    invoke<boolean>("school_data_export_timetable_image", { args }),
  readBackup: () => invoke<import("@deck/sdk").SchoolDataDocument | null>("school_data_read_backup"),
  recover: (args: import("@deck/sdk").SaveSchoolDataArgs) =>
    invoke<import("@deck/sdk").SchoolDataDocument>("school_data_recover", { args }),
  readWorkbook: () => invoke<import("@deck/sdk").SchoolWorkbookInput | null>("school_data_read_workbook"),
  writeWorkbook: (args: import("@deck/sdk").SchoolWorkbookOutputArgs) =>
    invoke<boolean>("school_data_write_workbook", { args }),
};

export const host = {
  shellInfo: () => invoke<ShellInfo>("shell_info"),
  listModules: () => invoke<ModuleEntry[]>("list_modules"),
  /** Marks the shown module (null = none) and returns its granted caps. */
  moduleActivated: (moduleId: string | null) => invoke<string[]>("module_activated", { moduleId }),
  /** Handshake grant lookup never changes the foreground module. */
  moduleGranted: (moduleId: string) => invoke<string[]>("module_activated", { moduleId, activate: false }),
  moduleVisibility: (moduleId: string, visible: boolean) =>
    invoke("module_visibility", { moduleId, visible }).then(() => undefined),
  documentAction: (moduleId: string, documentAction: DocumentAction) =>
    invoke<DocumentActionResult>("module_visibility", { moduleId, documentAction }),
  onDocumentExit: (fn: (request: DocumentExitRequest) => void) =>
    listenCurrent<DocumentExitRequest>("deck://document-exit-request", (event) => fn(event.payload)),
  moduleUnloaded: (moduleId: string) => invoke("module_unloaded", { moduleId }).then(() => undefined),
  modulesUnloaded: (moduleIds: string[]) =>
    invoke("module_unloaded", { moduleId: "", moduleIds }).then(() => undefined),
  hostInvoke: (moduleId: string, cap: string, method: string, args: unknown) =>
    invoke<unknown>("host_invoke", { moduleId, cap, method, args }),
  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  installUpdate: () => invoke("install_update").then(() => undefined),
  restartApp: () => invoke("restart_app").then(() => undefined),
  secProbeReport: (report: unknown) => invoke("sec_probe_report", { report }).then(() => undefined),
  onModuleEvent: (fn: (e: NativeModuleEvent) => void) =>
    listenCurrent<NativeModuleEvent>("deck://module-event", (e) => fn(e.payload)),
  onShowModule: (fn: (e: { moduleId: string }) => void) =>
    listenCurrent<{ moduleId: string }>("deck://show-module", (e) => fn(e.payload)),
  onFsDropped: (fn: (e: FsDroppedEvent) => void) =>
    listenCurrent<FsDroppedEvent>(FS_DROPPED_EVENT, (e) => fn(e.payload)),
};

/** Main window controls for the custom title bar (core:window permissions in capabilities/main.json). */
export const windowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  /** Calls `fn` after every resize (maximize/restore included). Returns an unsubscribe function. */
  onResized: (fn: () => void) => getCurrentWindow().onResized(() => fn()),
};
export type WindowControls = typeof windowControls;

export type NativeTopic =
  | "capture.completed"
  | "capture.failed"
  | "overlay.changed"
  | "shortcut.triggered"
  | "window.presentationClosed"
  | "window.presentationDisconnected"
  | "window.documentSaveRequested";
export type NativeModuleEvent = {
  [T in NativeTopic]: { moduleId: string; topic: T; payload: EventPayloads[T] };
}[NativeTopic];
export type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];
/** The restricted overlay window never receives the main host API or an arbitrary owner argument. */
export const overlayControls = {
  state: () => invoke<OverlayUiState>("overlay_ui_state"),
  action: (action: OverlayUiAction) => invoke("overlay_ui_action", { args: { action } }).then(() => undefined),
  onState: (fn: (state: OverlayUiState) => void) =>
    listenCurrent<OverlayUiState>("deck://overlay-state", (e) => fn(e.payload)),
  drag: () => getCurrentWindow().startDragging(),
  resize: (direction: ResizeDirection) => getCurrentWindow().startResizeDragging(direction),
};
export type OverlayControls = typeof overlayControls;
