// SPDX-License-Identifier: GPL-3.0-only
// Additional terms: see LICENSE-ADDITIONAL-TERMS
// The shell's only door to the Rust host. `@tauri-apps/api` may be imported here and nowhere in
// modules or packages (apps/desktop/AGENTS.md, MOD-005).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FsDroppedEvent } from "./generated/FsDroppedEvent.ts";
import type { ModuleEntry } from "./generated/ModuleEntry.ts";
import type { ShellInfo } from "./generated/ShellInfo.ts";
import type { UpdateStatus } from "./generated/UpdateStatus.ts";

export const FS_DROPPED_EVENT = "deck://fs-dropped";

export const host = {
  shellInfo: () => invoke<ShellInfo>("shell_info"),
  listModules: () => invoke<ModuleEntry[]>("list_modules"),
  /** Marks the shown module (null = none) and returns its granted caps. */
  moduleActivated: (moduleId: string | null) => invoke<string[]>("module_activated", { moduleId }),
  moduleVisibility: (moduleId: string, visible: boolean) => invoke("module_visibility", { moduleId, visible }).then(() => undefined),
  moduleUnloaded: (moduleId: string) => invoke("module_unloaded", { moduleId }).then(() => undefined),
  hostInvoke: (moduleId: string, cap: string, method: string, args: unknown) =>
    invoke<unknown>("host_invoke", { moduleId, cap, method, args }),
  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  installUpdate: () => invoke("install_update").then(() => undefined),
  restartApp: () => invoke("restart_app").then(() => undefined),
  secProbeReport: (report: unknown) => invoke("sec_probe_report", { report }).then(() => undefined),
  onFsDropped: (fn: (e: FsDroppedEvent) => void) => listen<FsDroppedEvent>(FS_DROPPED_EVENT, (e) => fn(e.payload)),
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
